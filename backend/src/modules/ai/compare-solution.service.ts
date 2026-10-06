/**
 * 方案对比服务：加载候选、补齐热工 K 值、应用确定性规则。
 * 不是独立 Comparison Agent。新的产品对比请使用 compareProducts。
 * 无 productIds/solutionIds 时不再自动走热工候选发现。
 */
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { catalogProducts, constructionSchemes, projects, thermalReferenceRows, thermalReferenceSets } from "../../db/schema.js";
import { AiError } from "../../shared/ai-errors.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { canViewProject } from "../../shared/permissions.js";
import { ConstructionError } from "../../shared/construction-errors.js";
import { getPublishedConstructionSchemeDetail } from "../construction/construction-read.service.js";
import { publishedReferenceConditions } from "../construction/construction-structure.service.js";
import { executeThermalCalc } from "../thermal/thermal-calc.service.js";
import { queryThermalCandidates } from "../thermal/thermal-candidate.service.js";
import {
  freezeComparisonResult,
  rankCompareCandidates,
  type CompareCandidateDraft,
  type CompareKSource,
  type CompareSolutionsInput,
  type CompareSourceRef,
  type ComparisonResult
} from "./compare-solution.js";

export type CompareSolutionContext = {
  conversationProjectId?: string | null;
  insulationSystemId?: string | null;
  regionCode?: string | null;
  buildingType?: string | null;
};

export type ThermalEngineLookup = (input: {
  schemeId: string;
  productSpecId: string;
  thicknessMm: number;
  projectId?: string | null;
}) => Promise<{ kValue: number; thicknessMm: number; recordId: string } | null>;

export type CompareSolutionDeps = {
  loadSchemes?: (ids: string[]) => Promise<Array<{ id: string; name: string; schemeCode: string }>>;
  loadProducts?: (ids: string[]) => Promise<Array<{ id: string; name: string }>>;
  loadReferenceK?: (schemeId: string, targetK?: number) => Promise<{
    kValue: number;
    thicknessMm: number;
    rowId: string;
    evidenceSource: string;
    evidenceRef: string;
  } | null>;
  runThermalEngine?: ThermalEngineLookup;
  loadSchemeCalcIdentity?: (schemeId: string) => Promise<{ productSpecId: string; thicknessMm: number } | null>;
  queryDiscoveryCandidates?: () => Promise<CompareCandidateDraft[]>;
  assertProjectAccess?: (projectId: string) => Promise<void>;
};

function pickClosestPassingRow<T extends { kValue: number; thicknessMm: number }>(
  rows: T[],
  targetK?: number
): T | null {
  if (rows.length === 0) return null;
  if (targetK == null) {
    return [...rows].sort((a, b) => a.thicknessMm - b.thicknessMm)[0] ?? null;
  }
  const passing = rows.filter((row) => row.kValue <= targetK);
  const pool = passing.length > 0 ? passing : rows;
  return [...pool].sort((a, b) => {
    if (passing.length > 0) return (targetK - a.kValue) - (targetK - b.kValue) || a.thicknessMm - b.thicknessMm;
    return a.kValue - b.kValue || a.thicknessMm - b.thicknessMm;
  })[0] ?? null;
}

async function defaultLoadSchemes(app: FastifyInstance, ids: string[]) {
  if (ids.length === 0) return [];
  return app.db.select({
    id: constructionSchemes.id,
    name: constructionSchemes.name,
    schemeCode: constructionSchemes.schemeCode
  }).from(constructionSchemes).where(and(
    inArray(constructionSchemes.id, ids),
    ...publishedReferenceConditions(constructionSchemes)
  ));
}

async function defaultLoadProducts(app: FastifyInstance, ids: string[]) {
  if (ids.length === 0) return [];
  return app.db.select({
    id: catalogProducts.id,
    name: catalogProducts.name
  }).from(catalogProducts).where(and(
    inArray(catalogProducts.id, ids),
    eq(catalogProducts.status, "ACTIVE")
  ));
}

async function defaultLoadReferenceK(app: FastifyInstance, schemeId: string, targetK?: number) {
  const sets = await app.db.select({ id: thermalReferenceSets.id })
    .from(thermalReferenceSets)
    .where(and(...publishedReferenceConditions(thermalReferenceSets)));
  if (sets.length === 0) return null;
  const rows = await app.db.select({
    rowId: thermalReferenceRows.id,
    kValue: thermalReferenceRows.kValue,
    thicknessMm: thermalReferenceRows.thicknessMm,
    evidenceSource: thermalReferenceRows.evidenceSource,
    evidenceRef: thermalReferenceRows.evidenceRef
  }).from(thermalReferenceRows).where(and(
    eq(thermalReferenceRows.schemeId, schemeId),
    inArray(thermalReferenceRows.setId, sets.map((item) => item.id))
  ));
  const picked = pickClosestPassingRow(rows.map((row) => ({
    ...row,
    kValue: Number(row.kValue),
    thicknessMm: Number(row.thicknessMm)
  })), targetK);
  return picked;
}

async function defaultLoadSchemeCalcIdentity(app: FastifyInstance, schemeId: string) {
  try {
    const detail = await getPublishedConstructionSchemeDetail(app.db, schemeId);
    const option = detail.productOptions[0];
    if (!option) return null;
    const thicknessMm = option.defaultThickness ?? option.minThickness;
    if (thicknessMm == null || thicknessMm <= 0) return null;
    return { productSpecId: option.productSpecId, thicknessMm };
  } catch (error) {
    if (error instanceof ConstructionError) return null;
    throw error;
  }
}

function createDefaultThermalEngine(
  app: FastifyInstance,
  request: FastifyRequest,
  user: AuthUser
): ThermalEngineLookup {
  return async (input) => {
    const layered = await executeThermalCalc(app, request, user, {
      mode: "LAYERED",
      schemeId: input.schemeId,
      productSpecId: input.productSpecId,
      thicknessMm: input.thicknessMm,
      projectId: input.projectId ?? null
    });
    const kValue = Number((layered.record?.result as Record<string, unknown> | undefined)?.kValueRounded
      ?? (layered.record?.result as Record<string, unknown> | undefined)?.kValue);
    if (layered.valid && Number.isFinite(kValue) && layered.record) {
      return { kValue, thicknessMm: input.thicknessMm, recordId: layered.record.id };
    }
    const equivalent = await executeThermalCalc(app, request, user, {
      mode: "EQUIVALENT",
      schemeId: input.schemeId,
      productSpecId: input.productSpecId,
      thicknessMm: input.thicknessMm,
      projectId: input.projectId ?? null
    });
    const eqK = Number((equivalent.record?.result as Record<string, unknown> | undefined)?.kValueRounded
      ?? (equivalent.record?.result as Record<string, unknown> | undefined)?.kValue);
    if (equivalent.valid && Number.isFinite(eqK) && equivalent.record) {
      return { kValue: eqK, thicknessMm: input.thicknessMm, recordId: equivalent.record.id };
    }
    return null;
  };
}

async function assertCompareProjectAccess(
  app: FastifyInstance,
  user: AuthUser,
  projectId: string,
  conversationProjectId?: string | null
) {
  if (conversationProjectId && conversationProjectId !== projectId) {
    throw new AiError("AI_CONVERSATION_FORBIDDEN", "方案对比不能跨项目读取或写入");
  }
  const [project] = await app.db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || !canViewProject(user, project)) {
    throw new AiError("AI_CONVERSATION_FORBIDDEN", "无权在该项目下比较方案");
  }
}

export async function defaultDiscoveryCandidates(
  app: FastifyInstance,
  request: FastifyRequest,
  user: AuthUser,
  input: CompareSolutionsInput,
  ctx: CompareSolutionContext
): Promise<CompareCandidateDraft[]> {
  const outcome = await queryThermalCandidates(app, request, user, {
    targetK: input.targetK,
    systemId: ctx.insulationSystemId ?? undefined,
    regionCode: ctx.regionCode ?? undefined,
    buildingType: ctx.buildingType ?? undefined,
    projectId: input.projectId ?? ctx.conversationProjectId ?? undefined,
    neighborTolerance: 1
  });
  return outcome.candidates.slice(0, 12).map((item) => ({
    id: item.candidateId,
    name: item.scheme.code,
    thickness: item.result.thicknessMm,
    kValue: item.result.kValue,
    kSource: "REFERENCE_TABLE" as const,
    reasons: [],
    sourceRefs: [{
      type: "THERMAL_REFERENCE_ROW",
      id: item.candidateId,
      label: `${item.evidence.source} ${item.evidence.ref}`.trim()
    }, {
      type: "CONSTRUCTION_SCHEME",
      id: item.scheme.id,
      label: item.scheme.code
    }]
  }));
}

/**
 * 确定性方案对比。K 值只来自已发布图集或热工引擎，LLM 不得改写。
 */
export async function compareSolutions(
  app: FastifyInstance,
  request: FastifyRequest,
  user: AuthUser,
  input: CompareSolutionsInput,
  ctx: CompareSolutionContext = {},
  deps: CompareSolutionDeps = {}
): Promise<ComparisonResult> {
  const projectId = input.projectId ?? ctx.conversationProjectId ?? undefined;
  if (input.projectId) {
    await (deps.assertProjectAccess
      ?? ((id: string) => assertCompareProjectAccess(app, user, id, ctx.conversationProjectId)))(input.projectId);
  }

  const solutionIds = [...new Set((input.solutionIds ?? []).filter(Boolean))];
  const productIds = [...new Set((input.productIds ?? []).filter(Boolean))];
  const drafts: CompareCandidateDraft[] = [];

  if (solutionIds.length > 0) {
    const schemes = await (deps.loadSchemes ?? ((ids: string[]) => defaultLoadSchemes(app, ids)))(solutionIds);
    const schemeMap = new Map(schemes.map((item) => [item.id, item]));
    for (const schemeId of solutionIds) {
      const scheme = schemeMap.get(schemeId);
      if (!scheme) {
        drafts.push({
          id: schemeId,
          name: schemeId,
          kSource: "MISSING",
          reasons: ["未找到已发布且生效中的构造方案，暂时无法使用该方案参数"],
          sourceRefs: []
        });
        continue;
      }
      const sourceRefs: CompareSourceRef[] = [{
        type: "CONSTRUCTION_SCHEME",
        id: scheme.id,
        label: scheme.name || scheme.schemeCode
      }];
      const reference = await (deps.loadReferenceK ?? ((id: string, targetK?: number) => defaultLoadReferenceK(app, id, targetK)))(scheme.id, input.targetK);
      if (reference) {
        drafts.push({
          id: scheme.id,
          name: scheme.name || scheme.schemeCode,
          thickness: reference.thicknessMm,
          kValue: reference.kValue,
          kSource: "REFERENCE_TABLE",
          reasons: ["K 值来自已发布图集热工参考表"],
          sourceRefs: [
            ...sourceRefs,
            { type: "THERMAL_REFERENCE_ROW", id: reference.rowId, label: `${reference.evidenceSource} ${reference.evidenceRef}`.trim() }
          ]
        });
        continue;
      }
      const identity = await (deps.loadSchemeCalcIdentity ?? ((id: string) => defaultLoadSchemeCalcIdentity(app, id)))(scheme.id);
      const engine = deps.runThermalEngine ?? createDefaultThermalEngine(app, request, user);
      const thermal = identity
        ? await engine({
          schemeId: scheme.id,
          productSpecId: identity.productSpecId,
          thicknessMm: identity.thicknessMm,
          projectId
        })
        : null;
      if (thermal) {
        drafts.push({
          id: scheme.id,
          name: scheme.name || scheme.schemeCode,
          thickness: thermal.thicknessMm,
          kValue: thermal.kValue,
          kSource: "THERMAL_ENGINE",
          reasons: ["图集无 K 值，已调用确定性热工计算引擎"],
          sourceRefs: [
            ...sourceRefs,
            { type: "THERMAL_CALC_RECORD", id: thermal.recordId, label: "热工计算记录" }
          ]
        });
        continue;
      }
      drafts.push({
        id: scheme.id,
        name: scheme.name || scheme.schemeCode,
        thickness: identity?.thicknessMm ?? null,
        kSource: "MISSING",
        reasons: ["方案缺少 K 值，热工引擎未能计算，禁止估算或补造"],
        sourceRefs
      });
    }
  }

  if (productIds.length > 0) {
    const products = await (deps.loadProducts ?? ((ids: string[]) => defaultLoadProducts(app, ids)))(productIds);
    const productMap = new Map(products.map((item) => [item.id, item]));
    for (const productId of productIds) {
      const product = productMap.get(productId);
      drafts.push({
        id: productId,
        name: product?.name ?? productId,
        kSource: "MISSING",
        reasons: product
          ? ["产品目录没有传热系数，且无法映射到已发布构造方案，暂时不能给出热工结论"]
          : ["目前缺少该产品的有效资料，暂时无法给出可靠参数"],
        sourceRefs: product
          ? [{ type: "CATALOG_PRODUCT", id: product.id, label: product.name }]
          : []
      });
    }
  }

  if (drafts.length === 0) {
    return freezeComparisonResult(rankCompareCandidates(input.targetK, []));
  }

  return freezeComparisonResult(rankCompareCandidates(input.targetK, drafts));
}

export const compareSolutionService = compareSolutions;

export function toCompareToolOutput(result: ComparisonResult): {
  ok: true;
  comparison: ComparisonResult;
  requiresUserChoice: boolean;
  sources: CompareSourceRef[];
} {
  const passingCount = result.candidates.filter((item) => item.passed).length;
  const sources = result.candidates.flatMap((item) => item.sourceRefs);
  return {
    ok: true,
    comparison: result,
    requiresUserChoice: passingCount > 1,
    sources
  };
}

export function kSourceLabel(source: CompareKSource): string {
  if (source === "REFERENCE_TABLE") return "图集热工参考表";
  if (source === "THERMAL_ENGINE") return "确定性热工计算引擎";
  return "缺失";
}

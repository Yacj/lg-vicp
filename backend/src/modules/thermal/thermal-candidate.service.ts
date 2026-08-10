import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import {
  constructionSchemes,
  insulationSystems,
  productSpecs,
  projects,
  thermalCandidateSelections,
  thermalReferenceRows,
  thermalReferenceSets,
  thermalStandardLimits
} from "../../db/schema.js";
import { getPagination } from "../../shared/pagination.js";
import { NotFoundError } from "../../shared/errors.js";
import { canViewProject } from "../../shared/permissions.js";
import { ThermalError } from "../../shared/thermal-errors.js";
import { publishedReferenceConditions } from "../construction/construction-structure.service.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { listPublishedThermalSets } from "./thermal-read.service.js";
import {
  type CandidateQueryConditions,
  type CandidateResult,
  type CandidateRow,
  matchThermalCandidates
} from "./thermal-candidate-matcher.js";
import type { AuthUser } from "../../shared/auth-user.js";

/**
 * 候选方案查询与条件匹配服务。
 * - 只读已发布且生效中的图集参考集/行（复用 publishedReferenceConditions），禁止读取草稿或待审核数据。
 * - 地区/标准限值是合格判定维度：解析为 limitKValue（缺省 targetK），参与合规标注，不过滤行。
 * - 第一版只做图集查表匹配（calculationSource=REFERENCE_TABLE）；图集无结果不自动批量计算。
 * - 候选确认保存查询条件 + 最终候选全快照，历史确认不随后台参数漂移。
 */

/** 候选确认审计动作（audit_logs.action 为 varchar，直接使用稳定字符串） */
const THERMAL_CANDIDATE_SELECTED = "thermal.candidate_selected";

interface LimitSnapshot {
  id: string;
  regionCode: string;
  regionName: string;
  basisCode: string;
  basisName: string;
  clauseRef: string;
  limitKValue: number;
  version: number;
}

/** 按地区解析已发布且生效中的全部标准限值（多标准并存返回全部，按版本倒序；asOfDate 按项目时点判定生效窗） */
async function resolvePublishedLimitsByRegion(
  app: FastifyInstance, regionCode: string, asOfDate = new Date()
): Promise<LimitSnapshot[]> {
  return app.db
    .select()
    .from(thermalStandardLimits)
    .where(and(eq(thermalStandardLimits.regionCode, regionCode), ...publishedReferenceConditions(thermalStandardLimits, asOfDate)))
    .orderBy(desc(thermalStandardLimits.version));
}

/** 按 ID 解析已发布且生效中的标准限值（指定了就必须生效） */
async function resolvePublishedLimitById(app: FastifyInstance, id: string): Promise<LimitSnapshot> {
  const [limit] = await app.db
    .select()
    .from(thermalStandardLimits)
    .where(and(eq(thermalStandardLimits.id, id), ...publishedReferenceConditions(thermalStandardLimits)))
    .limit(1);
  if (!limit) {
    throw new ThermalError("THERMAL_STANDARD_LIMIT_NOT_FOUND", "指定的标准限值不存在或未发布且生效中");
  }
  return limit;
}

const toLimitSnapshot = (limit: LimitSnapshot | null) =>
  limit
    ? {
        id: limit.id,
        regionCode: limit.regionCode,
        regionName: limit.regionName,
        basisCode: limit.basisCode,
        basisName: limit.basisName,
        clauseRef: limit.clauseRef,
        limitKValue: limit.limitKValue,
        version: limit.version
      }
    : null;

interface CandidateQueryInput {
  regionCode?: string;
  standardLimitId?: string;
  buildingType?: string;
  systemId?: string;
  substrateMaterial?: string;
  substrateThickness?: number;
  specClass?: "I" | "II" | "III";
  thicknessMm?: number;
  thicknessMin?: number;
  thicknessMax?: number;
  targetK?: number;
  targetResistance?: number;
  neighborTolerance: number;
  projectId?: string;
  asOfDate?: Date;
}

export interface CandidateQueryOutcome {
  calculationSource: "REFERENCE_TABLE";
  candidates: Array<CandidateResult & { compliant: boolean | null }>;
  missingConditions: string[];
  notes: string[];
  limit: LimitSnapshot | null;
  /** 多标准并存时非空（同地区多份已发布且生效中的限值，须用户选择）；单标准/无限值为 null */
  limitCandidates: LimitSnapshot[] | null;
}

/** 行查询结果 → matcher 输入（扁平化行结构） */
function toCandidateRow(row: Record<string, unknown>): CandidateRow {
  return {
    rowId: String(row.rowId),
    setId: String(row.setId),
    setCode: String(row.setCode),
    setVersion: Number(row.setVersion),
    setPriority: Number(row.setPriority),
    setBuildingTypes: Array.isArray(row.setBuildingTypes) ? (row.setBuildingTypes as string[]) : [],
    schemeId: String(row.schemeId),
    schemeCode: String(row.schemeCode),
    schemeVersion: Number(row.schemeVersion),
    systemId: String(row.systemId),
    systemCode: row.systemCode === null ? null : String(row.systemCode),
    systemName: row.systemName === null ? null : String(row.systemName),
    substrateMaterial: String(row.substrateMaterial),
    substrateThickness: row.substrateThickness === null ? null : Number(row.substrateThickness),
    atlasPage: row.atlasPage === null ? null : String(row.atlasPage),
    productSpecId: String(row.productSpecId),
    specCode: String(row.specCode),
    specVersion: Number(row.specVersion),
    specClass: row.specClass as "I" | "II" | "III",
    thicknessMm: Number(row.thicknessMm),
    productThermalResistance: Number(row.productThermalResistance),
    totalThermalResistance: Number(row.totalThermalResistance),
    kValue: Number(row.kValue),
    evidenceSource: String(row.evidenceSource),
    evidenceRef: String(row.evidenceRef)
  };
}

/**
 * 候选查询：解析限值 → 已发布集行 join 取数 → 纯函数匹配 → 附加合规标注与提示。
 * 只读操作，不落库；图集无结果返回空候选 + 提示，不报错、不自动计算。
 */
export async function queryThermalCandidates(
  app: FastifyInstance,
  _request: FastifyRequest,
  _actor: AuthUser,
  input: CandidateQueryInput
): Promise<CandidateQueryOutcome> {
  const notes: string[] = [];

  // 1) 标准限值解析（合格判定维度；不参与行过滤）
  //    单标准 → limit 生效（targetK 缺省取 limitKValue）；多标准并存 → limitCandidates 返回全部，
  //    不隐式选最严格（K 条件标注缺失，须用户选择 standardLimitId）；无标准 → 提示缺省。
  let limit: LimitSnapshot | null = null;
  let limitCandidates: LimitSnapshot[] | null = null;
  if (input.standardLimitId) {
    limit = await resolvePublishedLimitById(app, input.standardLimitId);
  } else if (input.regionCode) {
    const candidates = await resolvePublishedLimitsByRegion(app, input.regionCode, input.asOfDate ?? new Date());
    if (candidates.length === 1) {
      limit = candidates[0] ?? null;
    } else if (candidates.length > 1) {
      limitCandidates = candidates;
      notes.push(`地区 ${input.regionCode} 存在 ${candidates.length} 份已发布且生效中的标准限值（多标准并存），请选择标准（standardLimitId）后确认`);
    } else {
      notes.push(`地区 ${input.regionCode} 没有已发布且生效中的标准限值，K 条件与合格判定暂缺`);
    }
  }

  // 2) targetK 缺省取限值（显式 targetK 优先）
  const conditions: CandidateQueryConditions = {
    substrateMaterial: input.substrateMaterial,
    substrateThickness: input.substrateThickness,
    systemId: input.systemId,
    specClass: input.specClass,
    thicknessMm: input.thicknessMm,
    thicknessMin: input.thicknessMin,
    thicknessMax: input.thicknessMax,
    targetK: input.targetK ?? limit?.limitKValue,
    targetResistance: input.targetResistance,
    buildingType: input.buildingType
  };

  // 3) 已发布且生效中的参考集
  const sets = await listPublishedThermalSets(app.db);
  if (sets.length === 0) {
    return {
      calculationSource: "REFERENCE_TABLE",
      candidates: [],
      missingConditions: [],
      notes: [...notes, "没有已发布且生效中的图集参考集，无法查表（请先在后台导入并审核发布）"],
      limit: toLimitSnapshot(limit),
      limitCandidates: limitCandidates ? limitCandidates.map((item) => toLimitSnapshot(item)!) : null
    };
  }

  // 4) 集内行 + 方案/系统/规格 join（行引用的是已发布版本行，不会读到草稿）
  const setIds = sets.map((s) => s.id);
  const rows = await app.db
    .select({
      rowId: thermalReferenceRows.id,
      thicknessMm: thermalReferenceRows.thicknessMm,
      productThermalResistance: thermalReferenceRows.productThermalResistance,
      totalThermalResistance: thermalReferenceRows.totalThermalResistance,
      kValue: thermalReferenceRows.kValue,
      evidenceSource: thermalReferenceRows.evidenceSource,
      evidenceRef: thermalReferenceRows.evidenceRef,
      schemeId: constructionSchemes.id,
      schemeCode: constructionSchemes.schemeCode,
      schemeVersion: constructionSchemes.version,
      substrateMaterial: constructionSchemes.substrateMaterial,
      substrateThickness: constructionSchemes.substrateThickness,
      atlasPage: constructionSchemes.atlasPage,
      systemId: insulationSystems.id,
      systemCode: insulationSystems.code,
      systemName: insulationSystems.name,
      productSpecId: productSpecs.id,
      specCode: productSpecs.specCode,
      specVersion: productSpecs.version,
      specClass: productSpecs.specClass,
      setId: thermalReferenceSets.id,
      setCode: thermalReferenceSets.code,
      setVersion: thermalReferenceSets.version,
      setPriority: thermalReferenceSets.priority,
      setBuildingTypes: thermalReferenceSets.buildingTypes
    })
    .from(thermalReferenceRows)
    .innerJoin(constructionSchemes, eq(thermalReferenceRows.schemeId, constructionSchemes.id))
    .innerJoin(insulationSystems, eq(constructionSchemes.systemId, insulationSystems.id))
    .innerJoin(productSpecs, eq(thermalReferenceRows.productSpecId, productSpecs.id))
    .innerJoin(thermalReferenceSets, eq(thermalReferenceRows.setId, thermalReferenceSets.id))
    .where(inArray(thermalReferenceRows.setId, setIds));

  // 5) 纯函数匹配（含相邻规格与排序）
  const outcome = matchThermalCandidates(rows.map(toCandidateRow), conditions, {
    neighborTolerance: input.neighborTolerance
  });

  // 6) 合规标注（与解析出的限值比较，K 判定口径）与提示
  const candidates = outcome.candidates.map((c) => ({
    ...c,
    compliant: limit ? c.result.kValue <= limit.limitKValue : null
  }));
  const hasThicknessCondition = input.thicknessMm !== undefined || input.thicknessMin !== undefined || input.thicknessMax !== undefined;
  if (candidates.length === 0) {
    if (hasThicknessCondition && input.thicknessMm !== undefined && input.neighborTolerance > 0) {
      notes.push(`没有该厚度档的已发布图集行，相邻容差 ${input.neighborTolerance} 档内也没有满足其余条件的规格`);
    } else if (hasThicknessCondition) {
      notes.push("没有满足条件的已发布图集行；如需相邻规格请调整 neighborTolerance");
    } else {
      notes.push("没有满足条件的已发布图集行");
    }
  } else if (outcome.candidates.some((c) => c.matchType === "NEIGHBOR")) {
    notes.push("包含相邻已发布规格（matchType=NEIGHBOR），请确认厚度档后自行选择");
  }

  // 7) 多标准并存且未显式给 targetK：K 条件标缺失（不隐式选最严格，与 matcher 语义一致）
  const missingConditions = [...outcome.globalMissingConditions];
  if (limitCandidates && input.targetK === undefined && !missingConditions.includes("targetK")) {
    missingConditions.push("targetK");
  }

  return {
    calculationSource: "REFERENCE_TABLE",
    candidates,
    missingConditions,
    notes,
    limit: toLimitSnapshot(limit),
    limitCandidates: limitCandidates ? limitCandidates.map((item) => toLimitSnapshot(item)!) : null
  };
}

// ---------------------------------------------------------------- 候选确认记录

export interface CandidateSelectionInput {
  query: Record<string, unknown>;
  candidate: Record<string, unknown>;
  selectionReason?: string;
  projectId?: string;
}

function toSelectionDto(record: (typeof thermalCandidateSelections.$inferSelect) | null) {
  if (!record) return null;
  return {
    id: record.id,
    requestId: record.requestId,
    projectId: record.projectId,
    query: record.queryJson,
    candidate: record.candidateJson,
    selectionReason: record.selectionReason,
    selectedById: record.selectedById,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

/**
 * 保存用户确认的最终候选与选择理由：
 * - 校验候选行存在且属于已发布且生效中的参考集（禁止确认草稿/待审核数据）；
 * - 项目 ID 提供时校验项目可见性；确认与审计同事务写入。
 */
export async function createCandidateSelection(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  input: CandidateSelectionInput
) {
  const candidateId = String(input.candidate.candidateId ?? "");
  if (!candidateId) throw new ThermalError("THERMAL_ENTITY_NOT_FOUND", "确认的候选缺少 candidateId");

  // 1) 项目可见性
  if (input.projectId) {
    const [project] = await app.db
      .select({ id: projects.id, createdById: projects.createdById, visibility: projects.visibility })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project || !canViewProject(actor, project)) {
      throw new NotFoundError("项目不存在或无权查看");
    }
  }

  // 2) 候选行必须属于已发布且生效中的参考集
  const [row] = await app.db
    .select({ id: thermalReferenceRows.id })
    .from(thermalReferenceRows)
    .innerJoin(thermalReferenceSets, eq(thermalReferenceRows.setId, thermalReferenceSets.id))
    .where(and(eq(thermalReferenceRows.id, candidateId), ...publishedReferenceConditions(thermalReferenceSets)))
    .limit(1);
  if (!row) {
    throw new ThermalError("THERMAL_REFERENCE_NOT_PUBLISHED", "确认的候选不在已发布且生效中的图集参考集内");
  }

  // 3) 快照落库 + 审计（同事务）
  const created = await app.db.transaction(async (tx) => {
    const [record] = await tx
      .insert(thermalCandidateSelections)
      .values({
        requestId: request.id,
        projectId: input.projectId ?? null,
        queryJson: input.query,
        candidateJson: input.candidate,
        selectionReason: input.selectionReason ?? null,
        selectedById: actor.id
      })
      .returning();
    await writeAuditLog({
      db: tx,
      request,
      actor,
      action: THERMAL_CANDIDATE_SELECTED,
      targetType: "thermal_candidate_selection",
      targetId: record!.id,
      afterJson: { candidateId, projectId: input.projectId ?? null }
    });
    return record!;
  });

  return toSelectionDto(created)!;
}

/** 候选确认记录分页查询（projectId 可选筛选） */
export async function listCandidateSelections(
  app: FastifyInstance,
  query: { page: number; pageSize: number; projectId?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = query.projectId ? eq(thermalCandidateSelections.projectId, query.projectId) : undefined;
  const [items, [totalRow]] = await Promise.all([
    app.db
      .select()
      .from(thermalCandidateSelections)
      .where(where)
      .orderBy(desc(thermalCandidateSelections.createdAt))
      .offset(skip)
      .limit(take),
    app.db.select({ value: count() }).from(thermalCandidateSelections).where(where)
  ]);
  return {
    items: items.map((r) => toSelectionDto(r)!),
    total: totalRow?.value ?? 0,
    page: query.page,
    pageSize: query.pageSize
  };
}
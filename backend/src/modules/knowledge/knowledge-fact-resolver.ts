/**
 * 确定性参数 resolver：优先 VERIFIED Knowledge Fact，缺省 fallback Legacy Product Data。
 * 新代码统一走本文件，不要再直接查询 product/material 表。
 */
import type { DbExecutor } from "../../db/client.js";
import {
  listPublishedMaterialParameters,
  listPublishedProductParameters,
  type PublishedParameterQuery
} from "../masterdata/md-read.service.js";
import { getPublishedConstructionSchemeDetail } from "../construction/construction-read.service.js";
import { thermalStandardLimits, type ProductParameter } from "../../db/schema.js";
import { and, desc, eq } from "drizzle-orm";
import { publishedReferenceConditions } from "../construction/construction-structure.service.js";
import { listVerifiedKnowledgeFacts } from "./knowledge-fact.service.js";

export type ResolverSource = "KNOWLEDGE_FACT" | "LEGACY_PRODUCT";

export interface ResolvedMaterialFact {
  resolverSource: ResolverSource;
  id: string;
  version: number;
  materialId: string;
  thermalConductivity: number;
  correctionFactor: number | null;
  evidenceSource: string | null;
  evidenceRef: string | null;
  evidenceLevel: string | null;
  sourceDocumentId?: string | null;
  sourcePageLabel?: string | null;
}

export interface ResolvedThermalParameter extends ProductParameter {
  resolverSource: ResolverSource;
  sourceDocumentId?: string | null;
  sourcePageLabel?: string | null;
}

export interface ResolvedStandardLimit {
  resolverSource: ResolverSource;
  id: string;
  regionCode: string;
  version: number;
  regionName: string | null;
  basisCode: string | null;
  basisName: string | null;
  clauseRef: string | null;
  limitKValue: number;
  evidenceSource: string | null;
  evidenceRef: string | null;
  evidenceLevel: string | null;
  sourceDocumentId?: string | null;
  sourcePageLabel?: string | null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

export async function resolveMaterialFacts(
  db: DbExecutor,
  query: { materialId?: string; subject?: string; usage?: string }
): Promise<ResolvedMaterialFact[]> {
  const subject = query.subject ?? query.materialId;
  if (subject) {
    const facts = await listVerifiedKnowledgeFacts(db, { factType: "MATERIAL", subject });
    const mapped = facts.flatMap((fact) => {
      const lambda = asNumber(fact.data.thermalConductivity ?? fact.data.lambda);
      if (lambda === null) return [];
      return [{
        resolverSource: "KNOWLEDGE_FACT" as const,
        id: fact.id,
        version: asNumber(fact.data.version) ?? 1,
        materialId: asString(fact.data.materialId) ?? subject,
        thermalConductivity: lambda,
        correctionFactor: asNumber(fact.data.correctionFactor),
        evidenceSource: asString(fact.data.evidenceSource),
        evidenceRef: asString(fact.data.evidenceRef) ?? fact.sourcePageLabel,
        evidenceLevel: asString(fact.data.evidenceLevel),
        sourceDocumentId: fact.sourceDocumentId,
        sourcePageLabel: fact.sourcePageLabel
      }];
    });
    if (mapped.length > 0) return mapped;
  }
  const rows = await listPublishedMaterialParameters(db, {
    materialId: query.materialId,
    usage: query.usage
  });
  return rows.map((row) => ({
    resolverSource: "LEGACY_PRODUCT" as const,
    id: row.id,
    version: row.version,
    materialId: row.materialId,
    thermalConductivity: row.thermalConductivity,
    correctionFactor: row.correctionFactor,
    evidenceSource: row.evidenceSource,
    evidenceRef: row.evidenceRef,
    evidenceLevel: row.evidenceLevel,
    sourceDocumentId: null,
    sourcePageLabel: null
  }));
}

export async function resolveThermalParameter(
  db: DbExecutor,
  query: PublishedParameterQuery & { subject?: string }
): Promise<ResolvedThermalParameter[]> {
  const subject = query.subject ?? query.specId;
  const factType = query.parameterCode ? "THERMAL_PARAMETER" as const : "PRODUCT_SPEC" as const;
  if (subject) {
    const facts = await listVerifiedKnowledgeFacts(db, { factType, subject });
    const mapped = facts.flatMap((fact) => {
      const value = asNumber(fact.data.value ?? fact.data.kValue ?? fact.data.thermalConductivity);
      const parameterCode = asString(fact.data.parameterCode) ?? query.parameterCode;
      if (value === null || !parameterCode) return [];
      if (query.parameterCode && parameterCode !== query.parameterCode) return [];
      return [{
        resolverSource: "KNOWLEDGE_FACT" as const,
        id: fact.id,
        specId: asString(fact.data.specId) ?? subject,
        parameterCode,
        parameterName: asString(fact.data.parameterName) ?? parameterCode,
        paramSource: (asString(fact.data.paramSource) ?? "ATLAS") as ProductParameter["paramSource"],
        version: asNumber(fact.data.version) ?? 1,
        value,
        unit: asString(fact.data.unit),
        allowedUsage: Array.isArray(fact.data.allowedUsage) ? fact.data.allowedUsage as string[] : [],
        applicableScope: asString(fact.data.applicableScope),
        testReportFileId: null,
        changeNote: null,
        evidenceSource: asString(fact.data.evidenceSource),
        evidenceRef: asString(fact.data.evidenceRef) ?? fact.sourcePageLabel,
        evidenceLevel: (asString(fact.data.evidenceLevel) ?? "A") as ProductParameter["evidenceLevel"],
        effectiveAt: null,
        expiresAt: null,
        status: "PUBLISHED" as ProductParameter["status"],
        submittedById: null,
        submittedAt: null,
        approvedById: null,
        approvedAt: null,
        rejectedById: null,
        rejectedAt: null,
        rejectReason: null,
        publishedById: null,
        publishedAt: null,
        approvalNote: null,
        createdById: null,
        updatedById: null,
        createdAt: fact.createdAt,
        updatedAt: fact.updatedAt,
        sourceDocumentId: fact.sourceDocumentId,
        sourcePageLabel: fact.sourcePageLabel
      } satisfies ResolvedThermalParameter];
    });
    if (mapped.length > 0) return mapped;
  }
  const rows = await listPublishedProductParameters(db, query);
  return rows.map((row) => ({ ...row, resolverSource: "LEGACY_PRODUCT" as const, sourceDocumentId: null, sourcePageLabel: null }));
}

export async function resolveConstructionFacts(
  db: DbExecutor,
  query: { schemeId: string; subject?: string }
) {
  const subject = query.subject ?? query.schemeId;
  const facts = await listVerifiedKnowledgeFacts(db, { factType: "CONSTRUCTION", subject });
  const scheme = await getPublishedConstructionSchemeDetail(db, query.schemeId);
  return {
    resolverSource: facts.length > 0 ? "KNOWLEDGE_FACT" as const : "LEGACY_PRODUCT" as const,
    facts,
    scheme,
    sourceDocumentId: facts[0]?.sourceDocumentId ?? null
  };
}

export async function resolveStandardLimit(
  db: DbExecutor,
  query: { regionCode?: string }
): Promise<ResolvedStandardLimit | null> {
  if (!query.regionCode) return null;
  const facts = await listVerifiedKnowledgeFacts(db, { factType: "STANDARD_LIMIT", subject: query.regionCode });
  for (const fact of facts) {
    const limitKValue = asNumber(fact.data.kValue ?? fact.data.limitKValue);
    if (limitKValue === null) continue;
    return {
      resolverSource: "KNOWLEDGE_FACT",
      id: fact.id,
      regionCode: asString(fact.data.regionCode) ?? query.regionCode,
      version: asNumber(fact.data.version) ?? 1,
      regionName: asString(fact.data.regionName),
      basisCode: asString(fact.data.basisCode),
      basisName: asString(fact.data.basisName),
      clauseRef: asString(fact.data.clauseRef),
      limitKValue,
      evidenceSource: asString(fact.data.evidenceSource),
      evidenceRef: asString(fact.data.evidenceRef) ?? fact.sourcePageLabel,
      evidenceLevel: asString(fact.data.evidenceLevel),
      sourceDocumentId: fact.sourceDocumentId,
      sourcePageLabel: fact.sourcePageLabel
    };
  }
  const [limit] = await db.select().from(thermalStandardLimits)
    .where(and(
      eq(thermalStandardLimits.regionCode, query.regionCode),
      ...publishedReferenceConditions(thermalStandardLimits)
    ))
    .orderBy(desc(thermalStandardLimits.version)).limit(1);
  if (!limit) return null;
  return {
    resolverSource: "LEGACY_PRODUCT",
    id: limit.id,
    regionCode: limit.regionCode,
    version: limit.version,
    regionName: limit.regionName,
    basisCode: limit.basisCode,
    basisName: limit.basisName,
    clauseRef: limit.clauseRef,
    limitKValue: limit.limitKValue,
    evidenceSource: limit.evidenceSource,
    evidenceRef: limit.evidenceRef,
    evidenceLevel: limit.evidenceLevel,
    sourceDocumentId: null,
    sourcePageLabel: null
  };
}

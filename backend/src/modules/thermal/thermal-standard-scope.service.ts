import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { standardApplicability, standardDocuments, thermalStandardLimits } from "../../db/schema.js";
import { publishedReferenceConditions } from "../construction/construction-structure.service.js";
import type { ResolvedStandardLimit } from "../knowledge/knowledge-fact-resolver.js";
import { normalizeEntityText, type ThermalQueryState } from "./thermal-query-state.js";

/** 标准 ID、地区、建筑类型全部明确，并能从正式标准适用范围证明，才授权合规事实。 */
export async function resolveScopedThermalStandard(db: DbExecutor, query: Pick<ThermalQueryState, "regionCode" | "buildingType" | "standardLimitId" | "structureType">): Promise<{ limit: ResolvedStandardLimit | null; reason?: string }> {
  if (!query.regionCode || !query.buildingType || !query.standardLimitId) return { limit: null, reason: "请确认地区、建筑类型和具体标准版本后判断合规。" };
  const [limit] = await db.select().from(thermalStandardLimits).where(and(eq(thermalStandardLimits.id, query.standardLimitId),
    eq(thermalStandardLimits.regionCode, query.regionCode), ...publishedReferenceConditions(thermalStandardLimits))).limit(1);
  if (!limit?.standardDocumentId) return { limit: null, reason: "所选标准没有可核验的正式适用范围，暂不能判断合规。" };
  const scopes = await db.select({ buildingTypes: standardApplicability.buildingTypes, structureTypes: standardApplicability.structureTypes }).from(standardApplicability)
    .innerJoin(standardDocuments, eq(standardApplicability.documentId, standardDocuments.id)).where(and(eq(standardApplicability.documentId, limit.standardDocumentId),
    eq(standardApplicability.regionCode, query.regionCode), ...publishedReferenceConditions(standardApplicability), ...publishedReferenceConditions(standardDocuments)));
  if (!scopes.some(scope => scope.buildingTypes.some(type => normalizeEntityText(type) === normalizeEntityText(query.buildingType!))))
    return { limit: null, reason: "所选标准适用范围无法证明覆盖当前地区及建筑类型，请确认适用依据。" };
  if (!scopes.some(scope => scope.buildingTypes.some(type => normalizeEntityText(type) === normalizeEntityText(query.buildingType!))
    && (scope.structureTypes.length === 0 || !!query.structureType && scope.structureTypes.some(type => normalizeEntityText(type) === normalizeEntityText(query.structureType!)))))
    return { limit: null, reason: "所选标准限制了结构类型，请确认结构类型及适用依据。" };
  return { limit: { ...limit, resolverSource: "LEGACY_PRODUCT", sourceDocumentId: limit.standardDocumentId, sourcePageLabel: null } };
}

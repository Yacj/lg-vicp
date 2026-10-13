import { and, eq, inArray } from "drizzle-orm";
import { thermalReferenceRows, thermalReferenceSets, constructionSchemes, insulationSystems, productSpecs, thermalCalcRecords } from "../../db/schema.js";
import { publishedReferenceConditions } from "../construction/construction-structure.service.js";
import type { DbExecutor } from "../../db/client.js";
import type { ReferenceLookupCandidate } from "./conversation-task.js";

/** 只核验当前引用行及发布关系，不做候选筛选、重排或revision写入。 */
export async function referenceRowsStillCurrent(db: DbExecutor, candidates: readonly ReferenceLookupCandidate[], scope?: { userId: string; projectId: string | null }): Promise<boolean> {
  const calculated = candidates.filter(candidate => candidate.sourceType === "CALCULATED");
  for (const candidate of calculated) {
    if (!scope || !candidate.calculationId) return false;
    const [record] = await db.select().from(thermalCalcRecords).where(and(eq(thermalCalcRecords.id, candidate.calculationId), eq(thermalCalcRecords.createdById, scope.userId))).limit(1);
    if (!record || record.projectId !== scope.projectId || JSON.stringify(record.inputJson) !== JSON.stringify(candidate.inputSnapshot)
      || JSON.stringify(record.resultJson) !== JSON.stringify(candidate.resultSnapshot)) return false;
  }
  const reference = candidates.filter(candidate => candidate.referenceKind !== "KNOWLEDGE_PAGE" && candidate.sourceType !== "CALCULATED");
  if (!reference.length) return true;
  const rows = await db.select({ row: thermalReferenceRows, scheme: constructionSchemes, spec: productSpecs, thermalCalcRecords })
    .from(thermalReferenceRows).innerJoin(thermalReferenceSets, eq(thermalReferenceRows.setId, thermalReferenceSets.id))
    .innerJoin(constructionSchemes, eq(thermalReferenceRows.schemeId, constructionSchemes.id))
    .innerJoin(insulationSystems, eq(constructionSchemes.systemId, insulationSystems.id))
    .innerJoin(productSpecs, eq(thermalReferenceRows.productSpecId, productSpecs.id))
    .where(and(inArray(thermalReferenceRows.id, reference.map(candidate => candidate.id)),
      ...publishedReferenceConditions(thermalReferenceSets), ...publishedReferenceConditions(constructionSchemes),
      ...publishedReferenceConditions(insulationSystems), ...publishedReferenceConditions(productSpecs)));
  return reference.every(candidate => {
    const current = rows.find(({ row }) => row.id === (candidate.id));
    return Boolean(current && (["schemeId", "productSpecId", "catalogProductId", "thicknessMm", "kValue", "productThermalResistance", "totalThermalResistance", "sourceDocumentId", "sourcePageId"] as const)
      .every(key => (current.row[key] ?? null) === (candidate[key] ?? null))
      && current.scheme.systemId === candidate.systemId && current.scheme.schemeCode === candidate.schemeCode
      && current.scheme.substrateMaterial === candidate.substrateMaterial && current.scheme.substrateThickness === (candidate.substrateThickness ?? null)
      && (current.spec.specClass ?? null) === (candidate.specClass ?? null));
  });
}

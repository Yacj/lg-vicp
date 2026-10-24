import { and, eq, inArray } from "drizzle-orm";
import { thermalReferenceRows, thermalReferenceSets, constructionSchemes, insulationSystems, productSpecs, thermalCalcRecords } from "../../db/schema.js";
import { publishedReferenceConditions } from "../construction/construction-structure.service.js";
import type { DbExecutor } from "../../db/client.js";
import type { ReferenceLookupCandidate } from "./conversation-task.js";
import { hasPublishedReferenceSource, publishedReferenceSource } from "./published-reference-source.js";
import { publishedConstructionLayersStillCurrent } from "./published-construction-layers.js";
import { publishedSystemApplicationPart } from "../thermal/published-system-scope.js";

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
  const rows = await db.select({ row: thermalReferenceRows, scheme: constructionSchemes, spec: productSpecs, set: thermalReferenceSets, system: insulationSystems })
    .from(thermalReferenceRows).innerJoin(thermalReferenceSets, eq(thermalReferenceRows.setId, thermalReferenceSets.id))
    .innerJoin(constructionSchemes, eq(thermalReferenceRows.schemeId, constructionSchemes.id))
    .innerJoin(insulationSystems, eq(constructionSchemes.systemId, insulationSystems.id))
    .innerJoin(productSpecs, eq(thermalReferenceRows.productSpecId, productSpecs.id))
    .where(and(inArray(thermalReferenceRows.id, reference.map(candidate => candidate.id)),
      ...publishedReferenceConditions(thermalReferenceSets), ...publishedReferenceConditions(constructionSchemes),
      ...publishedReferenceConditions(insulationSystems), ...publishedReferenceConditions(productSpecs)));
  const currentRows = reference.every(candidate => {
    const current = rows.find(({ row }) => row.id === (candidate.id));
    if (candidate.applicationPart != null && (!current || candidate.applicationPart !== publishedSystemApplicationPart(current.system.systemType)
      || candidate.systemType !== current.system.systemType || candidate.systemVersion !== current.system.version)) return false;
    if (candidate.publishedReferenceSource && (!hasPublishedReferenceSource(candidate) || !current || !current.set
      || publishedReferenceSource({ ...candidate, ...current.row, setVersion: current.set.version, setCode: current.set.code,
        schemeVersion: current.scheme.version, schemeCode: current.scheme.schemeCode,
        substrateMaterial: current.scheme.substrateMaterial, substrateThickness: current.scheme.substrateThickness,
        systemId: current.system.id, systemCode: current.system.code, systemName: current.system.name,
        specVersion: current.spec.version, specCode: current.spec.specCode })?.contentHash !== candidate.publishedReferenceSource.contentHash)) return false;
    return Boolean(current && (["schemeId", "productSpecId", "catalogProductId", "thicknessMm", "kValue", "productThermalResistance", "totalThermalResistance", "sourceDocumentId", "sourcePageId"] as const)
      .every(key => (current.row[key] ?? null) === (candidate[key] ?? null))
      && current.scheme.systemId === candidate.systemId && current.scheme.schemeCode === candidate.schemeCode
      && (candidate.schemeName === undefined || current.scheme.name === candidate.schemeName)
      && current.scheme.substrateMaterial === candidate.substrateMaterial && current.scheme.substrateThickness === (candidate.substrateThickness ?? null)
      && (current.spec.specClass ?? null) === (candidate.specClass ?? null));
  });
  if (!currentRows) return false;
  for (const candidate of reference) if (!await publishedConstructionLayersStillCurrent(db, candidate)) return false;
  return true;
}

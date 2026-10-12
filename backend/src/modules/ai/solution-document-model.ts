import type { solutionSnapshots } from "../../db/schema.js";

/** 后续报告唯一输入契约。此转换不允许查询数据库、重算工程值或调用模型。 */
export function toSolutionDocumentModel(snapshot: typeof solutionSnapshots.$inferSelect) {
  const value = structuredClone(snapshot);
  return { schemaVersion: 1 as const, solutionSnapshotId: value.id, confirmedBy: value.confirmedBy, confirmedAt: value.confirmedAt,
    project: value.payload.projectSnapshot, requirements: value.payload.conditionsSnapshot, preferences: value.payload.preferencesSnapshot,
    queryState: value.payload.queryStateSnapshot, solutions: value.payload.candidates, alternatives: value.payload.alternatives,
    comparison: [...value.payload.candidates, ...value.payload.alternatives].map(candidate => ({ candidateId: candidate.candidateId,
      systemName: candidate.systemName, constructionCode: candidate.constructionCode, productId: candidate.productId, productSpecId: candidate.productSpecId,
      thicknessMm: candidate.thicknessMm, productThermalResistance: candidate.productThermalResistance,
      totalThermalResistance: candidate.totalThermalResistance, kValue: candidate.kValue, sourcePageId: candidate.sourcePageId })),
    referencePages: value.payload.referencePages, warnings: value.payload.warnings };
}

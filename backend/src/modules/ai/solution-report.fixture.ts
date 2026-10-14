import type { solutionSnapshots } from "../../db/schema.js";

/** 仅用于隔离Fixture测试，不写入业务数据库，不代表真实客户确认快照。 */
export function confirmedSolutionFixture(): typeof solutionSnapshots.$inferSelect {
  const candidate = { id: "option-a3-1", candidateId: "option-a3-1", sourceType: "REFERENCE" as const,
    referenceKind: "KNOWLEDGE_PAGE" as const, systemId: "system", systemName: "VICP 外墙外保温系统",
    schemeId: "scheme-a3-1", constructionCode: "A3-1", productSpecId: "spec-iii", productName: "Ⅲ型板",
    specClass: "III" as const, substrateMaterial: "混凝土", substrateThickness: 200, thicknessMm: 45,
    productThermalResistance: 7.5, totalThermalResistance: 8.03, kValue: .1245,
    sourceDocumentId: "document", sourceVersionId: "version", sourcePageId: "page", sourcePageLabel: "A3",
    optionId: "option-a3-1", evidenceSource: "测试图集", evidenceRef: "A3-1" };
  return { id: "00000000-0000-4000-8000-000000000001", solutionStateId: "state", conversationId: "conversation",
    userId: "user", projectId: null, version: 1, confirmedBy: "user", confirmedAt: new Date("2026-10-14T00:00:00Z"),
    payload: { schemaVersion: 1, projectSnapshot: null, queryStateSnapshot: { thicknessMm: 45 }, conditionsSnapshot: { thicknessMm: 45 },
      preferencesSnapshot: {}, candidates: [candidate], alternatives: [], selectedCandidateIds: [candidate.candidateId],
      finalCandidateIds: [candidate.candidateId], recommendedCandidateIds: [], warnings: [], referencePages: [{
        sourcePageId: "page", documentId: "document", versionId: "version", documentTitle: "测试图集（Fixture）", docNumber: "TEST-ATLAS",
        pageLabel: "A3", physicalPageNumber: 7, objectKey: "fixture/page.png", renderModel: { pageLabel: "A3", constructions: [{
          constructionId: "construction-a3-1", constructionCode: "A3-1", systemName: candidate.systemName, baseMaterial: "混凝土",
          baseThicknessMm: 200, layers: [], options: [{ optionId: candidate.optionId, thicknessMm: 45,
            productThermalResistance: 7.5, totalThermalResistance: 8.03, kValue: .1245 }] }] } }] } };
}

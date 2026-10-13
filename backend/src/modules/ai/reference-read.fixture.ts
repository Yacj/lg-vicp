// 仅测试使用的确认来源fixture：用于执行真实renderModel与optionId绑定，不访问数据库。
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
export function referenceReadFixture() {
  const data = { fullText: "", systems: [1, 2, 3].map(i => ({ constructionCode: `A1-${i}`, systemName: "薄抹灰",
    baseMaterial: "钢筋混凝土", baseThicknessMm: 200,
    options: [{ thicknessMm: [18, 20, 25][i - 1], productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: .303 }] })) };
  const model = buildKnowledgePageRenderModel("page", data)!;
  const candidates = data.systems.map((system, i) => ({ id: `row-${i + 1}`, referenceKind: "KNOWLEDGE_PAGE" as const, schemeCode: system.constructionCode,
    systemId: "thin", schemeId: `scheme-${i + 1}`, productSpecId: `spec-${i + 1}`, ...system.options[0],
    substrateMaterial: system.baseMaterial, substrateThickness: system.baseThicknessMm,
    optionId: model.constructions[i]!.options[0]!.optionId, sourcePageId: "page", sourceDocumentId: "doc", sourceVersionId: "version" }));
  const row = { page: { id: "page", documentId: "doc", versionId: "version", physicalPageNumber: 33,
    pageLabel: "A-22", pageLabelSource: "MANUAL", pageLabelVerified: true, metadata: { recognitionStatus: "CONFIRMED", confirmedStructuredData: data } },
    document: { id: "doc", title: "受控测试图集" }, version: { id: "version" } };
  return { candidates, row, model };
}

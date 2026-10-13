import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import type { PageRecognitionResult } from "../../shared/page-recognition.js";

/** 仅供回归：任务给定的四条完整确认档位，产品层R采用本次已核验值3。 */
export function solutionAdviceFixture() {
  const entries = [["A3-1", "钢筋混凝土", 200, 3.313, .302], ["A3-2", "混凝土空心砌块", 190, 3.398, .294],
    ["外墙A3-3", "蒸压灰砂砖", 240, 3.416, .293], ["外墙A3-4", "加气混凝土砌块", 200, 4.040, .248]] as const;
  const rows = [5, 6].map((number, index) => {
    const data: PageRecognitionResult = { pageTitle: "Ⅲ型VICP薄抹灰外保温系统", fullText: "", systems: entries.slice(index * 2, index * 2 + 2)
      .map(([constructionCode, baseMaterial, baseThicknessMm, totalThermalResistance, kValue]) => ({ constructionCode, baseMaterial, baseThicknessMm,
        systemName: constructionCode, specClass: "III", options: [{ thicknessMm: 45, productThermalResistance: 3, totalThermalResistance, kValue }] })) };
    const page = { id: `advice-page-${number}`, documentId: "advice-doc", versionId: "advice-version", physicalPageNumber: number,
      pageLabel: String(number), pageLabelSource: "MANUAL", pageLabelVerified: true, metadata: { recognitionStatus: "CONFIRMED", confirmedStructuredData: data } };
    return { page, model: buildKnowledgePageRenderModel(page.id, data)!, document: { id: page.documentId, title: "受控模拟图集", projectId: null,
      currentVersionId: page.versionId, status: "ACTIVE", deletedAt: null }, version: { id: page.versionId, status: "PUBLISHED", usageMode: "AI_ENABLED" } };
  });
  return { rows };
}

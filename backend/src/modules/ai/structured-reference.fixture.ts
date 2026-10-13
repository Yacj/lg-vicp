import type { PageRecognitionResult } from "../../shared/page-recognition.js";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";

/** 两页业务复现；双R/K的已知值来自任务，产品层R只是完整记录的模拟值，不代表线上资料。 */
export function structuredReferenceFixture() {
  const entries = [
    ["A3-1", "钢筋混凝土", 3.313, 0.302],
    ["A3-2", "混凝土空心砌块", 3.398, 0.294],
    ["外墙A3-3", "蒸压灰砂砖", 3.416, 0.293],
    ["外墙A3-4", "加气混凝土砌块", 4.040, 0.248]
  ] as const;
  return [5, 6].map((number, index) => {
    const data: PageRecognitionResult = { pageTitle: "Ⅲ型VICP薄抹灰外保温系统", pageLabel: String(number), fullText: "旧OCR错误K=0.999", systems:
      entries.slice(index * 2, index * 2 + 2).map(([constructionCode, baseMaterial, totalThermalResistance, kValue]) => ({
        constructionCode, baseMaterial, baseThicknessMm: 190, systemName: "Ⅲ型VICP薄抹灰外保温系统", specClass: "III",
        options: [
          { thicknessMm: 45, productThermalResistance: 3.1, totalThermalResistance, kValue },
          { thicknessMm: 40, productThermalResistance: 2.8, totalThermalResistance: 3, kValue: 0.333 },
          { thicknessMm: 50, productThermalResistance: 3.5, totalThermalResistance: 4.1, kValue: 0.244 },
          ...(constructionCode === "A3-2" ? [{ thicknessMm: 18, productThermalResistance: 1.3, totalThermalResistance: 1.598, kValue: 0.626 }] : [])
        ]
      })) };
    const page = { id: `fixture-page-${number}`, versionId: "fixture-version", documentId: "fixture-document", physicalPageNumber: number,
      pageLabel: String(number), pageImageObjectKey: `fixtures/${number}.png`, metadata: { confirmedStructuredData: data } };
    return { page, data, model: buildKnowledgePageRenderModel(page.id, data)!, systemId: null };
  });
}

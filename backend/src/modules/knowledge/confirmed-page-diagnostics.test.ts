import "dotenv/config";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import type { PageRecognitionResult } from "../../shared/page-recognition.js";
import { inspectConfirmedPageFacts } from "./confirmed-page-facts.js";
import { matchConfirmedPageOptions } from "./knowledge-test-reference.js";
function roof() {
  const data = JSON.parse(readFileSync(new URL("../../../tests/fixtures/complex-atlas/page-90.json", import.meta.url), "utf8")).data as PageRecognitionResult;
  const page = { id: "p", documentId: "d", versionId: "v" };
  return { page, data, model: buildKnowledgePageRenderModel(page.id, data)! };
}
describe("确认页失败诊断与完整构造身份", () => {
  it("缺完整产品R与芯层/材料层R分开，不补值或伪造正式ID", () => {
    const s = roof(), before = JSON.stringify(s.data);
    const result = inspectConfirmedPageFacts([s], { filters: [{ metric: "PRODUCT_R", targetValue: .3, mode: "APPROX" }] });
    expect(result.facts).toEqual([]); expect(result.diagnostics.missingMetrics).toContain("PRODUCT_R");
    expect(result.diagnostics.issues).toContain("METRIC_SCOPE_DIFFERENT");
    expect(result.diagnostics.metricScopes.some(scope => scope.metric === "PRODUCT_R")).toBe(false);
    expect(result.all.every(fact => !fact.queryFacts?.schemeId && !fact.queryFacts?.productSpecId)).toBe(true);
    expect(JSON.stringify(s.data)).toBe(before);
  });
  it("只读K查询可消费缺完整产品R的确认记录，仍保留正倒置身份", () => {
    const s = roof();
    const result = inspectConfirmedPageFacts([s], { thicknessMm: 20, filters: [{ metric: "K", targetValue: .186, mode: "EXACT" }] });
    expect(result.facts).toHaveLength(2); expect(result.facts[0]!.option.optionId).not.toBe(result.facts[1]!.option.optionId);
    expect(result.diagnostics.missingMetrics).toEqual([]);
  });
  it("同编号同数值的正倒置构造，不被旧候选去重键合并", () => {
    const data: PageRecognitionResult = { fullText: "", pageTitle: "屋面参考", systems: (["UPRIGHT", "INVERTED"] as const).map(placement => ({
      systemName: "屋面参考", constructionCode: "C1-1", specClass: "I", applicationPart: "ROOF", roofForm: "FLAT", placement,
      baseMaterial: "混凝土", baseThicknessMm: 200, options: [{ thicknessMm: 20, productThermalResistance: 4, totalThermalResistance: 5, kValue: .2 }] })) };
    const page = { id: "p", documentId: "d", versionId: "v" };
    const rows = matchConfirmedPageOptions([{ page, data, model: buildKnowledgePageRenderModel("p", data)! }], "", { filters: [{ metric: "K", targetValue: .2, mode: "EXACT" }] });
    expect(rows).toHaveLength(2); expect(new Set(rows.map(row => row.candidateId)).size).toBe(2);
  });
  it("相同编号/数值但不同层构造保留两条，不靠数值证明身份", () => {
    const data: PageRecognitionResult = { fullText: "", systems: ["混凝土", "砖墙"].map(name => ({ systemName: "薄抹灰", constructionCode: "A1-1", baseMaterial: "混凝土",
      layers: [{ name, thicknessMm: 200 }], options: [{ thicknessMm: 20, productThermalResistance: 4, totalThermalResistance: 5, kValue: .2 }] })) };
    const page = { id: "p", documentId: "d", versionId: "v" };
    expect(matchConfirmedPageOptions([{ page, data, model: buildKnowledgePageRenderModel("p", data)! }], "", { filters: [{ metric: "K", targetValue: .2, mode: "EXACT" }] })).toHaveLength(2);
  });
});

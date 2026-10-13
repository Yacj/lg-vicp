import { describe, expect, it } from "vitest";
import { buildAllowedAnswerFacts, renderAllowedFactsForModel, validateAnswerFacts } from "./thermal-answer-validation.js";
const candidates = [
  { id: "1", schemeCode: "A3-1", specClass: "III" as const, substrateMaterial: "钢筋混凝土", substrateThickness: 200, thicknessMm: 45, totalThermalResistance: 3.313, kValue: .302 },
  { id: "2", schemeCode: "A3-2", specClass: "III" as const, substrateMaterial: "混凝土空心砌块", substrateThickness: 190, thicknessMm: 45, totalThermalResistance: 3.398, kValue: .294 },
  { id: "4", schemeCode: "A3-4", specClass: "III" as const, substrateMaterial: "加气混凝土砌块", substrateThickness: 200, thicknessMm: 45, totalThermalResistance: 4.04, kValue: .248 },
  { id: "a2", schemeCode: "A2-1", specClass: "II" as const, substrateMaterial: "钢筋混凝土", substrateThickness: 200, thicknessMm: 30, totalThermalResistance: 3.313, kValue: .302 }
];
describe("同候选基层与热工事实绑定", () => {
  const facts = buildAllowedAnswerFacts({}, candidates, "全部详细参数");
  it.each([
    "加气混凝土200mm，板45mm，K=0.294，R₀=3.398。",
    "A3-2，基层加气混凝土砌块200mm，板45mm，K=0.294，R₀=3.398。",
    "加气混凝土200mm；方案 A3-2，板45mm，K=0.294。",
    "基层加气混凝土砌块200mm\n板厚度45mm\nK=0.294，R₀=3.398。",
    "A3-2，基层混凝土空心砌块45mm，板190mm，K=0.294。",
    "A2-1，Ⅲ型，钢筋混凝土200mm，板30mm，K=0.302。",
    "A3-2，板190mm，K=0.294。",
    "A3-2，基层木材，厚度45mm，K=0.294。",
    "A3-2是最薄方案，K=0.294。"
  ])("拒绝%s", answer => expect(validateAnswerFacts(answer, facts).passed).toBe(false));
  it.each([
    "A3-2，Ⅲ型，混凝土空心砌块190mm，板45mm，K=0.294，R₀=3.398。",
    "加气砌块200mm，板45mm，K=0.248，R₀=4.040。",
    "蒸压加气混凝土砌块200mm，板45mm，K=0.248，R₀=4.040。",
    "A3-1，钢筋砼200mm，板45mm，K=0.302，R₀=3.313。"
  ])("接受同一条事实%s", answer => expect(validateAnswerFacts(answer, facts).passed).toBe(true));
  it("模型事实与Canonical带同一基层，缺失基层不能补写", () => {
    expect(renderAllowedFactsForModel(facts)).toContain("基层材料 混凝土空心砌块");
    expect(facts.canonicalAnswers[0]).toContain("基层 钢筋混凝土 200 mm");
    expect(validateAnswerFacts("A1-1，基层钢筋混凝土200mm，板45mm，K=0.294。", buildAllowedAnswerFacts({}, [{ id: "missing", schemeCode: "A1-1", thicknessMm: 45, kValue: .294 }])).passed).toBe(false);
  });
});

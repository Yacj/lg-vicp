import { describe, expect, it } from "vitest";
import { buildAllowedAnswerFacts, renderAllowedFactsForModel, setThermalAnswerFacts, validateAnswerFacts, REFERENCE_LOOKUP_ANSWER_SYSTEM_PROMPT } from "./thermal-answer-validation.js";
import { extractSemanticFacts, segmentAnswer, answerHasForbiddenClaim } from "./thermal-answer-semantics.js";
import type { ReferenceLookupCandidate } from "./conversation-task.js";

const candidate: ReferenceLookupCandidate = {
  id: "A4-1-60", schemeCode: "A4-1", specCode: "SP-A4", thicknessMm: 60,
  productThermalResistance: 8.000, totalThermalResistance: 8.313, kValue: 0.120,
  lambda: 0.005, alpha: 1.25, sourcePageLabel: "33", evidenceSource: "正式图集"
};

const allowed = () => buildAllowedAnswerFacts({ metric: "TOTAL_R", targetValue: 8.3, mode: "APPROX" }, [candidate], "");

describe("语义事实抽取", () => {
  it("只抽取带语义标签的事实，裸数字不参与", () => {
    const facts = extractSemanticFacts("有3条，A4-1的60mm双层方案，板自身R=8.000，整墙R₀=8.313，K=0.120，λ=0.005，α=1.25，印刷页码33");
    expect(facts).toEqual(expect.arrayContaining([
      { kind: "metric", metric: "PRODUCT_R", value: 8 },
      { kind: "metric", metric: "TOTAL_R", value: 8.313 },
      { kind: "metric", metric: "K", value: 0.12 },
      { kind: "metric", metric: "LAMBDA", value: 0.005 },
      { kind: "metric", metric: "ALPHA", value: 1.25 },
      { kind: "thickness", value: 60 },
      { kind: "page", label: "33" }
    ]));
    // 「3条」是无标签裸数字，不产生事实
    expect(facts.filter(fact => fact.kind === "metric" && fact.value === 3)).toHaveLength(0);
  });
  it("出现方案/规格编码即切段，段内事实归属同一条候选", () => {
    const segments = segmentAnswer("方案 S-A；厚度 60 mm；K=0.12。\n方案 S-B；厚度 18 mm；K=0.303。");
    expect(segments.filter(segment => segment.code).map(segment => segment.code)).toEqual(["S-A", "S-B"]);
  });
});

describe("自然表达不同也能通过（只校验事实）", () => {
  it.each([
    "60mm双层方案，板自身R=8.000，整墙R₀=8.313，K=0.120。",
    "有一个比较接近的方案：60mm，产品层热阻8.000，总热阻8.313。",
    "A4-1 的 60mm 双层方案总热阻约8.313。",
    "按你现在的条件有一条接近的：A4-1，60mm，K约0.120，整墙热阻8.313。"
  ])("通过：%s", answer => {
    expect(validateAnswerFacts(answer, allowed())).toEqual({ passed: true, code: "VALID_FACTS" });
  });
});

describe("数字被改写/越界必须失败", () => {
  it.each([
    "产品层热阻是8.300。",
    "板自身R=8.3。",
    "整墙R₀=8.0。",
    "K=0.3。",
    "λ=0.003。",
    "α=1.5。",
    "厚度 18 mm 的方案。",
    "方案 A9-9，K=0.120。",
    "印刷页码 7 的方案。",
    "这是全部方案里最高的 K 值。",
    "该方案符合上海标准。"
  ])("失败：%s", answer => {
    expect(validateAnswerFacts(answer, allowed()).passed).toBe(false);
  });
});

describe("跨候选拼字段必须失败", () => {
  const other: ReferenceLookupCandidate = { ...candidate, id: "A4-1-18", schemeCode: "A4-2", specCode: "SP-A4", thicknessMm: 18, productThermalResistance: 2.8 };
  it("同一片段内混入另一候选的厚度", () => {
    const facts = buildAllowedAnswerFacts({}, [candidate, other], "");
    expect(validateAnswerFacts("A4-1，厚度 18 mm，产品层热阻 8.000。", facts).passed).toBe(false);
  });
  it("分别逐条说明则通过", () => {
    const facts = buildAllowedAnswerFacts({}, [candidate, other], "");
    expect(validateAnswerFacts("A4-1：厚度 60 mm，产品层热阻 8.000。\nA4-2：厚度 18 mm，产品层热阻 2.800。", facts).passed).toBe(true);
  });
});

describe("未授权断言", () => {
  it.each(["最高", "全部", "唯一", "达标", "符合规范要求"])("%s 直接判失败", text => {
    expect(answerHasForbiddenClaim(text)).toBe(true);
  });
  it("正常描述不误伤", () => {
    expect(answerHasForbiddenClaim("有接近目标的正式参考方案，可继续按厚度筛选。")).toBe(false);
  });
  it("只有后端授权合规判定时才放行「符合标准限值」", () => {
    const text = "按已确认地区、建筑类型及所选标准判定：符合该标准限值。";
    expect(answerHasForbiddenClaim(text)).toBe(true);
    expect(answerHasForbiddenClaim(text, { complianceAuthorized: true })).toBe(false);
  });
});

describe("给模型的事实清单（REFERENCE_LOOKUP 恢复自然表达）", () => {
  it("清单只含冻结事实，且带可核验的数值/页码", () => {
    const sheet = renderAllowedFactsForModel(allowed());
    expect(sheet).toContain("8.313");
    expect(sheet).toContain("8");
    expect(sheet).toContain("0.12");
    expect(sheet).toContain("60");
    expect(sheet).toContain("33");
    expect(sheet).toContain("A4-1");
  });
  it("System Prompt 明确「允许自然表达、数值必须一致」", () => {
    expect(REFERENCE_LOOKUP_ANSWER_SYSTEM_PROMPT).toContain("允许自然");
    expect(REFERENCE_LOOKUP_ANSWER_SYSTEM_PROMPT).toContain("必须与事实清单完全一致");
  });
  it("需要澄清时清单只给澄清问题，不给方案", () => {
    const facts = buildAllowedAnswerFacts({ metric: "TOTAL_R", targetValue: 8.3, mode: "APPROX", unresolved: [{ field: "metric", reason: "请确认是产品层热阻还是总热阻。" }] }, [candidate], "8.3有么");
    const sheet = renderAllowedFactsForModel(facts);
    expect(sheet).toContain("需要先向用户澄清");
    expect(sheet).not.toContain("命中候选（共");
  });
});

describe("热工计算结果的事实集", () => {
  const calculationFacts = {
    query: { schemeId: "sch-1" },
    candidates: [],
    canonicalAnswers: ["正式热工结果：K=0.29 W/(m²·K)。\n总热阻 R₀=3.3 m²·K/W。"],
    calculation: { schemeId: "sch-1", schemeCode: "A1-3", thicknessMm: 18, kValue: 0.29, totalResistance: 3.3,
      layers: [{ thicknessMm: 18, lambda: 0.033, correctionFactor: 1.2 }] }
  };
  it("计算结果允许自然复述", () => {
    expect(validateAnswerFacts("A1-3，18mm，K≈0.29，整墙总热阻 3.3。", calculationFacts)).toEqual({ passed: true, code: "VALID_FACTS" });
  });
  it("计算结果被改写必须失败", () => {
    expect(validateAnswerFacts("A1-3，18mm，K≈0.3。", calculationFacts).passed).toBe(false);
    expect(validateAnswerFacts("A1-3，导热系数 λ=0.04。", calculationFacts).passed).toBe(false);
  });
  it("未授权时不得出现合规结论，授权后放行", () => {
    const claim = "A1-3，18mm，K≈0.29，符合该标准限值。";
    expect(validateAnswerFacts(claim, calculationFacts).passed).toBe(false);
    expect(validateAnswerFacts(claim, { ...calculationFacts, calculation: { ...calculationFacts.calculation, complianceAuthorized: true, compliant: true } }).passed).toBe(true);
  });
  it("setThermalAnswerFacts 同时写入事实集与 fallback 文案", () => {
    const ctx: { thermalAllowedFacts?: unknown; thermalCanonicalAnswers?: string[] } = {};
    const returned = setThermalAnswerFacts(ctx, allowed());
    expect(returned).toEqual(allowed().canonicalAnswers);
    expect(ctx.thermalAllowedFacts).toBeDefined();
    expect(ctx.thermalCanonicalAnswers).toEqual(allowed().canonicalAnswers);
  });
});

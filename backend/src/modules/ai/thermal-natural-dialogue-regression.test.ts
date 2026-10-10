import { describe, expect, it } from "vitest";
import { buildAllowedAnswerFacts, validateAnswerFacts } from "./thermal-answer-validation.js";
import { classifyQueryLifecycle } from "../thermal/thermal-query-lifecycle.js";

const a = { id: "a", schemeCode: "A1-3", specCode: "SP-A", systemName: "I型薄抹灰系统", thicknessMm: 18,
  productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303, sourcePageLabel: "22" };
const b = { ...a, id: "b", schemeCode: "A1-4", specCode: "SP-B", thicknessMm: 20, kValue: 0.295, sourcePageLabel: "23" };

describe("自然回答的事实边界回归", () => {
  const facts = buildAllowedAnswerFacts({ metric: "K", targetValue: 0.3, mode: "APPROX", thicknessMax: 20 }, [a, b]);
  it.each([
    "A1-3，K=0.300。", // 查询目标不能冒充候选实值
    "A1-3，20mm，K=0.303。", // 查询厚度不能冒充候选厚度
    "A1-3，K=0.303，来源第23页。", // 不得用其他候选来源
    "A1-3\nK=0.295。", // 换行不能解除候选绑定
    "A1-3，规格SP-B，18mm，K=0.303。", // 规格与方案必须同一记录
    "A1-3，系统：保温装饰板系统，K=0.303。",
    "A1-3，产品层热阻是8.300，K=0.303。", // 自然连接词不能跳过指标校验
    "A1-3，厚度18.4mm，K=0.303。"
  ])("拒绝：%s", answer => expect(validateAnswerFacts(answer, facts).passed).toBe(false));
  it.each([
    "A1-3，18mm，K=0.303。",
    "A1-3，规格SP-A，18mm，K=0.303。",
    "你要的是K≈0.3。\nA1-3，18mm，K=0.303。",
    "A1-3\n18mm，K=0.303，来源第22页。"
  ])("放行：%s", answer => expect(validateAnswerFacts(answer, facts).passed).toBe(true));
  it("相邻候选不能被说成正式命中", () => {
    const nearby = buildAllowedAnswerFacts({ metric: "K", targetValue: 0.3, mode: "MAX_LIMIT" }, [], "", 0, { nearbyCandidates: [a] });
    expect(validateAnswerFacts("有满足条件的方案：A1-3，K=0.303。", nearby).passed).toBe(false);
    expect(validateAnswerFacts("没有完全满足的方案。相邻项A1-3，K=0.303，未满足上限。", nearby).passed).toBe(true);
    expect(validateAnswerFacts("没有完全满足的方案，但相邻项A1-3，K=0.303，满足全部条件。", nearby).passed).toBe(false);
    const mixed = buildAllowedAnswerFacts({ metric: "K", targetValue: 0.3, mode: "MAX_LIMIT" }, [b], "", 1, { nearbyCandidates: [a] });
    expect(validateAnswerFacts("A1-4，K=0.295。\n相邻项A1-3，K=0.303，满足全部条件。", mixed).passed).toBe(false);
  });
  it("自然无匹配回答不必等于模板，编造有匹配必须失败", () => {
    const empty = buildAllowedAnswerFacts({}, []);
    expect(validateAnswerFacts("按目前条件，没有完全满足的正式方案。", empty).passed).toBe(true);
    expect(validateAnswerFacts("有，找到几条满足条件的方案。", empty).passed).toBe(false);
  });
  it("合规授权不能允许颠倒冻结判定，也不能改写标准限值", () => {
    const calculation = { schemeCode: "A1-3", kValue: 0.303, standardLimitK: 0.3, complianceAuthorized: true, compliant: false, standardNames: ["测试标准"] };
    const calc = { query: {}, candidates: [], calculation, canonicalAnswers: [] };
    expect(validateAnswerFacts("A1-3，K=0.303，不符合该标准限值。", calc).passed).toBe(true);
    expect(validateAnswerFacts("A1-3，K=0.303，符合该标准限值。", calc).passed).toBe(false);
    expect(validateAnswerFacts("已确认标准限值K≤0.4。", calc).passed).toBe(false);
    expect(validateAnswerFacts("已确认标准限值K≤0.3。", calc).passed).toBe(true);
    expect(validateAnswerFacts("A1-3，K=0.303，合规。", calc).passed).toBe(false);
    expect(validateAnswerFacts("A1-3，K=0.303，不符合其他标准。", calc).passed).toBe(false);
    expect(validateAnswerFacts("标准依据：其他标准。", calc).passed).toBe(false);
  });
  it("fallback文本本身也不构成生成草稿的授权", () => {
    const forged = "A1-3，K=0.300。";
    expect(validateAnswerFacts(forged, { ...facts, canonicalAnswers: [forged] }).passed).toBe(false);
  });
  it("满足全部条件不是全量统计断言，且没有字段要求全部输出", () => {
    expect(validateAnswerFacts("满足全部条件：A1-3，18mm，K=0.303。", facts).passed).toBe(true);
  });
  it("自然提及体系全名仍不能绑定另一体系的候选", () => {
    const other = { ...b, systemName: "保温装饰板系统" };
    const pool = buildAllowedAnswerFacts({}, [a, other]);
    expect(validateAnswerFacts("A1-3，保温装饰板系统，K=0.303。", pool).passed).toBe(false);
    expect(validateAnswerFacts("A1-3，I型薄抹灰系统，K=0.303。", pool).passed).toBe(true);
  });
  it("较长正式体系名覆盖内部短名，II型不会误匹配成I型", () => {
    const other = { ...b, systemName: "II型薄抹灰系统" };
    expect(validateAnswerFacts("A1-4，II型薄抹灰系统，K=0.295。", buildAllowedAnswerFacts({}, [a, other])).passed).toBe(true);
  });
  it("自然表达不确定合规不是工程判定", () => {
    expect(validateAnswerFacts("A1-3，18mm，K=0.303。暂不能确认合规。", facts).passed).toBe(true);
    expect(validateAnswerFacts("A1-3，18mm，K=0.303。暂不能确认合规，但已经达标。", facts).passed).toBe(false);
  });
});

describe("生命周期必须区分候选指代和对比", () => {
  it("单个候选参数追问属于继续查询", () => expect(classifyQueryLifecycle({ message: "第一个参数给我", hasPrevious: true })).toBe("CONTINUE_QUERY"));
  it("再薄一点属于局部细化", () => expect(classifyQueryLifecycle({ message: "这个再薄一点", hasPrevious: true, hasNewCondition: true, hasPreferenceUpdate: true })).toBe("REFINE_QUERY"));
});

import { describe, expect, it, vi } from "vitest";
import { buildAllowedAnswerFacts, buildCalculationAnswer, validateAnswerFacts, validateOrRepairThermalAnswer } from "./thermal-answer-validation.js";
import { normalizeConversationLookupQuery } from "./tools/thermal-lookup.js";
import type { ReferenceLookupCandidate } from "./conversation-task.js";

const candidate: ReferenceLookupCandidate = { id: "row-A", schemeCode: "S-A", productSpecId: "spec-A", specCode: "SP-A", thicknessMm: 60,
  productThermalResistance: 8, totalThermalResistance: 8.313, kValue: 0.12, lambda: 0.005, alpha: 1.25,
  sourcePageLabel: "A-22", evidenceSource: "正式资料" };

describe("发送前原子事实门禁", () => {
  it.each(["产品层热阻 R=8.3", "总热阻 R₀=8", "厚度 18 mm", "K=0.3", "λ=0.003", "α=1.5", "方案 S-B", "规格 SP-B", "第7页", "最高", "全部", "唯一", "符合上海标准"])("拒绝不具备完整授权的事实：%s", invalid => {
    const facts = buildAllowedAnswerFacts({}, [candidate], "详细参数");
    expect(validateAnswerFacts(invalid, facts)).toEqual({ passed: false, code: "INVALID_FACT" });
    expect(validateAnswerFacts(`${facts.canonicalAnswers[0]}\n${invalid}`, facts).passed).toBe(false);
  });
  it("同一数值在另一候选里合法，也不能跨候选拼字段", () => {
    const other = { ...candidate, id: "row-B", schemeCode: "S-B", thicknessMm: 18, alpha: 1.5, productThermalResistance: 2.8 };
    const facts = buildAllowedAnswerFacts({}, [candidate, other], "详细参数列出来");
    expect(validateAnswerFacts(facts.canonicalAnswers[0]!, facts).passed).toBe(true);
    expect(validateAnswerFacts(facts.canonicalAnswers[0]!.replace("厚度 60 mm", "厚度 18 mm"), facts).passed).toBe(false);
    expect(validateAnswerFacts(facts.canonicalAnswers[0]!.replace("α=1.25", "α=1.5"), facts).passed).toBe(false);
  });
  it("事实快照不会随后续候选修改漂移，硬条件违规/相邻行不能进入正式事实", () => {
    const original = { ...candidate };
    const facts = buildAllowedAnswerFacts({ thicknessMm: 60 }, [original, { ...candidate, id: "neighbor", thicknessMm: 61 }]);
    original.productThermalResistance = 8.3;
    expect(facts.candidates).toHaveLength(1); expect(facts.candidates[0]?.productThermalResistance).toBe(8);
    expect(facts.canonicalAnswers[0]).toContain("R=8 ");
  });
  it("缺失印刷标签不会使用物理页序、atlasPage 或 evidenceRef", () => {
    const dirty = { ...candidate, sourcePageLabel: null, atlasPage: "7", evidenceRef: "第7页", physicalPageNumber: 7 };
    const facts = buildAllowedAnswerFacts({}, [dirty]);
    expect(facts.canonicalAnswers[0]).toContain("可查看原始来源页面"); expect(facts.canonicalAnswers[0]).not.toContain("第7页");
  });
  it.each([
    ["保温板自身热阻2.8左右", "PRODUCT_R", "APPROX"], ["板自身R2.8左右", "PRODUCT_R", "APPROX"],
    ["整墙热阻3.3左右", "TOTAL_R", "APPROX"], ["主断面传热阻就是3.3", "TOTAL_R", "EXACT"],
    ["传热系数0.3左右", "K", "APPROX"], ["K等于0.3", "K", "EXACT"], ["K不超过0.3", "K", "MAX_LIMIT"], ["总热阻不低于3.3", "TOTAL_R", "MIN_LIMIT"]
  ])("用户显式指标和模式不会被模型改写：%s", (message, metric, mode) => {
    const result = normalizeConversationLookupQuery({ metric: "TOTAL_R", targetValue: 8.3, mode: "EXACT" }, message!);
    expect(result.needsClarification).toBe(false); expect(result.query.filters?.[0]).toMatchObject({ metric, mode });
  });
  it("一次重生成仍违规时确定性 fallback，未经核验的草稿不会成为返回文本", async () => {
    const facts = buildAllowedAnswerFacts({}, [candidate]);
    const retry = vi.fn(async () => "产品R=8.3");
    const result = await validateOrRepairThermalAnswer("产品R=8.3", facts.canonicalAnswers, retry, facts);
    expect(retry).toHaveBeenCalledTimes(1); expect(result.fallback).toBe(true); expect(result.text).toBe(facts.canonicalAnswers[0]);
    const good = await validateOrRepairThermalAnswer(result.text, facts.canonicalAnswers, retry, facts);
    expect(good.repaired).toBe(false); expect(retry).toHaveBeenCalledTimes(1);
  });
  it("重生成异常仍使用已核验模板", async () => {
    const facts = buildAllowedAnswerFacts({}, [candidate]);
    const result = await validateOrRepairThermalAnswer("非法数字", facts.canonicalAnswers, async () => { throw new Error("不可用"); }, facts);
    expect(result.fallback).toBe(true); expect(validateAnswerFacts(result.text, facts).passed).toBe(true);
  });
  it("正式计算来自冻结展示数据，未授权适用范围不能直接宣称达标", () => {
    const answer = buildCalculationAnswer({ mode: "LAYERED", resultK: 0.12, totalResistance: 8.313, compliant: true, limitKValue: 0.3, steps: [], layers: [] });
    expect(answer).toContain("K=0.12"); expect(answer).toContain("R₀=8.313"); expect(answer).not.toContain("已达标"); expect(answer).toContain("适用范围");
  });
});

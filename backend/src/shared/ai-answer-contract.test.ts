import { describe, expect, it } from "vitest";
import { formatAnswerContractPrompt, resolveAnswerContract } from "./ai-answer-contract.js";
import { normalizeReferenceLookupForModel, normalizeToolResultForModel } from "../modules/ai/tools/tool-result-normalizer.js";

describe("参考查询 Answer Contract 收口", () => {
  it.each(["K<=0.3有什么方案？", "TOTAL_R>=3.3有什么方案？", "K不应大于0.3且总热阻不应小于3.3有哪些方案？"])("多条件与比较词不触发合规：%s", (message) => {
    expect(resolveAnswerContract({ message })).toBe("REFERENCE_LOOKUP");
  });
  it("上海外墙限值是否达标才进入合规判断", () => {
    expect(resolveAnswerContract({ message: "上海外墙K<=0.3是否达标？" })).toBe("THERMAL");
  });
  it("二次模型归一保留全部 filters 和容差 metadata", () => {
    const first = normalizeReferenceLookupForModel({ found: false, candidates: [], filters: [
      { metric: "K", targetValue: 0.3, mode: "MAX_LIMIT" },
      { metric: "TOTAL_R", targetValue: 3.3, mode: "APPROX", requestedTolerance: 5, effectiveTolerance: 0.2, toleranceAdjusted: true }
    ], toleranceAdjusted: true });
    const next = normalizeToolResultForModel("thermal", { data: first }) as typeof first;
    expect(next.filters).toEqual(first.filters);
    expect(next.toleranceAdjusted).toBe(true);
    expect(next.instruction).toContain("同时满足全部条件");
    expect(next.instruction).toContain("实际采用的范围");
  });
  it.each(["K≈0.3有什么方案？", "R≥3.3有什么方案？", "总R≥3.3的方案", "产品R2.9左右", "薄抹灰 K 不超过0.3"])("%s 仍是参考查询", (message) => {
    expect(resolveAnswerContract({ message })).toBe("REFERENCE_LOOKUP");
  });
  it("法规达标问题进入正式热工判断", () => {
    expect(resolveAnswerContract({ message: "K=0.3在上海是否达标？" })).toBe("THERMAL");
  });
  it("未命中也支持系统/厚度追问", () => {
    expect(resolveAnswerContract({ message: "那屋面系统呢？", lastReferenceLookup: { query: {}, candidates: [] } })).toBe("REFERENCE_LOOKUP");
  });
  it("系统与Tool文案同时规定跨体系回退必须先说未命中", () => {
    const contract = formatAnswerContractPrompt("REFERENCE_LOOKUP");
    expect(contract).toContain("符合用户指定体系且有命中时");
    expect(contract).toContain("禁止开头回答“有”");
    const normalized = normalizeReferenceLookupForModel({ found: true, candidates: [{ id: "other" }], isFallback: true, matchedSystemHint: false, metric: "TOTAL_R", targetValue: 3.3, tolerance: 0.05, lookupMode: "APPROX" });
    expect(normalized.instruction).toContain("没有找到符合");
    expect(normalized.instruction).not.toContain("第一行直接回答有");
    expect(normalized.instruction).toContain("总热阻 R近似查询");
    expect(normalized.instruction).toContain("不能称为规范达标");
    const again = normalizeToolResultForModel("thermal", { ok: true, data: normalized }) as typeof normalized;
    expect(again).toMatchObject({ metric: "TOTAL_R", targetValue: 3.3, tolerance: 0.05, isFallback: true });
    expect(again.instruction).not.toContain("第一行直接回答有");
  });
  it.each(["TOTAL_R", "PRODUCT_R"] as const)("%s 上下限提示使用正确指标", (metric) => {
    const result = normalizeReferenceLookupForModel({ found: true, candidates: [{ id: "r" }], metric, lookupMode: "MIN_LIMIT" });
    expect(result.instruction).toContain(metric === "TOTAL_R" ? "总热阻 R ≥" : "产品层热阻 R ≥");
    expect(result.instruction).not.toContain("K ≥");
  });
});

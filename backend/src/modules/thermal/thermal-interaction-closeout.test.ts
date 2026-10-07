import { describe, expect, it } from "vitest";
import { resolveAiCapabilities } from "../ai/ai-capability-router.js";
import { isThermalComplianceIntent, resolveAnswerContract } from "../../shared/ai-answer-contract.js";
import { normalizeConversationLookupQuery } from "../ai/tools/thermal-lookup.js";
import type { LastReferenceLookup } from "../ai/conversation-task.js";

const history = (message: string): LastReferenceLookup => ({ query: normalizeConversationLookupQuery({}, message).query, candidates: [], createdAt: "2026-10-07" });

describe("最终真实交互边界", () => {
  it.each([
    ["K控制在0.3以内有哪些方案", "REFERENCE_LOOKUP"],
    ["传热系数限值0.3有哪些方案", "REFERENCE_LOOKUP"],
    ["这个墙体有没有K0.3左右的图集方案", "REFERENCE_LOOKUP"],
    ["帮我算一下这个墙体20mm后的K", "THERMAL"],
    ["A1-3改成22mm重新计算", "THERMAL"],
    ["上海这个项目K=0.3够不够", "THERMAL"],
    ["这个参数符合哪个标准", "THERMAL"],
    ["上海外墙是否满足要求", "THERMAL"]
  ])("%s → %s", (message, expected) => {
    const capabilities = resolveAiCapabilities({ message });
    expect(resolveAnswerContract({ message, capabilities })).toBe(expected);
    expect(capabilities.needReferenceLookup).toBe(expected === "REFERENCE_LOOKUP");
    if (message.includes("够不够")) expect(isThermalComplianceIntent(message)).toBe(true);
  });
  it.each(["那25以内呢？", "厚度改到25", "厚度调到25", "厚度调整到25", "厚度调整为25", "厚度从20改到25", "厚度从20调到25", "放宽到25", "调到25", "最大改成25"])("%s 保留K，更新上限", (message) => {
    const next = normalizeConversationLookupQuery({ metric: "K", targetValue: 25 }, message, history("K0.3左右，20mm以内，尽量薄"));
    expect(next.needsClarification).toBe(false);
    expect(next.query.thicknessMax).toBe(25);
    expect(next.query.filters).toMatchObject([{ metric: "K", mode: "APPROX", targetValue: 0.3 }]);
  });
  it.each(["厚度不限", "不限制厚度", "不考虑厚度了", "厚度无所谓", "先不看厚度", "取消厚度限制"])("%s 清除所有厚度条件和偏好", (message) => {
    const next = normalizeConversationLookupQuery({ thicknessMax: 20, preferThinner: true }, message, history("K0.3左右，20mm以内，尽量薄"));
    expect([next.query.thicknessMm, next.query.thicknessMin, next.query.thicknessMax, next.query.preferThinner]).toEqual([undefined, undefined, undefined, undefined]);
    expect(next.query.filters).toMatchObject([{ metric: "K", targetValue: 0.3 }]);
  });
  it("省略单位的下限、精确档和metric显式更新不混用", () => {
    expect(normalizeConversationLookupQuery({}, "25以上", history("厚度20以上，K0.3左右")).query.thicknessMin).toBe(25);
    expect(normalizeConversationLookupQuery({}, "改成25", history("20mm，K0.3左右")).query.thicknessMm).toBe(25);
    expect(normalizeConversationLookupQuery({}, "K改成0.25", history("20mm以内，K0.3左右")).query.thicknessMax).toBe(20);
    const next = normalizeConversationLookupQuery({}, "取消厚度上限", history("厚度18到25mm，K0.3左右"));
    expect(next.query.thicknessMin).toBe(18);
    expect(next.query.thicknessMax).toBeUndefined();
  });
  it.each([
    ["K控制0.3以内", "K", "MAX_LIMIT", 0.3], ["K控制0.3左右", "K", "APPROX", 0.3],
    ["总R做到3.3以上", "TOTAL_R", "MIN_LIMIT", 3.3], ["总R做到3.3左右", "TOTAL_R", "APPROX", 3.3],
    ["产品R做到2.9左右", "PRODUCT_R", "APPROX", 2.9], ["传热系数控制0.3以内", "K", "MAX_LIMIT", 0.3]
  ])("%s 不产生无意义澄清", (message, metric, mode, targetValue) => {
    const next = normalizeConversationLookupQuery({}, message as string);
    expect(next.needsClarification).toBe(false);
    expect(next.query.filters).toMatchObject([{ metric, mode, targetValue }]);
  });
});

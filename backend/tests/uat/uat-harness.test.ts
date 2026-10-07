import { describe, expect, it } from "vitest";
import { uatCases } from "./cases/index.js";
import { A13, A14 } from "./fixtures/facts.js";
import { assertObservation, matchesPartial, satisfies, visibleAnswer } from "./assertions/index.js";
import { scoreTurn, redact, summarize } from "./report.js";
import { SseDecoder } from "./sse.js";
import type { Observation, TurnResult } from "./schema.js";
import { HARD_FAIL_RULES } from "./schema.js";

function observation(text: string, query: Record<string, unknown> = {}, candidate = A13): Observation {
  return {
    message: { id: "message", conversationId: "conversation", content: text, status: "COMPLETED", metadata: { backendDecision: { intent: "REFERENCE_LOOKUP" } } } as Observation["message"],
    tools: [], runs: [], calculations: [], events: [],
    task: { taskType: "GENERAL", lastReferenceLookup: { query, candidates: [{ id: "row", ...candidate }], createdAt: "2026-10-07" } }
  };
}
const expected = { intent: "REFERENCE_LOOKUP" as const, toolsAny: [], hardFailRules: HARD_FAIL_RULES };
describe("真实UAT基础设施与硬失败检测（不冒充真实模型UAT）", () => {
  it("40个独立业务场景、两类persona、123轮均有确定性与hard fail契约", () => {
    expect(uatCases).toHaveLength(40);
    expect(uatCases.filter(item => item.persona === "SALES")).toHaveLength(20);
    expect(uatCases.filter(item => item.persona === "DESIGN_INSTITUTE")).toHaveLength(20);
    expect(uatCases.flatMap(item => item.turns)).toHaveLength(123);
    for (const item of uatCases) for (const turn of item.turns) {
      expect(turn.expect.intent).toBeTruthy();
      expect(turn.expect.hardFailRules).toEqual(HARD_FAIL_RULES);
      expect(item.turns.length).toBeGreaterThanOrEqual(2);
      expect(item.turns.length).toBeLessThanOrEqual(5);
    }
  });
  it("独立数值比较不允许0.303冒充上限，不使用Matcher", () => {
    expect(satisfies(A13, { filters: [{ metric: "K", mode: "APPROX", targetValue: 0.3 }] })).toBe(true);
    expect(satisfies(A13, { filters: [{ metric: "K", mode: "MAX_LIMIT", targetValue: 0.3 }] })).toBe(false);
    expect(satisfies(A14, { filters: [{ metric: "K", mode: "MAX_LIMIT", targetValue: 0.3 }, { metric: "TOTAL_R", mode: "MIN_LIMIT", targetValue: 3.3 }] })).toBe(true);
  });
  it.each([
    ["违反K上限", observation("有，A1-3 18mm K=0.303满足条件。", { filters: [{ metric: "K", mode: "MAX_LIMIT", targetValue: 0.3 }] }), expected],
    ["混淆双R", observation("产品热阻=3.297，总热阻=2.880。"), expected],
    ["伪造页码", observation("来源为图集第22页。"), expected],
    ["计算值冒充图集", observation("22mm K=0.254为图集原始值。"), { ...expected, resultType: "CALCULATED" as const }],
    ["无标准宣称达标", observation("符合规范，该项目达标。"), expected],
    ["旧条件残留", observation("接近目标。", { thicknessMax: 20 }), { ...expected, query: { thicknessMax: 25 } }],
    ["厚度越界", observation("有，25mm满足条件。", { thicknessMax: 20 }, { ...A13, thicknessMm: 25 }), expected]
  ])("%s立即失败", (_name, actual, contract) => {
    const checks = assertObservation(contract, actual);
    expect(checks.some(check => check.hard && !check.passed)).toBe(true);
    expect(scoreTurn(checks, { score: 10, method: "TEST", reasons: [] }).status).toBe("FAIL");
  });
  it("Markdown双R列交换也被检测，否定合规表述不会误杀", () => {
    const actual = observation("|构造|厚度mm|产品热阻|总热阻|K|\n|---|---|---|---|---|\n|A1-3|18|3.297|2.880|0.303|");
    expect(assertObservation(expected, actual).some(check => check.hard && !check.passed && check.detail.includes("参数表"))).toBe(true);
    expect(assertObservation(expected, observation("无法确定是否符合规范，不能说达标。")).find(check => check.detail.includes("合规肯定"))?.passed).toBe(true);
    // 「不是在判…达标」是明确免责，不得当成肯定合规结论。
    expect(assertObservation(expected, observation("这是接近 0.3 的结果，不是在判规范限值达标；两者相差 0.008 左右。")).find(check => check.detail.includes("合规肯定"))?.passed).toBe(true);
  });
  it("K/W 与 W/(m²·K) 单位不得被误判成 K 值混淆，真实混淆仍必须失败", () => {
    // 2.88 ㎡·K/W 是热阻单位，其中的 K/W 不能与后面的总热阻数值绑定。
    const unit = "| 厚度 | K 值 | 对应产品层热阻 | 总热阻 |\n|---|---|---|---|\n| 18mm | 0.303 | 2.88 ㎡·K/W | 3.297 ㎡·K/W |";
    const unitChecks = assertObservation(expected, observation(unit)).filter(check => check.detail.includes("不混淆产品R/总R/K"));
    expect(unitChecks.every(check => check.passed)).toBe(true);
    // W/(m²·K) 单位结尾的 K 也不能与其后的产品层热阻绑定。
    const unit2 = "**18mm（A1-3）**：K≈0.303 W/(m²·K)，产品层热阻 2.880 m²·K/W，总热阻 3.297 m²·K/W";
    const unit2Checks = assertObservation(expected, observation(unit2)).filter(check => check.detail.includes("不混淆产品R/总R/K"));
    expect(unit2Checks.every(check => check.passed)).toBe(true);
    // 真实的 K 与总热阻混淆仍必须被硬失败捕获。
    const confused = assertObservation(expected, observation("K值=3.297，产品层热阻=0.303。")).filter(check => check.detail.includes("不混淆产品R/总R/K"));
    expect(confused.some(check => check.hard && !check.passed)).toBe(true);
  });
  it("相邻规格仅豁免厚度维度，精确档与其余硬条件仍必须满足", () => {
    const query = { filters: [{ metric: "K" as const, mode: "MAX_LIMIT" as const, targetValue: 0.3 }], thicknessMm: 20, specClass: "I" };
    // 相邻档：厚度 25 偏离目标 20，但其余硬条件（K<=0.3、I 型）满足 -> 允许。
    const neighbor = observation("有。", query, { ...A14, thicknessMm: 25, matchType: "NEIGHBOR" });
    expect(assertObservation({ ...expected, query }, neighbor).filter(c => c.detail.includes("全部硬条件")).every(c => c.passed)).toBe(true);
    // 精确档若厚度不符仍必须硬失败。
    const exact = observation("有。", query, { ...A14, thicknessMm: 25, matchType: "EXACT" });
    expect(assertObservation({ ...expected, query }, exact).some(c => c.hard && !c.passed && c.detail.includes("全部硬条件"))).toBe(true);
    // 相邻档也不能绕过 K 上限。
    const neighborBreaksK = observation("有。", query, { ...A13, thicknessMm: 25, matchType: "NEIGHBOR" });
    expect(assertObservation({ ...expected, query }, neighborBreaksK).some(c => c.hard && !c.passed && c.detail.includes("全部硬条件"))).toBe(true);
  });
  it("显式删除必须检查undefined，不能省略后默认为通过", () => {
    expect(matchesPartial({ thicknessMax: 25 }, { thicknessMax: undefined })).toBe(false);
    expect(matchesPartial({}, { thicknessMax: undefined })).toBe(true);
  });
  it("SSE跨chunk/CRLF/多行事件被正确解析，尾部不完整不能通过", () => {
    const parser = new SseDecoder();
    expect(parser.push('event: done\r\ndata: {"message')).toEqual([]);
    expect(parser.push('Id":"m"}\r\n\r\n')).toEqual([{ event: "done", data: { messageId: "m" } }]);
    parser.end();
    parser.push('event: done\ndata: {}');
    expect(() => parser.end()).toThrow();
  });
  it("结构化USER_SELECTION也属于真实用户可见回答", () => {
    const actual = observation("");
    actual.events = [{ event: "waiting_user_input", data: { title: "选择报告类型", prompt: "请确认报告类型。" } }];
    expect(visibleAnswer(actual)).toContain("请确认报告类型");
    expect(assertObservation(expected, actual).find(check => check.detail.includes("有用户可见"))?.passed).toBe(true);
  });
  it("未执行不得满分或产生虚假通过率；报告删除密钥/思考链/签名参数", () => {
    expect(scoreTurn([], { score: 10, method: "TEST", reasons: [] })).toEqual({ score: 0, status: "FAIL" });
    expect(summarize([], 40, 123).intent.rate).toBeNull();
    expect(redact({ token: "secret", apiKeyCiphertext: "secret", stateJson: { system: "private" }, imageUrl: "https://fixture.test/a.png?Signature=secret" })).toEqual({ imageUrl: "https://fixture.test/a.png" });
  });
});

import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { runAgentLoop } from "./ai-agent.service.js";
import { buildAllowedAnswerFacts } from "./thermal-answer-validation.js";

const mocks = vi.hoisted(() => ({ stream: vi.fn(), retry: vi.fn(), emit: vi.fn(), canonical: "产品层热阻 R=8 m²·K/W；总热阻 R₀=8.313 m²·K/W。", allowedFacts: undefined as unknown, controller: new AbortController() }));
vi.mock("ai", async importOriginal => ({ ...await importOriginal<typeof import("ai")>(), streamText: mocks.stream, generateText: mocks.retry }));
vi.mock("./ai-tools.js", () => ({ createAgentTools: (ctx: any) => { ctx.thermalCanonicalAnswers = [mocks.canonical]; if (mocks.allowedFacts) ctx.thermalAllowedFacts = mocks.allowedFacts; return {}; } }));
vi.mock("./ai-sse.js", () => ({ writeSse: mocks.emit, isAbortError: (error: Error) => error.name === "AbortError" }));

async function run(text: string, interrupted = false, overrides: Record<string, unknown> = {}) {
  mocks.emit.mockClear(); mocks.retry.mockReset(); mocks.retry.mockResolvedValue({ text: "产品层热阻 R=8.3" });
  mocks.controller = new AbortController();
  mocks.allowedFacts ??= buildAllowedAnswerFacts({}, [{ id: "row", productThermalResistance: 8, totalThermalResistance: 8.313 }]);
  mocks.stream.mockReturnValue({ fullStream: (async function* () {
    yield { type: "start-step" }; yield { type: "text-delta", text };
    if (interrupted) mocks.controller.abort(); else yield { type: "finish-step" };
  })(), usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }), responseMessages: Promise.resolve([]) });
  const chain: any = { set: () => chain, where: async () => undefined };
  const selection: any = { from: () => selection, where: () => selection, limit: async () => [{ status: "COMPLETED" }] };
  return runAgentLoop({ app: { db: { update: () => chain, select: () => selection } }, request: { log: { warn: vi.fn() } }, reply: {},
    user: {}, conversation: {}, runtime: {}, agentModel: { languageModel: {} }, allowedTools: [], assistantMessageId: "message", agentRunId: "run",
    abortSignal: mocks.controller.signal, initialState: { system: "测试", messages: [], recentToolHashes: [], fullText: "", userVisibleText: "", internalStepText: "", sources: [] },
    answerContract: "REFERENCE_LOOKUP", ...overrides } as any);
}

describe("热工事实门禁必须在第一个 SSE delta 之前", () => {
  it("已选候选对比首步调用冻结对比工具，不强制先查表", async () => {
    await run(mocks.canonical, false, { allowedTools: ["thermal", "compare_solutions"], userMessage: "第一个和第三个哪个好",
      taskState: { taskType: "GENERAL", lastReferenceLookup: { query: {}, candidates: [{ id: "a" }, { id: "b" }, { id: "c" }], createdAt: "2026-10-10" } } });
    const step = await mocks.stream.mock.calls.at(-1)![0].prepareStep();
    expect(step.toolChoice).toEqual({ type: "tool", toolName: "compare_solutions" });
  });
  it("非法初稿与非法重试均不发出，只发送确定性模板", async () => {
    const result = await run("产品层热阻 R=8.3");
    expect(result.finish).toBe("COMPLETED"); expect(result.text).toBe(mocks.canonical);
    expect(mocks.retry).toHaveBeenCalledTimes(1);
    const emitted = mocks.emit.mock.calls.filter(([, event]) => event === "delta").map(([, , data]) => data.text).join("");
    expect(emitted).toBe(mocks.canonical); expect(emitted).not.toContain("R=8.3 ");
  });
  it("已核验文本直接发送，不产生额外模型调用", async () => {
    expect((await run(mocks.canonical)).text).toBe(mocks.canonical); expect(mocks.retry).not.toHaveBeenCalled();
  });
  it("停止时不发出未校验的半成品，也不调用重生成", async () => {
    const result = await run("产品层热阻 R=8.3", true);
    expect(result.finish).toBe("CANCELLED"); expect(result.text).toBe("");
    expect(mocks.emit.mock.calls.some(([, event]) => event === "delta")).toBe(false); expect(mocks.retry).not.toHaveBeenCalled();
  });
  it("有 Allowed Fact Set 时，自然复述被放行，不再强制原样输出", async () => {
    mocks.allowedFacts = buildAllowedAnswerFacts({ metric: "TOTAL_R", targetValue: 8.313, mode: "APPROX" },
      [{ id: "A4-1-60", schemeCode: "A4-1", thicknessMm: 60, productThermalResistance: 8, totalThermalResistance: 8.313, kValue: 0.12 }], "");
    const natural = "有一个比较接近的方案：60mm，产品层热阻 8.000，总热阻 8.313。";
    const result = await run(natural);
    mocks.allowedFacts = undefined;
    expect(result.text).toBe(natural);
    expect(mocks.retry).not.toHaveBeenCalled();
    const emitted = mocks.emit.mock.calls.filter(([, event]) => event === "delta").map(([, , data]) => data.text).join("");
    expect(emitted).toBe(natural);
  });
  it("有 Allowed Fact Set 但数字被改写时，仍然回退确定性答案", async () => {
    mocks.allowedFacts = buildAllowedAnswerFacts({ metric: "TOTAL_R", targetValue: 8.313, mode: "APPROX" },
      [{ id: "A4-1-60", schemeCode: "A4-1", thicknessMm: 60, productThermalResistance: 8, totalThermalResistance: 8.313, kValue: 0.12 }], "");
    mocks.retry.mockResolvedValue({ text: "产品层热阻 8.300。" });
    const result = await run("产品层热阻 8.300。");
    mocks.allowedFacts = undefined;
    expect(result.text).toBe(mocks.canonical);
    expect(mocks.retry).toHaveBeenCalledTimes(1);
  });
});

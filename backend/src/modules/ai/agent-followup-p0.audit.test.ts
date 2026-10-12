import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
const pendingFix = process.env.P0_EXPECT_FIXED === "1" ? it : it.fails;
const mocks = vi.hoisted(() => ({ stream: vi.fn(), tools: vi.fn(), step: vi.fn() }));
vi.mock("ai", async importOriginal => ({ ...await importOriginal<typeof import("ai")>(), streamText: mocks.stream }));
vi.mock("./ai-tools.js", () => ({ createAgentTools: mocks.tools }));
import { runAgentLoop } from "./ai-agent.service.js";
import { normalizeConversationLookupQuery } from "./tools/thermal-lookup.js";
import { isReferenceLookupIntent, isThermalCalculateIntent } from "../../shared/ai-answer-contract.js";

beforeEach(() => {
  vi.resetAllMocks(); mocks.tools.mockReturnValue({});
  // 真正执行runAgentLoop和prepareStep；SDK传输、DB、工具目录使用替身，非真实SSE验收。
  mocks.stream.mockImplementation(options => ({ responseMessages: Promise.resolve([]), usage: Promise.resolve({}), fullStream: (async function* () {
    mocks.step(await options.prepareStep());
    yield { type: "text-delta", text: "受控测试回答" };
  })() }));
});

async function run(message: string) {
  const db = { update: () => ({ set: () => ({ where: async () => [] }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ status: "COMPLETED" }] }) }) }) };
  const last = { query: { systemId: "thin", filters: [{ metric: "K" as const, targetValue: 0.3, mode: "APPROX" as const }] },
    candidates: [1, 2, 3].map(i => ({ id: `row-${i}`, schemeCode: `A1-${i}`, thicknessMm: 18 + i, kValue: .303 })),
    createdAt: new Date().toISOString(), projectId: null, candidateQueryRevision: 7 };
  const state = { taskType: "GENERAL" as const, lastReferenceLookup: last }, frozen = structuredClone(state);
  const answerContract = isThermalCalculateIntent(message) ? "THERMAL" : isReferenceLookupIntent(message, last) ? "REFERENCE_LOOKUP" : "GENERAL";
  const result = await runAgentLoop({ app: { db }, request: {}, reply: { raw: { write: vi.fn() } }, user: { id: "u" },
    conversation: { id: "c", projectId: null }, runtime: {}, agentModel: { languageModel: {} },
    allowedTools: ["thermal", "compare_solutions"], assistantMessageId: "m", agentRunId: "r", abortSignal: new AbortController().signal,
    initialState: { system: "测试", messages: [], sources: [], recentToolHashes: [], fullText: "", userVisibleText: "", internalStepText: "" },
    taskState: state, answerContract, userMessage: message } as any);
  expect(result.finish).toBe("COMPLETED");
  expect(state).toEqual(frozen);
  expect(mocks.step).toHaveBeenCalledTimes(1);
  return mocks.step.mock.calls[0]![0];
}

describe("P0静态审计：真实prepareStep路径，模型与传输为替身", () => {
  pendingFix.each(["第一个原页", "第一个完整表格"])("%s 不能在首步强制thermal", async message => {
    expect((await run(message)).toolChoice).toBeUndefined();
  });
  it("局部厚度Refine首步调用thermal", async () => {
    expect((await run("那20mm以内")).toolChoice).toEqual({ type: "tool", toolName: "thermal" });
  });
  it("明确第一和第三个比较首步调用compare_solutions", async () => {
    expect(normalizeConversationLookupQuery({}, "第一个和第三个比较", { query: {}, candidates: [], createdAt: "" }).lifecycle).toBe("COMPARE_SELECTED");
    expect((await run("第一个和第三个比较")).toolChoice).toEqual({ type: "tool", toolName: "compare_solutions" });
  });
  it("GENERAL合同不会因有候选强制工具（生成入口的动作故障另测）", async () => {
    expect((await run("你好")).toolChoice).toBeUndefined();
  });
});

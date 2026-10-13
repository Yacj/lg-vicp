import { domainDecision, type DomainIntent } from "./ai-domain-turn-decision.js";
import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

async function run(message: string, intent: DomainIntent = "GENERAL") {
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
    domainDecision: domainDecision(intent, message), taskState: state, answerContract, userMessage: message } as any);
  expect(result.finish).toBe("COMPLETED");
  expect(state).toEqual(frozen);
  expect(mocks.step).toHaveBeenCalledTimes(1);
  return mocks.step.mock.calls[0]![0];
}

describe("P0静态审计：真实prepareStep路径，模型与传输为替身", () => {
  it.each(["第一个原页", "第一个完整表格"])("%s 不能在首步强制thermal", async message => {
    expect((await run(message)).toolChoice).toBeUndefined();
  });
  it.each([
    ["K值小就一定省钱吗", undefined], ["施工时怎么处理热桥", undefined],
    ["第二个基层是什么，厚度多少？", undefined], ["刚才第三个的完整热工表给我看看", undefined],
    ["这个数值哪一页来的", undefined], ["外墙K≤0.3，优先做薄一点，给我几套做法", "thermal"],
    ["只要20mm以内", "thermal"], ["第一个和第三个有什么区别", "compare_solutions"]
    , ["总热阻", undefined], ["保温板热阻和总热阻的区别", undefined], ["用同一厚度哪个好", "compare_solutions"]
  ])("矩阵Agent首步%s严格按目标选择工具", async (message, expected) => {
    expect((await run(message!, expected === "thermal" ? "REFERENCE_QUERY" : expected === "compare_solutions" ? "COMPARE_CANDIDATES" : "GENERAL")).toolChoice).toEqual(expected ? { type: "tool", toolName: expected } : undefined);
  });
  it("局部厚度Refine首步调用thermal", async () => {
    expect((await run("那20mm以内", "REFERENCE_REFINE")).toolChoice).toEqual({ type: "tool", toolName: "thermal" });
  });
  it("明确第一和第三个比较首步调用compare_solutions", async () => {
    expect(normalizeConversationLookupQuery({}, "第一个和第三个比较", { query: {}, candidates: [], createdAt: "" }).lifecycle).toBe("COMPARE_SELECTED");
    expect((await run("第一个和第三个比较", "COMPARE_CANDIDATES")).toolChoice).toEqual({ type: "tool", toolName: "compare_solutions" });
  });
  it("GENERAL合同不会因有候选强制工具（生成入口的动作故障另测）", async () => {
    expect((await run("你好")).toolChoice).toBeUndefined();
  });
});

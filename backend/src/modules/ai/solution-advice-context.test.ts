import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseConversationTaskState } from "./conversation-task.js";
import { advanceAdviceBusinessContext, currentPendingAdviceGoal, invalidateAdviceOnTopicChange } from "./solution-advice-context.js";
import { loadAdviceBusinessContext } from "./solution-advice-context.service.js";
import { resolveDomainTurn } from "./ai-domain-turn-decision.service.js";
const mocks = vi.hoisted(() => ({ model: vi.fn(), runtime: vi.fn() }));
vi.mock("ai", () => ({ generateObject: mocks.model }));
vi.mock("./ai-runtime.service.js", () => ({ resolveSceneRuntime: mocks.runtime }));
vi.mock("./reference-fact-history.js", () => ({ readReferenceFactHistory: async () => [] }));
vi.mock("./query-clarification-context.js", () => ({ readQueryClarification: async () => null }));
const conversation = { id: "context-conversation", projectId: null };
const lookup = { query: {}, candidates: [{ id: "never-from-history" }], candidateQueryRevision: 7, projectId: null, createdAt: new Date().toISOString() };
it("当前记录的来源解释不中断建议上下文；换题仍清除", () => {
  const initial = advanceAdviceBusinessContext({ taskType: "GENERAL", lastReferenceLookup: lookup }, conversation, "REFERENCE_QUERY", "查参考", "已查询");
  const semantic = domainSemanticFixture("解释刚才这套的来源", "KNOWLEDGE_EXPLAIN", { relation: "CONTINUE", reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: 7, items: [] } });
  const decision = { intent: "KNOWLEDGE_EXPLAIN", mutation: "NONE", evidenceSpans: [semantic.evidence], semantic, referenceFocusIds: ["never-from-history"] } as const;
  const kept = invalidateAdviceOnTopicChange(initial, "KNOWLEDGE_EXPLAIN", semantic.evidence, decision as any);
  expect(kept.adviceBusinessContext?.candidateScopeActive).toBe(true);
  expect(advanceAdviceBusinessContext(kept, conversation, "KNOWLEDGE_EXPLAIN", semantic.evidence, "来源已核验", Date.now(), false, decision as any).adviceBusinessContext?.candidateScopeActive).toBe(true);
  const switched = { ...decision, semantic: { ...semantic, relation: "SWITCH_TOPIC" as const } };
  expect(invalidateAdviceOnTopicChange(initial, "KNOWLEDGE_EXPLAIN", "换题", switched as any).adviceBusinessContext?.candidateScopeActive).toBe(false);
});
beforeEach(() => { vi.clearAllMocks(); mocks.runtime.mockResolvedValue({ primary: { languageModel: {} } }); mocks.model.mockImplementation(async options => ({ object: domainSemanticFixture(JSON.parse(options.prompt).message, "SOLUTION_ADVICE") })); });
describe("建议目标上下文边界与旧会话兼容", () => {
  it("JSON schema可回读目标，不混入QueryState；畸形上下文被丢弃", () => {
    const state = advanceAdviceBusinessContext({ taskType: "GENERAL", lastReferenceLookup: lookup }, conversation, "SOLUTION_ADVICE", "给个参考方案", "参考建议", Date.now(), true);
    expect(parseConversationTaskState(state)).toMatchObject({ pendingAdviceGoal: { conversationId: conversation.id, candidateQueryRevision: 7 } });
    expect(state.lastReferenceLookup?.query).toEqual({});
    expect(parseConversationTaskState({ ...state, pendingAdviceGoal: { conversationId: "malformed" } }).pendingAdviceGoal).toBeUndefined();
  });
  it.each(["revision", "project", "expired"])("%s使pendingGoal失效", kind => {
    const state = advanceAdviceBusinessContext({ taskType: "GENERAL", lastReferenceLookup: { ...lookup } }, conversation, "SOLUTION_ADVICE", "给个参考方案", "参考建议", Date.now(), true);
    if (kind === "revision") state.lastReferenceLookup!.candidateQueryRevision = 8;
    if (kind === "project") state.pendingAdviceGoal!.projectId = "other";
    if (kind === "expired") state.pendingAdviceGoal!.validUntil = new Date(Date.now() - 1).toISOString();
    expect(currentPendingAdviceGoal(state, conversation)).toBeUndefined();
  });
  it("上下文读取只加载该会话最近两轮目标、Revision，不从内容猜候选ID", async () => {
    const rows = [
      { role: "ASSISTANT", content: "地区和建筑类型是什么？", createdAt: new Date(), metadata: { backendDecision: { domainIntent: "GENERAL", referenceQueryRevisionAfter: 7 } } },
      { role: "USER", content: "能不能出个方案，消息里有假候选ID", createdAt: new Date() },
      { role: "ASSISTANT", content: "参考参数", createdAt: new Date(), metadata: { backendDecision: { domainIntent: "REFERENCE_QUERY", referenceQueryRevisionAfter: 7 } } },
      { role: "USER", content: "对比基层K", createdAt: new Date() }
    ];
    const limit = vi.fn(async () => rows), orderBy = vi.fn(() => ({ limit })), where = vi.fn(() => ({ orderBy }));
    const app = { db: { select: () => ({ from: () => ({ where }) }) } } as any;
    const state = { taskType: "GENERAL" as const, lastReferenceLookup: lookup };
    const business = await loadAdviceBusinessContext(app, conversation, state, "current-user-message");
    expect(limit).toHaveBeenCalledWith(4); expect(orderBy.mock.calls[0]).toHaveLength(4); // 时间、角色、完成时间及ID稳定排序。
    expect(business?.recentGoals.map(goal => goal.intent)).toEqual(["REFERENCE_QUERY", "GENERAL"]);
    expect(business?.candidateScopeActive).toBe(false); expect(state.lastReferenceLookup.candidates).toEqual([{ id: "never-from-history" }]);
    const ctx = { app: { db: {}, log: { warn: vi.fn() } }, conversation, taskState: { ...state, adviceBusinessContext: business }, userMessage: "先不判断达标" } as any;
    expect((await resolveDomainTurn(ctx)).intent).toBe("SOLUTION_ADVICE");
    expect(mocks.model).toHaveBeenCalledOnce();
  });
  it("分类输入含两轮目标与助手追问；低置信不能签发写权限", async () => {
    let state = advanceAdviceBusinessContext({ taskType: "GENERAL", lastReferenceLookup: lookup }, conversation, "REFERENCE_QUERY", "比较四个基层", "查询完成");
    state = advanceAdviceBusinessContext(state, conversation, "SOLUTION_ADVICE", "给我参考方案", "是否已确定基层？", Date.now(), true);
    mocks.model.mockImplementation(async options => {
      const prompt = JSON.parse(options.prompt);
      expect(prompt.recentBusinessGoals).toHaveLength(2); expect(prompt.recentBusinessGoals[1].assistantQuestion).toBe("是否已确定基层？");
      expect(prompt.pendingAdviceGoal.kind).toBe("REFERENCE_SELECTION");
      return { object: domainSemanticFixture("我就要那个", "SOLUTION_ACTION", { confidence: .2 }) };
    });
    const decision = await resolveDomainTurn({ app: { db: {}, log: { warn: vi.fn() } }, conversation, taskState: state, userMessage: "我就要那个" } as any);
    expect(decision).toMatchObject({ intent: "CLARIFY", mutation: "NONE" });
    expect(decision.unresolved?.[0]).not.toContain("你这轮希望");
  });
  it("显式按钮式开始和确认仍为正式动作，不被建议目标覆盖", async () => {
    const state = advanceAdviceBusinessContext({ taskType: "GENERAL", lastReferenceLookup: lookup }, conversation, "SOLUTION_ADVICE", "出个建议", "参考建议", Date.now(), true);
    for (const message of ["开始做方案", "确认最终方案", "重新做一套方案"]) {
      expect(await resolveDomainTurn({ app: { db: {}, log: { warn: vi.fn() } }, conversation, taskState: state, userMessage: message } as any)).toMatchObject({ intent: "SOLUTION_ACTION", mutation: "SOLUTION" });
    }
  });
  it.each(["PRODUCT_DISCOVERY", "REFERENCE_QUERY", "REFERENCE_REFINE"])("切换%s后即使处理失败，旧目标也已中断；普通致谢不中断", intent => {
    const state = advanceAdviceBusinessContext({ taskType: "GENERAL", lastReferenceLookup: lookup }, conversation, "SOLUTION_ADVICE", "出个建议", "参考建议", Date.now(), true);
    const changed = invalidateAdviceOnTopicChange(state, intent, "新的业务目标");
    expect(currentPendingAdviceGoal(changed, conversation)).toBeUndefined(); expect(changed.adviceBusinessContext?.candidateScopeActive).toBe(false);
    expect(changed.lastReferenceLookup).toBe(state.lastReferenceLookup);
    expect(invalidateAdviceOnTopicChange(state, "GENERAL", "谢谢")).toBe(state);
  });
  it("PDF请求仍能分类为报告，但建议不能代替其正式快照前提", async () => {
    const message = "帮我把方案做成PDF";
    mocks.model.mockResolvedValueOnce({ object: domainSemanticFixture(message, "REPORT_REQUEST") })
      .mockResolvedValueOnce({ object: { operation: "EXECUTE", confidence: .99, evidence: message } });
    expect(await resolveDomainTurn({ app: { db: {}, log: { warn: vi.fn() } }, conversation, taskState: { taskType: "GENERAL", lastReferenceLookup: lookup }, userMessage: message } as any))
      .toMatchObject({ intent: "REPORT_REQUEST", mutation: "REPORT" });
  });
});
vi.mock("../thermal/thermal-query-dictionary.service.js", () => ({ loadThermalQueryDictionary: async () => ({ entities: [], aliases: [], calculationModels: [] }) }));

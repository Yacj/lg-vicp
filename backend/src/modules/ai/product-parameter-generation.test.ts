import "dotenv/config";
import { EventEmitter } from "node:events";
import { getTableName } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ domain: vi.fn(), parameters: vi.fn(), stream: vi.fn(), events: [] as any[], knowledge: vi.fn(), save: vi.fn(), formal: vi.fn() }));
vi.mock("ai", () => ({ streamText: m.stream }));
vi.mock("./ai-domain-turn-decision.service.js", () => ({ resolveDomainTurn: m.domain }));
vi.mock("./product-parameter-read.service.js", () => ({ readProductParameters: m.parameters }));
vi.mock("./ai-content-filter.service.js", () => ({ checkContentFiltered: async () => null }));
vi.mock("./ai-vision.service.js", () => ({ validateChatImageAttachments: async () => [] }));
vi.mock("./ai-runtime.service.js", () => ({ enforceAiQuota: async () => {}, createConcurrencyRelease: () => async () => {},
  resolveSceneRuntime: async () => ({ primary: { providerId: "provider", providerName: "fixture", modelRef: { id: "model" }, modelId: "fixture", languageModel: {} },
    promptVersionId: "prompt", promptVersionNumber: 1, reasoning: {}, allowKnowledgeSearch: true, fallback: null }) }));
vi.mock("./ai-context-builder.js", () => ({ buildAiContext: async () => ({ system: "", messages: [], droppedEarlyMessages: false }) }));
vi.mock("./ai-agent.service.js", () => ({ getActiveAgentRun: async () => null, cancelRunningAgentRuns: async () => {}, resolveAgentModel: async () => null }));
vi.mock("./ai-conversation-state.service.js", () => ({ getConversationTaskState: async () => ({ taskType: "GENERAL", lastReferenceLookup: {
  query: { filters: [{ metric: "K", targetValue: .2, mode: "APPROX" }] }, candidates: [], candidateQueryRevision: 7, projectId: null, createdAt: new Date().toISOString() } }), saveConversationTaskState: m.save,
  updateConversationSummary: async () => {}, scheduleConversationMaintenance: () => {} }));
vi.mock("./solution-advice-context.service.js", () => ({ loadAdviceBusinessContext: async () => undefined }));
vi.mock("./solution-state.service.js", () => ({ loadActiveSolution: async () => null, isEditableSolution: () => false, startSolution: m.formal, actOnSolution: m.formal, activateSolutionFromLastLookup: m.formal }));
vi.mock("./ai-knowledge-load.js", () => ({ loadKnowledgeForGeneration: m.knowledge }));
vi.mock("../audit-logs/audit-log.service.js", () => ({ writeAuditLog: async () => {} }));
vi.mock("./ai-sse.js", () => ({ startSseStream: () => {}, writeProgress: () => {}, writeSse: (_r: any, event: string, data: any) => m.events.push({ event, data }), isAbortError: () => false }));
import { streamConversationReply } from "./ai-generation.service.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
beforeEach(() => { vi.clearAllMocks(); m.events.length = 0; m.knowledge.mockResolvedValue({ chunks: [], retrievalFailed: false }); });
it("生成编排Mock：参数Service事实直出，保存诊断；不调用回答模型或正式方案", async () => {
  const semantic = domainSemanticFixture("导热系数", "PRODUCT_PARAMETER_QUERY", { parameterQuery: { parameter: "LAMBDA", subjectType: "ANY", subjectText: null, systemText: null,
    targetValue: .3, operator: "EXACT", tolerance: null, unit: "W/(m·K)", evidence: "导热系数" }, pageQuery: null, reference: { scope: "NONE", revision: null, items: [] } });
  m.domain.mockResolvedValue({ intent: "PRODUCT_PARAMETER_QUERY", mutation: "NONE", policyReason: "READ_ONLY_SEMANTIC", semantic });
  m.parameters.mockResolvedValue({ query: semantic.parameterQuery, facts: [], sources: [], answer: "本次搜索范围有独立 λ 参数，但没有符合当前数值条件的记录。", diagnostics: { issues: ["VALUE_NO_MATCH"], scannedCount: 1, matchedCount: 0 } });
  const writes: any[] = [];
  const db: any = { select: () => { const b: any = { from: () => b, where: () => b, limit: async () => [] }; return b; },
    insert: (table: any) => ({ values: (values: any) => ({ returning: async () => [{ ...values, id: values.role === "USER" ? "current" : "assistant" }] }) }),
    update: (table: any) => ({ set: (values: any) => ({ where: async () => { writes.push({ table: getTableName(table), values }); } }) }),
    transaction: async (run: any) => run(db) };
  const app: any = { db, redis: { incr: async () => 1, expire: async () => {}, set: async () => "OK", get: async () => null, exists: async () => 0, del: async () => 1 } };
  const request: any = { id: "req", raw: new EventEmitter(), log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }, reply: any = { raw: { end: vi.fn() } };
  await streamConversationReply({ app, request, reply, user: { id: "u", clientType: "C_APP" } as any,
    conversation: { id: "c", userId: "u", clientApp: "c_app", projectId: null, scene: "general_chat", reasoningMode: "OFF", title: "fixture" } as any, content: "导热系数" });
  expect(m.events.find(e => e.event === "error")).toBeUndefined();
  expect(m.events.filter(e => e.event === "delta").map(e => e.data.text).join("")).toContain("没有符合当前数值条件");
  expect(m.events.find(e => e.event === "done").data.finishReason).toBe("COMPLETED");
  const completed = writes.find(w => w.table === "ai_messages" && w.values.status === "COMPLETED");
  expect(completed.values.metadata.backendDecision).toMatchObject({ domainIntent: "PRODUCT_PARAMETER_QUERY", mutation: "NONE", answerContract: "PRODUCT", toolRoute: ["backend:product_parameter_query"],
    parameterQuery: { targetValue: .3 }, parameterQueryDiagnostics: { issues: ["VALUE_NO_MATCH"] }, factValidationCode: "PARAMETER_SERVICE_FACTS_ONLY", solutionStateMutated: false });
  expect(m.knowledge.mock.calls[0]![0].needSearch).toBe(false); expect(m.stream).not.toHaveBeenCalled(); expect(m.formal).not.toHaveBeenCalled();
  expect(completed.values.metadata.backendDecision.queryChanged).toBe(false);
  expect(m.save.mock.calls.at(-1)![2].lastReferenceLookup).toMatchObject({ candidateQueryRevision: 7, query: { filters: [{ metric: "K", targetValue: .2 }] } });
  expect(writes.every(w => w.table === "ai_messages" || w.table === "ai_conversations")).toBe(true);
});

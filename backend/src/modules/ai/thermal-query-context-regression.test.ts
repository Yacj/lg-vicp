import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generate: vi.fn(), pending: vi.fn() }));
vi.mock("ai", () => ({ generateObject: mocks.generate }));
vi.mock("./ai-runtime.service.js", () => ({ resolveSceneRuntime: async () => ({ primary: { languageModel: {} } }) }));
vi.mock("./reference-fact-history.js", () => ({ readReferenceFactHistory: async () => [] }));
vi.mock("./query-clarification-context.js", async original => ({ ...await original<typeof import("./query-clarification-context.js")>(), readQueryClarification: mocks.pending }));
vi.mock("../thermal/thermal-query-dictionary.service.js", () => ({ loadThermalQueryDictionary: async () => ({ entities: [], aliases: [] }) }));
import { resolveDomainTurn } from "./ai-domain-turn-decision.service.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import { parseSemanticQuery } from "./semantic-query.service.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import { applySemanticQuery } from "../thermal/semantic-query.js";
import { describeNumberRoles } from "../thermal/semantic-query.js";
import { parseThermalLookupMessage } from "../thermal/thermal-lookup-mode.js";
const context = (message: string) => ({ app: { db: {}, log: { warn: vi.fn() } }, conversation: { id: "c", userId: "u", projectId: null, clientApp: "c_app", scene: "general_chat" },
  userMessage: message, taskState: { taskType: "GENERAL" } } as any);
function query(message: string, evidence = message, value = .3) {
  return domainSemanticFixture(message, "REFERENCE_QUERY", { relation: "CONTINUE", effectRequest: null, pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .99,
    constraints: [{ type: "METRIC", operation: "SET", field: null, entityText: null, resolvedText: null, metric: "K", value, operator: "APPROX", evidence, confidence: .99, hard: true }],
    preferences: [], unresolved: [] } });
}
beforeEach(() => { vi.clearAllMocks(); mocks.pending.mockResolvedValue(null); });
it("真实澄清→只回复K：绑定原问数值，既不造候选也不继承别的话题", async () => {
  const ctx = context("我指的是传热系数K。"), original = "保温0.3的材料有么";
  mocks.pending.mockResolvedValue({ messageId: "origin", message: original, question: "指哪个指标？", inheritPrevious: false });
  mocks.generate.mockResolvedValue({ object: { ...query(ctx.userMessage, original), queryContext: "CLARIFICATION_REPLY" } });
  const before = structuredClone(ctx.taskState), decision = await resolveDomainTurn(ctx);
  expect(decision).toMatchObject({ intent: "REFERENCE_QUERY", queryContextMessageId: "origin" });
  const resolved = await parseSemanticQuery({ ...ctx, domainDecision: decision }, {}, { entities: [], aliases: [] });
  expect(resolved).toMatchObject({ needsClarification: false, query: { filters: [{ metric: "K", targetValue: .3, mode: "APPROX" }] } });
  expect(ctx.taskState).toEqual(before);
});
it("过期/换话题缺少待澄清证据时，模型不能伪用旧数值", async () => {
  const message = "我指K";
  mocks.generate.mockResolvedValue({ object: { ...query(message, "保温0.3"), queryContext: "CLARIFICATION_REPLY" } });
  expect(await resolveDomainTurn(context(message))).toMatchObject({ intent: "CLARIFY", policyReason: "QUERY_CONTEXT_EXPIRED" });
});
it.each(["SOLUTION_ACTION", "REPORT_REQUEST", "THERMAL_CALCULATE"] as const)("待澄清不能授权%s", intent => {
  const message = "继续";
  const semantic = domainSemanticFixture(message, intent, { queryContext: "CLARIFICATION_REPLY" });
  expect(applyDomainPolicy(message, semantic)).toMatchObject({ intent: "CLARIFY", mutation: "NONE", policyReason: "QUERY_CONTEXT_INVALID" });
});
it("明确查询条件不能悄悄丢进无条件通用建议；保留条件的Advice仍可查询", () => {
  const message = "外墙传热系数不超过0.3的方案有吗？";
  expect(applyDomainPolicy(message, domainSemanticFixture(message, "SOLUTION_ADVICE"))).toMatchObject({ policyReason: "QUERY_CONDITIONS_DROPPED", mutation: "NONE" });
  expect(applyDomainPolicy(message, domainSemanticFixture(message, "SOLUTION_ADVICE", { constraintPatch: [{ field: "metric", op: "SET", value: .3, evidence: message }] })))
    .toMatchObject({ intent: "SOLUTION_ADVICE", requiresCandidateQuery: true });
});
it("错误的内层THERMAL目标在Domain处拒绝，不把查询合同交下游再次误澄清", () => {
  const message = "K在0.3左右", semantic = query(message);
  semantic.pageQuery!.intent = "THERMAL";
  expect(applyDomainPolicy(message, semantic)).toMatchObject({ intent: "CLARIFY", policyReason: "PAGE_QUERY_INTENT_MISMATCH" });
});
it("中等置信事实读取只允许受控只读服务，低置信和正式操作不借用", () => {
  const message = "你前面说的A3-2是什么", semantic = domainSemanticFixture(message, "KNOWLEDGE_EXPLAIN", { confidence: .86,
    factRead: { mode: "EXPLAIN", metric: null, historyClaim: true, evidence: message } });
  expect(applyDomainPolicy(message, semantic)).toMatchObject({ intent: "KNOWLEDGE_EXPLAIN", mutation: "NONE" });
  expect(applyDomainPolicy(message, { ...semantic, confidence: .79 })).toMatchObject({ intent: "CLARIFY", mutation: "NONE" });
  expect(applyDomainPolicy(message, { ...semantic, requestedEffect: "STATE_MUTATION" })).toMatchObject({ intent: "CLARIFY", mutation: "NONE" });
});
it.each(["外墙K≤0.3", "屋面K≤0.3", "平屋面K≤0.3", "坡屋面K≤0.3", "外墙传热系数不超过0.3"])("SM-PAGE-SCOPE-COVERAGE-01遗漏部位须拒绝，保留部位可查：%s", message => {
  const proposal = query(message).pageQuery!, dictionary = { entities: [], aliases: [] };
  expect(applySemanticQuery(message, proposal, dictionary).unresolved?.some(item => item.field === "applicationPart")).toBe(true);
  const wall = message.startsWith("外墙");
  proposal.constraints.push({ type: "ENTITY", field: "applicationPart", entityText: wall ? "外墙" : "屋面", resolvedText: null,
    operation: "SET", value: null, metric: null, operator: null, evidence: message, confidence: .99, hard: true });
  const result = applySemanticQuery(message, proposal, dictionary);
  expect(result.applicationPart).toBe(wall ? "EXTERNAL_WALL" : "ROOF"); expect(result.unresolved).toEqual([]);
});
it.each(["K≤0.3", "材料K≤0.3", "传热系数K≤0.3", "不限部位K≤0.3", "保温方案K≤0.3"])("未明确部位%s不能由guard猜出外墙", message => {
  const result = applySemanticQuery(message, query(message).pageQuery!, { entities: [], aliases: [] });
  expect(result.applicationPart).toBeUndefined(); expect(result.unresolved).toEqual([]);
});
it("部位校验保留取消、否定与引用，不以词命中补外墙条件或授权", () => {
  const dictionary = { entities: [], aliases: [] }, message = "取消外墙条件，K≤0.3", proposal = query(message).pageQuery!;
  proposal.queryMode = "REFINE_QUERY";
  proposal.constraints.push({ type: "ENTITY", field: "applicationPart", entityText: "外墙", resolvedText: null, operation: "REMOVE", value: null,
    metric: null, operator: null, evidence: "外墙", confidence: .99, hard: true });
  const result = applySemanticQuery(message, proposal, dictionary, { applicationPart: "EXTERNAL_WALL" });
  expect(result.applicationPart).toBeUndefined(); expect(result.unresolved).toEqual([]);
  const negative = "不是外墙而是屋面，K≤0.3", clarified = query(negative).pageQuery!;
  clarified.constraints.push({ type: "ENTITY", field: "applicationPart", entityText: "屋面", resolvedText: null, operation: "SET", value: null,
    metric: null, operator: null, evidence: "屋面", confidence: .99, hard: true });
  expect(applySemanticQuery(negative, clarified, dictionary).applicationPart).toBe("ROOF");
  const quoted = "引用‘外墙’不是查询条件，只查K≤0.3", unresolved = applySemanticQuery(quoted, query(quoted).pageQuery!, dictionary);
  expect(unresolved.applicationPart).toBeUndefined(); expect(unresolved.unresolved?.length).toBeGreaterThan(0);
});
it("遗漏外墙的模型提案只复核一次，仍遗漏则拒绝宽查并保留旧候选", async () => {
  const message = "外墙K不超过0.3", ctx = context(message);
  ctx.taskState.lastReferenceLookup = { query: {}, candidates: [{ id: "old" }], candidateQueryRevision: 7 };
  const before = structuredClone(ctx.taskState), omitted = query(message), corrected = structuredClone(omitted);
  corrected.pageQuery!.constraints.push({ type: "ENTITY", field: "applicationPart", entityText: "外墙", resolvedText: null, operation: "SET", value: null,
    metric: null, operator: null, evidence: "外墙", confidence: .99, hard: true });
  mocks.generate.mockResolvedValueOnce({ object: omitted }).mockResolvedValueOnce({ object: corrected });
  expect(await resolveDomainTurn(ctx)).toMatchObject({ intent: "REFERENCE_QUERY", mutation: "QUERY" });
  expect(mocks.generate).toHaveBeenCalledTimes(2); expect(ctx.taskState).toEqual(before);
  mocks.generate.mockReset().mockResolvedValue({ object: omitted });
  expect(await resolveDomainTurn(ctx)).toMatchObject({ intent: "CLARIFY", mutation: "NONE", policyReason: "PAGE_QUERY_CONSTRAINTS_INVALID" });
  expect(mocks.generate).toHaveBeenCalledTimes(2); expect(ctx.taskState).toEqual(before);
});
it.each(["45厚的3型那种外墙，不同砖墙K差多少？", "35厚的2型外墙，各基层K多少？", "3型45mm的总R是多少？", "1型18厚的产品R？", "2型25mm K参数"])("SM-NUMBER-ROLE-02型号不能变热工目标：%s", message => {
  expect(parseThermalLookupMessage(message).filters).toEqual([]);
  expect(describeNumberRoles(message).every(number => number.role !== "UNKNOWN")).toBe(true);
});
it.each(["K=0.3", "K≤0.2", "R0=3", "产品R=2", "K=3"])("真实指标数值%s仍保留", message => {
  expect(parseThermalLookupMessage(message).filters).toHaveLength(1);
});
it("近似/上限/精确必须由原话及有效历史确定，模型不能把裸目标偷偷当上限", () => {
  const dictionary = { entities: [], aliases: [] };
  for (const [message, mode] of [["K在0.3左右", "APPROX"], ["K不超过0.3", "MAX_LIMIT"], ["K正好0.3", "EXACT"], ["保温0.3的材料有么\n我指K", "APPROX"]] as const) {
    const semantic = query(message).pageQuery!; semantic.constraints[0]!.operator = "MAX_LIMIT";
    expect(applySemanticQuery(message, semantic, dictionary).filters?.[0]?.mode).toBe(mode);
  }
});
it("低置信/超时不改旧候选，不根据澄清上下文恢复副作用", async () => {
  const ctx = context("我指K"); ctx.taskState.lastReferenceLookup = { query: { thicknessMm: 45 }, candidates: [{ id: "old" }], candidateQueryRevision: 7 };
  const before = structuredClone(ctx.taskState);
  mocks.generate.mockResolvedValue({ object: { ...query(ctx.userMessage), confidence: .4 } });
  expect((await resolveDomainTurn(ctx)).mutation).toBe("NONE");
  mocks.generate.mockRejectedValue(new Error("timeout"));
  expect((await resolveDomainTurn(ctx)).parserSource).toBe("UNAVAILABLE");
  expect(ctx.taskState).toEqual(before);
});
it("0.86只读查询必须完整grounding且FACTS_ONLY，正式操作和无合同提案不能借用", async () => {
  const message = "K在0.3左右", semantic = { ...query(message), confidence: .86 };
  mocks.generate.mockResolvedValue({ object: semantic });
  expect(await resolveDomainTurn(context(message))).toMatchObject({ intent: "REFERENCE_QUERY", queryResultMode: "FACTS_ONLY", policyReason: "VERIFY_QUERY_FACTS_ONLY" });
  expect(applyDomainPolicy(message, { ...semantic, pageQuery: null }).intent).toBe("CLARIFY");
  for (const intent of ["SOLUTION_ACTION", "REPORT_REQUEST", "THERMAL_CALCULATE"] as const)
    expect(applyDomainPolicy(message, domainSemanticFixture(message, intent, { confidence: .86 })).intent).toBe("CLARIFY");
  mocks.generate.mockResolvedValue({ object: { ...semantic, pageQuery: { ...semantic.pageQuery!, constraints: [{ ...semantic.pageQuery!.constraints[0]!, value: .9 }] } } });
  expect((await resolveDomainTurn(context(message))).intent).toBe("CLARIFY");
});

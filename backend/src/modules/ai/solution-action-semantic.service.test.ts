import { domainDecision } from "./ai-domain-turn-decision.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generate: vi.fn(), runtime: vi.fn(), audit: vi.fn(), availability: vi.fn() }));
vi.mock("ai", () => ({ generateObject: mocks.generate }));
vi.mock("./ai-runtime.service.js", () => ({ resolveSceneRuntime: mocks.runtime }));
vi.mock("../audit-logs/audit-log.service.js", () => ({ writeAuditLog: mocks.audit }));
vi.mock("./candidate-availability.service.js", () => ({ explainCandidateAvailability: mocks.availability }));
import { parseSolutionAction } from "./solution-action-semantic.service.js";
import { groundSolutionAction, type ParsedSolutionAction, type CandidateReference } from "./solution-action-semantic.js";
import { applySolutionAction, emptySolution, refreshSolution, referenceSolutionCandidate } from "./solution-workflow.js";
const candidates = ["A", "B", "C"].map((id, index) => referenceSolutionCandidate({ id, schemeCode: `A1-${index + 1}`, thicknessMm: [18, 30, 20][index] }));
const pool = () => refreshSolution(emptySolution(), {}, candidates);
const ctx = { domainDecision: domainDecision("SOLUTION_ACTION", "fixture授权"), app: { db: {}, log: { warn: vi.fn() } }, request: {}, user: { id: "user" }, conversation: { id: "conversation", scene: "general_chat" } } as any;
const semantic = (type: ParsedSolutionAction["type"], message: string, references: CandidateReference[] = [], extra: Partial<ParsedSolutionAction> = {}): ParsedSolutionAction => ({
  type, references, selectionMode: "INCLUDE", referenceScope: "CURRENT_POOL", temporalScope: "CURRENT", evidence: message, confidence: .96, unresolved: [], ...extra
});
const position = (value: number, evidence: string): CandidateReference => ({ type: "POSITION", value, evidence });
const thickness = (value: number, evidence: string): CandidateReference => ({ type: "THICKNESS", value, evidence });
beforeEach(() => { vi.resetAllMocks(); mocks.runtime.mockResolvedValue({ primary: { languageModel: {}, modelId: "configured-model" } }); });
it.each(["current", "withdrawn", "changed"])("组合指令的只读资料%s在模型返回后再次核验；失败时Final不部分执行", async variant => {
  const state = pool(), message = "30mm定为最终，分层示例只留在对话中核对";
  const reference = { fingerprint: "fingerprint", label: "分层参考做法", thicknessMm: 45,
    conflict: { kind: "SPEC_THICKNESS_MISMATCH", subject: "参考做法", field: "THICKNESS", usage: "READ_ONLY", observations: [] } };
  const catalog = { queryRevision: state.candidateSetRevision, references: [reference] };
  mocks.availability.mockResolvedValueOnce({ readOnlyCatalog: catalog }).mockResolvedValueOnce(variant === "withdrawn" ? undefined
    : { readOnlyCatalog: variant === "changed" ? { ...catalog, references: [{ ...reference, fingerprint: "new-source" }] } : catalog });
  mocks.generate.mockResolvedValue({ object: { references: [thickness(30, "30mm")],
    readOnlyReferences: [{ label: reference.label, evidence: "分层示例", thicknessEvidence: null }],
    comparisonReferences: [], selectionMode: "INCLUDE", temporalScope: "CURRENT", evidence: message, unresolved: [] } });
  const goal = domainSemanticFixture(message, "SOLUTION_ACTION", { solutionOperation: "SET_FINAL", confidence: .96 });
  const parsed = await parseSolutionAction({ ...ctx, domainDecision: { ...domainDecision("SOLUTION_ACTION", message), semantic: goal } }, message, state);
  if (variant === "current") expect(parsed).toMatchObject({ action: "SET_FINAL", candidateIds: ["B"], chatReferenceRetention: { references: [reference] } });
  else expect(parsed).toHaveProperty("clarification");
  expect(state.finalCandidateIds).toEqual([]);expect(mocks.availability).toHaveBeenCalledTimes(2);
  expect(JSON.parse(mocks.generate.mock.calls[0]![0].prompt).readOnlyCatalog).toEqual([{ label: reference.label, thicknessMm: 45, usage: "CHAT_ONLY" }]);
});
it("独立已授权动作只解析引用，操作置信来自完整原话目标；唯一身份仍由Backend绑定", async () => {
  const message = "采用刚才这套作为最终方案", goal = domainSemanticFixture(message, "SOLUTION_ACTION", { solutionOperation: "SET_FINAL", confidence: .96 });
  const decision = { ...domainDecision("SOLUTION_ACTION", message), semantic: goal, referenceFocusIds: ["B"] };
  const raw = { references: [{ type: "CURRENT_REFERENCE", evidence: "这套" }], selectionMode: "INCLUDE", temporalScope: "CURRENT", evidence: message, unresolved: [] };
  mocks.generate.mockResolvedValue({ object: raw });
  const result = await parseSolutionAction({ ...ctx, domainDecision: decision }, message, pool());
  expect(result).toMatchObject({ action: "SET_FINAL", candidateIds: ["B"], semantic: { confidence: .96 } });
  expect(mocks.generate.mock.calls[0]![0].system).toContain("不再分类操作");
  expect(JSON.parse(mocks.generate.mock.calls[0]![0].prompt).currentReferencePositions).toEqual([2]);
  expect(await parseSolutionAction({ ...ctx, domainDecision: { ...decision, referenceFocusIds: ["A", "B"] } }, message, pool())).toHaveProperty("clarification");
});
it("采用与阅读并行时只将已核验阅读字段交给引用层，不能把解释歧义变成身份或放过未知筛选条件", async () => {
  const message = "先采用30mm那套，也解释它的保温参数", state = pool();
  const goal = domainSemanticFixture(message, "SOLUTION_ACTION", { solutionOperation: "SELECT", confidence: .96,
    referenceReadFields: ["productResistance"] });
  const decision = { ...domainDecision("SOLUTION_ACTION", message), semantic: goal, referenceFocusIds: ["B"] };
  const raw = { references: [thickness(30, "30mm那套")], selectionMode: "INCLUDE", temporalScope: "CURRENT", evidence: message, unresolved: [] };
  mocks.generate.mockResolvedValue({ object: raw });
  expect(await parseSolutionAction({ ...ctx, domainDecision: decision }, message, state)).toMatchObject({ action: "SELECT", candidateIds: ["B"] });
  expect(JSON.parse(mocks.generate.mock.calls[0]![0].prompt).independentReadFields).toEqual(["productResistance"]);
  mocks.generate.mockResolvedValue({ object: { ...raw, unresolved: ["用户要求的价格未提供"] } });
  expect(await parseSolutionAction({ ...ctx, domainDecision: decision }, message, state)).toHaveProperty("clarification");
  mocks.generate.mockResolvedValue({ object: { ...raw, references: [position(1, "30mm那套"), thickness(30, "30mm那套")] } });
  expect(await parseSolutionAction({ ...ctx, domainDecision: decision }, message, state)).toHaveProperty("clarification");
  expect(state.selectedCandidateIds).toEqual([]);
});
it("直接目标携带Revision时，完整会话状态必须传到操作复核，不能误退回旧动作解析", async () => {
  const state = pool(), message = "把当前这套定为最终方案", goal = domainSemanticFixture(message, "SOLUTION_ACTION", {
    solutionOperation: "SET_FINAL", reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: state.candidateSetRevision, items: [] }
  });
  const raw = { references: [{ type: "CURRENT_REFERENCE", evidence: "这套" }], selectionMode: "INCLUDE", temporalScope: "CURRENT", evidence: message, unresolved: [] };
  mocks.generate.mockResolvedValue({ object: raw });
  const decision = { ...domainDecision("SOLUTION_ACTION", message), semantic: goal, referenceFocusIds: ["B"] };
  const taskState = { taskType: "GENERAL" as const, lastReferenceLookup: { query: {}, candidates: state.candidates.map(item => item.candidate),
    candidateQueryRevision: state.candidateSetRevision, createdAt: new Date().toISOString() } };
  expect(await parseSolutionAction({ ...ctx, taskState, domainDecision: decision }, message, state)).toMatchObject({ action: "SET_FINAL", candidateIds: ["B"] });
  taskState.lastReferenceLookup.candidateQueryRevision++;
  expect(await parseSolutionAction({ ...ctx, taskState, domainDecision: decision }, message, state)).toHaveProperty("clarification");
});
it.each(["inventedId", "CONFIRM", "unknownCriterion", "scopeOverride"])("引用层%s不能扩大已授权动作或跳过来源门禁", async failure => {
  const message = "把这套作为最终方案", goal = domainSemanticFixture(message, "SOLUTION_ACTION", { solutionOperation: "SET_FINAL" });
  const raw: any = { references: [{ type: "CURRENT_REFERENCE", evidence: "这套" }], selectionMode: "INCLUDE", temporalScope: "CURRENT", evidence: message, unresolved: [] };
  if (failure === "inventedId") raw.candidateId = "B";
  if (failure === "CONFIRM") raw.type = "CONFIRM";
  if (failure === "scopeOverride") raw.referenceScope = "CURRENT_SELECTION";
  if (failure === "unknownCriterion") raw.unresolved = ["未提供所需价格依据"];
  mocks.generate.mockResolvedValue({ object: raw });
  expect(await parseSolutionAction({ ...ctx, domainDecision: { ...domainDecision("SOLUTION_ACTION", message), semantic: goal, referenceFocusIds: ["B"] } }, message, pool())).toHaveProperty("clarification");
});
describe("Solution Action Semantic Parser → Grounding → 既有mutation", () => {
  it.each([
    ["1和3先留着", "SELECT", [position(1, "1"), position(3, "3")], ["A", "C"]],
    ["第三套先撤掉", "REMOVE", [position(3, "第三套")], ["C"]],
    ["18和20厚那两个加进来", "ADD", [thickness(18, "18"), thickness(20, "20厚")], ["A", "C"]],
    ["前两个加进方案", "ADD", [{ type: "POOL_PREFIX", value: 2, evidence: "前两个" }], ["A", "B"]],
    ["最终我就要第一和第三个", "SET_FINAL", [position(1, "第一"), position(3, "第三个")], ["A", "C"]]
  ] as const)("开放自然表达%s调用LLM并映射正式身份", async (message, type, refs, ids) => {
    const state = pool(); mocks.generate.mockResolvedValue({ object: semantic(type, message, [...refs]) });
    const parsed = await parseSolutionAction(ctx, message, state);
    expect(mocks.generate).toHaveBeenCalledTimes(1); expect(parsed).toMatchObject({ action: type, candidateIds: [...ids], parserSource: "LLM" });
    const changed = applySolutionAction(state, { action: parsed!.action, expectedVersion: 1, candidateIds: parsed!.candidateIds });
    if (type === "REMOVE") expect(changed.rejectedCandidateIds).toEqual(ids);
    else expect(changed.selectedCandidateIds).toEqual(ids);
  });
  it("除了第二个其他都先保留：排除引用由后端做集合运算", async () => {
    const message = "除了第二个其他都先保留";
    mocks.generate.mockResolvedValue({ object: semantic("SELECT", message, [position(2, "第二个")], { selectionMode: "EXCLUDE" }) });
    expect((await parseSolutionAction(ctx, message, pool()))?.candidateIds).toEqual(["A", "C"]);
  });
  it("旧已选厚度引用从Selected定位，不猜新列表序号", async () => {
    let state = applySolutionAction(pool(), { action: "ADD", expectedVersion: 1, candidateIds: ["B"] });
    state = refreshSolution(state, {}, [candidates[0]!]);
    const message = "刚才选的30厚那个不要了";
    mocks.generate.mockResolvedValue({ object: semantic("REMOVE", message, [thickness(30, "30厚")], { referenceScope: "CURRENT_SELECTION" }) });
    expect((await parseSolutionAction(ctx, message, state))?.candidateIds).toEqual(["B"]);
  });
  it("只读比较交还领域路由，不调用动作模型或选择全池", async () => {
    const message = "这几个帮我比较一下";
    mocks.generate.mockResolvedValue({ object: semantic("COMPARE_SELECTED", message) });
    const parsed = await parseSolutionAction({ ...ctx, domainDecision: domainDecision("COMPARE_CANDIDATES", message) }, message, pool());
    expect(parsed).toBeNull(); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("这几个帮我做方案显式SELECT当前全部查询候选", async () => {
    const message = "这几个帮我做方案";
    mocks.generate.mockResolvedValue({ object: semantic("SELECT", message, [{ type: "CURRENT_POOL", evidence: "这几个" }]) });
    expect(await parseSolutionAction(ctx, message, pool())).toMatchObject({ action: "SELECT", candidateIds: ["A", "B", "C"] });
  });
  it.each(["保温0.3有材料么", "薄抹灰K0.3左右有方案么", "你好", "保温板有哪些特点"])("没有候选时普通提问%s不调用方案动作模型", async message => {
    mocks.generate.mockRejectedValue(new Error("JSON模式请求被拒绝"));
    expect(await parseSolutionAction(ctx, message, emptySolution())).toBeNull();
    expect(mocks.runtime).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("真实UAT回归：有候选时JSON模式提示词兼容要求，普通查询NONE不拦截问答", async () => {
    const message = "保温0.3有材料么";
    mocks.generate.mockImplementation(async input => {
      expect(input.output).toBe("no-schema");
      expect(input).not.toHaveProperty("schema");
      if (!/json/i.test(`${input.system}\n${input.prompt}`))
        throw new Error("Prompt must contain the word 'json' in some form to use 'response_format' of type 'json_object'.");
      const schema = JSON.parse(input.system.split("JSON Schema：")[1].split("\n")[0]);
      expect(schema.properties.type.enum).toContain("NONE");
      expect(schema.properties.evidence.type).toBe("string");
      expect(schema.properties.unresolved.type).toBe("array");
      expect(schema.properties).not.toHaveProperty("action");
      return { object: semantic("NONE", message) };
    });
    expect(await parseSolutionAction({ ...ctx, domainDecision: domainDecision("REFERENCE_QUERY", message) }, message, pool())).toBeNull();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("有lookup候选的首次选择保留LLM与Grounding，不被无active守卫跳过", async () => {
    const message = "第一个和第三个留下";
    mocks.generate.mockImplementation(async input => {
      expect(input.system).toMatch(/JSON/i);
      return { object: semantic("SELECT", message, [position(1, "第一个"), position(3, "第三个")]) };
    });
    const state = pool(), before = structuredClone(state);
    expect(await parseSolutionAction(ctx, message, state)).toMatchObject({ action: "SELECT", candidateIds: ["A", "C"] });
    expect(state).toEqual(before);
  });
  it("JSON网关失败日志仅记录错误类型和HTTP码，不记录用户原话或响应正文", async () => {
    const error = Object.assign(new Error("私密响应正文"), { statusCode: 400 });
    mocks.generate.mockRejectedValue(error);
    expect(await parseSolutionAction(ctx, "第一个留下", pool())).toMatchObject({ parserSource: "UNAVAILABLE", clarification: expect.any(String) });
    expect(ctx.app.log.warn).toHaveBeenCalledWith({ parserSource: "UNAVAILABLE", errorType: "Error", statusCode: 400 }, expect.any(String));
    expect(JSON.stringify(ctx.app.log.warn.mock.calls)).not.toContain("私密响应正文");
    expect(JSON.stringify(ctx.app.log.warn.mock.calls)).not.toContain("第一个留下");
  });
  it.each(["candidateId", "thermalReferenceRowId", "schemeId"])("结构化输出伪造%s被schema拒绝，State不变", async field => {
    const state = pool(), frozen = structuredClone(state), message = "1和3先留着";
    mocks.generate.mockResolvedValue({ object: { ...semantic("SELECT", message, [position(1, "1")]), [field]: "invented" } });
    expect((await parseSolutionAction(ctx, message, state))?.clarification).toBeTruthy(); expect(state).toEqual(frozen);
  });
  it.each([
    ["第三套先撤掉", [position(99, "第三套")]],
    ["18厚那个留下", [thickness(30, "18厚")]],
    ["A9-9留下", [{ type: "CONSTRUCTION_CODE", value: "A9-9", evidence: "A9-9" }]]
  ] as const)("非法/不存在引用%s只澄清", async (message, refs) => {
    const state = pool(), frozen = structuredClone(state);
    mocks.generate.mockResolvedValue({ object: semantic("SELECT", message, [...refs]) });
    expect((await parseSolutionAction(ctx, message, state))?.clarification).toBeTruthy(); expect(state).toEqual(frozen);
  });
  it("相同厚度多个候选必须澄清；版本变化不能沿用旧序号", () => {
    const state = pool(); state.candidates[1]!.candidate.thicknessMm = 18;
    expect(groundSolutionAction("18厚那个留下", semantic("SELECT", "18厚那个留下", [thickness(18, "18厚")]), state, 1)?.clarification).toBeTruthy();
    expect(groundSolutionAction("1留下", semantic("SELECT", "1留下", [position(1, "1")]), state, 0)?.clarification).toBeTruthy();
  });
  it.each(["可以", "行", "就这样", "没问题"])("%s不调用模型且不确认", async message => {
    expect(await parseSolutionAction(ctx, message, pool())).toBeNull(); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it.each(["确认生成方案", "确认最终方案", "确认提交"])("%s走确认Fast Path", async message => {
    expect(await parseSolutionAction(ctx, message, pool())).toMatchObject({ action: "CONFIRM", parserSource: "FAST_PATH" });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("LLM不能提出CONFIRM_FINAL；普通查询NONE不触发mutation", async () => {
    mocks.generate.mockResolvedValueOnce({ object: { ...semantic("SELECT", "帮忙确认一下"), type: "CONFIRM_FINAL" } });
    expect((await parseSolutionAction(ctx, "帮忙确认一下", pool()))?.clarification).toBeTruthy();
    mocks.generate.mockResolvedValueOnce({ object: semantic("NONE", "有没有更薄的") });
    expect(await parseSolutionAction(ctx, "有没有更薄的", pool())).toBeNull();
  });
  it("模型故障/低置信度不回退到猜测动作", async () => {
    mocks.generate.mockRejectedValueOnce(new Error("模型暂不可用"));
    expect(await parseSolutionAction(ctx, "1和3先留着", pool())).toMatchObject({ parserSource: "UNAVAILABLE", clarification: expect.any(String) });
    mocks.generate.mockResolvedValueOnce({ object: semantic("SELECT", "1留下", [position(1, "1")], { confidence: .5 }) });
    expect((await parseSolutionAction(ctx, "1留下", pool()))?.clarification).toBeTruthy();
  });
  it("复用既有热工符号Fast Path，不额外依赖动作模型", async () => {
    expect(await parseSolutionAction({ ...ctx, domainDecision: domainDecision("REFERENCE_QUERY", "K<=0.3") }, "K<=0.3", pool())).toBeNull(); expect(mocks.generate).not.toHaveBeenCalled();
  });
  it("批量引用任一项非法或嵌套伪造ID，整个动作澄清；Prompt不含正式候选ID", async () => {
    const state = pool(), frozen = structuredClone(state), message = "1和99先留着";
    mocks.generate.mockResolvedValueOnce({ object: semantic("SELECT", message, [position(1, "1"), position(99, "99")]) });
    expect((await parseSolutionAction(ctx, message, state))?.clarification).toBeTruthy(); expect(state).toEqual(frozen);
    const prompt = JSON.parse(mocks.generate.mock.calls[0]![0].prompt);
    expect(prompt.pool[0]).not.toHaveProperty("candidateId"); expect(prompt.pool[0]).not.toHaveProperty("id");
    mocks.generate.mockResolvedValueOnce({ object: semantic("SELECT", message, [{ ...position(1, "1"), candidateId: "fake" } as any]) });
    expect((await parseSolutionAction(ctx, message, state))?.clarification).toBeTruthy(); expect(state).toEqual(frozen);
  });
});

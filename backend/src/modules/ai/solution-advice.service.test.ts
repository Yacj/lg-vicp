import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
const mocks = vi.hoisted(() => ({ access: vi.fn(), read: vi.fn(), current: vi.fn(), active: vi.fn(), mutate: vi.fn(), snapshot: vi.fn(), report: vi.fn(),
  model: vi.fn(), runtime: vi.fn(), calc: vi.fn(), query: vi.fn(), audit: vi.fn(), dictionary: vi.fn() }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: mocks.access, loadActiveSolution: mocks.active,
  actOnSolution: mocks.mutate, getSolutionSnapshot: mocks.snapshot }));
vi.mock("./reference-candidate-source.service.js", () => ({ referenceRowsStillCurrent: mocks.current }));
vi.mock("./ai-reference-pages.service.js", async original => ({ ...await original<typeof import("./ai-reference-pages.service.js")>(), readConsumableReferencePages: mocks.read }));
vi.mock("ai", async original => ({ ...await original<typeof import("ai")>(), generateObject: mocks.model }));
vi.mock("./ai-runtime.service.js", () => ({ resolveSceneRuntime: mocks.runtime }));
vi.mock("./reference-fact-history.js", () => ({ readReferenceFactHistory: async () => [] }));
vi.mock("../reports/report-snapshot.service.js", () => ({ generateTemplateReport: mocks.report }));
vi.mock("../thermal/thermal-query-dictionary.service.js", () => ({ loadThermalQueryDictionary: mocks.dictionary }));
vi.mock("../thermal/thermal-calc.service.js", () => ({ executeThermalCalc: mocks.calc }));
vi.mock("./solution-candidate-query.service.js", () => ({ querySolutionCandidates: mocks.query }));
vi.mock("../audit-logs/audit-log.service.js", () => ({ writeAuditLog: mocks.audit }));
import { resolveDomainTurn } from "./ai-domain-turn-decision.service.js";
import { domainDecision } from "./ai-domain-turn-decision.js";
import { resolveSolutionAdvice, emitSolutionAdvice } from "./solution-advice.service.js";
import { advanceAdviceBusinessContext, currentPendingAdviceGoal } from "./solution-advice-context.js";
import { loadPublishedKnowledgeReferences } from "./ai-reference-pages.service.js";
import { solutionAdviceFixture } from "./solution-advice.fixture.js";
import { parseConversationTaskState, type ConversationTaskState } from "./conversation-task.js";
import { startSseStream, writeSse } from "./ai-sse.js";
import { parseSolutionAction } from "./solution-action-semantic.service.js";
import { emptySolution, refreshSolution, referenceSolutionCandidate } from "./solution-workflow.js";
import { generateConfirmedSolutionReport } from "./solution-report.service.js";
import { resolveComplianceRead } from "./compliance-read.service.js";
import { ForbiddenError } from "../../shared/errors.js";

const question = "Ⅲ型VICP薄抹灰外保温系统，45mm厚度，不同基层的传热系数有什么区别？";
const conversation = { id: "advice-conversation", projectId: null, scene: "general_chat" };
function appFixture() {
  const { rows } = solutionAdviceFixture();
  const insert = vi.fn(() => { throw new Error("只读建议禁止insert"); }), update = vi.fn(() => { throw new Error("只读建议禁止update"); });
  const db = { insert, update, select: (fields: any) => { const q: any = { from: () => q, innerJoin: () => q,
    where: async () => fields?.page ? rows : rows.map(row => ({ id: row.page.id })) }; return q; } };
  return { db, log: { warn: vi.fn() }, storage: { createDownloadUrl: vi.fn() } } as any;
}
function context(app: any, state: ConversationTaskState, message: string) { return { app, taskState: state, conversation, userMessage: message,
  request: {}, user: { id: "advice-user", clientType: "C_APP" }, candidateQueryRevision: state.lastReferenceLookup?.candidateQueryRevision } as any; }
async function queriedState(app: any) {
  const result = await loadPublishedKnowledgeReferences(app, [{ versionId: "advice-version", documentId: "advice-doc", pageId: "advice-page-5" }] as any, null, question);
  expect(result.totalMatched).toBe(4);
  const state: ConversationTaskState = { taskType: "GENERAL", lastReferenceLookup: { query: result.query!, candidates: result.solutionCandidates!,
    candidateQueryRevision: 7, projectId: null, createdAt: new Date().toISOString() } };
  return advanceAdviceBusinessContext(state, conversation, "REFERENCE_QUERY", question, result.answer!);
}
async function adviceTurn(app: any, state: ConversationTaskState, message: string) {
  const ctx = context(app, state, message);
  const decision = await resolveDomainTurn(ctx);
  expect(decision).toMatchObject({ intent: "SOLUTION_ADVICE", mutation: "NONE" });
  const before = JSON.stringify(state.lastReferenceLookup);
  const result = await resolveSolutionAdvice({ ...ctx, domainDecision: decision });
  expect(JSON.stringify(state.lastReferenceLookup)).toBe(before);
  const next = advanceAdviceBusinessContext(state, conversation, decision.intent, message, result.answer, Date.now(), result.verified);
  return { result, state: parseConversationTaskState(next), decision };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.access.mockResolvedValue({ projectId: null }); mocks.read.mockResolvedValue(solutionAdviceFixture().rows);
  mocks.current.mockResolvedValue(true); mocks.active.mockResolvedValue(null); mocks.runtime.mockResolvedValue({ primary: { languageModel: {} } }); mocks.model.mockImplementation(async options => ({ object: domainSemanticFixture(JSON.parse(options.prompt).message, "SOLUTION_ADVICE") }));
  mocks.dictionary.mockResolvedValue({ entities: [], aliases: [] });
});

describe("方案建议多轮事实门禁（模拟数据库，非线上UAT）", () => {
  it("四基层查询→出方案→移除地区建筑范围，建议有四个基层分支和确认来源，业务表零写入", async () => {
    const app = appFixture(); let state = await queriedState(app);
    const formalTables = { solution_states: [], solution_snapshots: [], reports: [] };
    const counts = structuredClone(formalTables);
    for (const message of ["能不能出个方案", "不要根据地区 和 建筑 出个通用方案"]) {
      const turn = await adviceTurn(app, state, message); state = turn.state;
      expect(turn.result.verified).toBe(true); expect(turn.result.candidates).toHaveLength(4);
      expect(turn.result.answer).toContain("200mm 钢筋混凝土"); expect(turn.result.answer).toContain("190mm 混凝土空心砌块");
      expect(turn.result.answer).toContain("240mm 蒸压灰砂砖"); expect(turn.result.answer).toContain("200mm 加气混凝土砌块");
      expect(turn.result.answer).not.toContain("0.248"); expect(turn.result.answer).not.toContain("你这轮希望");
      expect(turn.result.answer).toContain("不能为了较小的 K 值随意替换");
      expect(turn.result.referencePages.map(page => [page.page.pageLabel, page.matches.length])).toEqual([["5", 2], ["6", 2]]);
      expect(currentPendingAdviceGoal(state, conversation)).toMatchObject({ candidateQueryRevision: 7 });
    }
    expect(formalTables).toEqual(counts); expect(app.db.insert).not.toHaveBeenCalled(); expect(app.db.update).not.toHaveBeenCalled();
    for (const mock of [mocks.mutate, mocks.snapshot, mocks.report, mocks.calc, mocks.query, mocks.dictionary]) expect(mock).not.toHaveBeenCalled();
  });
  it.each(["帮我整理一个初步方案", "按刚才的数据给建议", "先不考虑地区，来个参考选型", "不用生成报告，只给个大致方案", "不需要合规结论，只做参考选型", "无需合规结论，给个参考选型"])("同义咨询 %s 使用有效候选", async message => {
    const app = appFixture(); const state = await queriedState(app);
    expect((await adviceTurn(app, state, message)).result.verified).toBe(true);
    expect(mocks.report).not.toHaveBeenCalled(); expect(mocks.calc).not.toHaveBeenCalled();
  });
  it("方案目标继续：先不判断达标；历史助手追问地区可用作目标证据，不用作工程事实", async () => {
    const app = appFixture(); let state = await queriedState(app);
    state = (await adviceTurn(app, state, "先给我个参考方案")).state;
    expect((await adviceTurn(app, state, "先不判断达标")).result.verified).toBe(true);
    state.pendingAdviceGoal = undefined;
    state.adviceBusinessContext!.recentGoals = [{ intent: "GENERAL", userGoal: "能不能出个方案", assistantQuestion: "地区和建筑类型是什么？" }];
    expect((await adviceTurn(app, state, "先不判断达标")).result.verified).toBe(true);
  });
  it("旧版GENERAL中的建议目标只能由单次语义合同恢复，且仍核验当前来源", async () => {
    const app = appFixture(); const state = await queriedState(app);
    state.adviceBusinessContext!.candidateScopeActive = false;
    state.adviceBusinessContext!.recentGoals.push({ intent: "GENERAL", userGoal: "能不能出个方案", assistantQuestion: "地区和建筑类型是什么？" });
    const message = "不要根据地区和建筑，出个通用方案";
    mocks.model.mockResolvedValue({ object: domainSemanticFixture(message, "SOLUTION_ADVICE", { continuedGoal: { recentTurn: 1, intent: "SOLUTION_ADVICE", evidence: "能不能出个方案" } }) });
    const turn = await adviceTurn(app, state, message);
    expect(turn.decision.restoreAdviceGoal).toBe(true); expect(turn.result.verified).toBe(true);
    expect(mocks.mutate).not.toHaveBeenCalled(); expect(mocks.calc).not.toHaveBeenCalled();
    state.adviceBusinessContext!.recentGoals[1]!.intent = "PRODUCT_DISCOVERY";
    expect((await resolveDomainTurn(context(app, state, message))).intent).toBe("CLARIFY");
  });
  it("只读建议点名A3-3复用正式编码提取，前缀不影响同源optionId身份", async () => {
    const app = appFixture(); const state = await queriedState(app); const message = "按A3-3给我参考选型";
    mocks.model.mockResolvedValue({ object: domainSemanticFixture(message, "SOLUTION_ADVICE", { reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: 7,
      items: [{ type: "CONSTRUCTION_CODE", value: "A3-3", evidence: "A3-3" }] } }) });
    const result = (await adviceTurn(app, state, message)).result;
    expect(result.candidates).toHaveLength(1); expect(result.candidates[0]!.constructionCode).toBe("外墙A3-3");
    expect(result.referencePages[0]!.page.pageLabel).toBe("6");
  });
  it("概念问答→请求方案，没有已知候选时仅给框架和必要范围，不编造参数", async () => {
    const app = appFixture();
    let state = advanceAdviceBusinessContext({ taskType: "GENERAL" }, conversation, "KNOWLEDGE_EXPLAIN", "K和R₀有什么区别", "指标解释");
    const result = await adviceTurn(app, state, "给我个方案");
    expect(result.result.verified).toBe(false); expect(result.result.answer).toContain("哪个保温体系");
    expect(result.result.candidates).toEqual([]); expect(result.result.answer).not.toMatch(/K=|R₀=|0\.302/); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("产品话题切换后不得暗用旧候选，过期目标也不能从旧文本恢复", async () => {
    const app = appFixture(); let state = await queriedState(app);
    state = (await adviceTurn(app, state, "出个参考方案")).state;
    state = advanceAdviceBusinessContext(state, conversation, "PRODUCT_DISCOVERY", "你们有哪些产品", "产品目录");
    expect(currentPendingAdviceGoal(state, conversation)).toBeUndefined();
    mocks.read.mockClear(); const { result } = await adviceTurn(app, state, "出个方案");
    expect(result.verified).toBe(false); expect(result.answer).toContain("这轮要讨论哪个保温体系"); expect(result.candidates).toEqual([]); expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(["revision", "project", "conversation", "expiredContext", "expiredCandidates", "futureCandidates", "invalidCandidates", "withdrawnSource", "changedOption"])("%s拒绝失效事实", async failure => {
    const app = appFixture(); const state = await queriedState(app);
    if (failure === "revision") state.lastReferenceLookup!.candidateQueryRevision = 8;
    if (failure === "project") state.lastReferenceLookup!.projectId = "other-project";
    if (failure === "conversation") state.adviceBusinessContext!.conversationId = "other-conversation";
    if (failure === "expiredContext") state.adviceBusinessContext!.createdAt = new Date(Date.now() - 25 * 3600_000).toISOString();
    if (failure === "expiredCandidates") state.lastReferenceLookup!.createdAt = new Date(Date.now() - 25 * 3600_000).toISOString();
    if (failure === "futureCandidates") state.lastReferenceLookup!.createdAt = new Date(Date.now() + 3600_000).toISOString();
    if (failure === "invalidCandidates") state.lastReferenceLookup!.candidateResultInvalid = true;
    if (failure === "withdrawnSource") mocks.read.mockResolvedValue([]);
    if (failure === "changedOption") state.lastReferenceLookup!.candidates[0]!.optionId = "old-id";
    const { result } = await adviceTurn(app, state, "给我个参考方案");
    expect(result.verified).toBe(false); expect(result.candidates).toEqual([]); expect(result.referencePages).toEqual([]);
    expect(result.answer).not.toMatch(/0\.302|0\.248|R₀=/);
  });
  it("用户/客户端无权限时沿用来源Resolver归属拒绝", async () => {
    const app = appFixture(); const state = await queriedState(app);
    mocks.access.mockRejectedValue(new ForbiddenError("无权访问会话"));
    await expect(adviceTurn(app, state, "给个通用方案")).rejects.toThrow("无权访问会话");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("既有地区/建筑字段只从建议校验视图移除，正式QueryState不改变", async () => {
    const app = appFixture(); const state = await queriedState(app);
    Object.assign(state.lastReferenceLookup!.query, { regionCode: "shanghai", buildingType: "住宅", standardLimitId: "limit" });
    const query = structuredClone(state.lastReferenceLookup!.query);
    expect((await adviceTurn(app, state, "不要考虑地区和建筑类型，先给我通用方案")).result.verified).toBe(true);
    expect(state.lastReferenceLookup!.query).toEqual(query);
  });
  it("同厚度的建议复用已展示事实；本轮明确改厚度交给Refine，不用旧45mm冒充40mm方案", async () => {
    const app = appFixture(); const state = await queriedState(app);
    expect((await adviceTurn(app, state, "按45mm现有数据给参考建议")).result.verified).toBe(true);
    mocks.model.mockResolvedValue({ object: domainSemanticFixture("帮我出方案，厚度改成40", "SOLUTION_ADVICE", { constraintPatch: [{ field: "thicknessMm", op: "SET", value: 40, evidence: "厚度改成40" }] }) });
    expect(await resolveDomainTurn(context(app, state, "帮我出方案，厚度改成40"))).toMatchObject({ intent: "SOLUTION_ADVICE", mutation: "NONE", requiresCandidateQuery: true });
    expect(state.lastReferenceLookup?.query.thicknessMm).toBe(45);
  });
  it("正式加入继续经过动作Grounding，建议不能触发SELECT/Final/Confirm", async () => {
    const app = appFixture(); const state = await queriedState(app);
    const ctx = context(app, state, "把第一个加入方案");
    mocks.model.mockResolvedValue({ object: domainSemanticFixture(ctx.userMessage, "SOLUTION_ACTION") });
    const decision = await resolveDomainTurn(ctx); expect(decision.intent).toBe("SOLUTION_ACTION");
    const payload = refreshSolution(emptySolution(), state.lastReferenceLookup!.query, state.lastReferenceLookup!.candidates.map(referenceSolutionCandidate));
    mocks.runtime.mockResolvedValue({ primary: { languageModel: {}, modelId: "fixture" } });
    mocks.model.mockResolvedValue({ object: { type: "ADD", references: [{ type: "POSITION", value: 1, evidence: "第一个" }],
      selectionMode: "INCLUDE", referenceScope: "CURRENT_POOL", temporalScope: "CURRENT", evidence: "加入方案", confidence: .99, unresolved: [] } });
    expect(await parseSolutionAction({ ...ctx, domainDecision: decision }, ctx.userMessage, payload)).toMatchObject({ action: "ADD", candidateIds: [payload.poolCandidateIds[0]] });
  });
  it("未传本轮已核验授权的正式报告仍拒绝；上海住宅合规仍独立且无标准不声称达标", async () => {
    const app = appFixture(); const state = await queriedState(app);
    mocks.model.mockResolvedValue({ object: domainSemanticFixture("直接生成正式报告", "REPORT_REQUEST") });
    expect((await resolveDomainTurn(context(app, state, "直接生成正式报告"))).intent).toBe("REPORT_REQUEST");
    expect(await generateConfirmedSolutionReport(context(app, state, "直接生成正式报告"))).toMatchObject({ ok: false, code: "REPORT_AUTHORIZATION_REQUIRED" });
    expect(mocks.report).not.toHaveBeenCalled(); expect(mocks.snapshot).not.toHaveBeenCalled();
    const ctx = context(app, state, "上海住宅能达标吗"); mocks.model.mockResolvedValue({ object: domainSemanticFixture(ctx.userMessage, "COMPLIANCE_CHECK") }); ctx.domainDecision = await resolveDomainTurn(ctx);
    expect(ctx.domainDecision.intent).toBe("COMPLIANCE_CHECK");
    mocks.dictionary.mockResolvedValue({ entities: [{ field: "regionCode", value: "shanghai", names: ["上海"] }, { field: "buildingType", value: "住宅", names: ["住宅"] }], aliases: [] });
    app.db.select = () => ({ from: () => ({ where: async () => [] }) });
    const result = await resolveComplianceRead(ctx); expect(result.compliance.status).toBe("UNAVAILABLE"); expect(result.facts.canonicalAnswers[0]).toContain("没有该地区");
    expect(mocks.calc).not.toHaveBeenCalled();
  });
  it.each(["low", "timeout", "parse"])("分类%s对咨询安全降级；正式动作不可借低置信变更", async failure => {
    const app = appFixture(); const state = await queriedState(app);
    mocks.runtime.mockResolvedValue({ primary: { languageModel: {} } });
    if (failure === "low") mocks.model.mockResolvedValue({ object: { intent: "SOLUTION_ADVICE", confidence: .3, evidence: "刚才", unresolved: "理解不确定" } });
    if (failure === "timeout") mocks.model.mockRejectedValue(new DOMException("超时", "TimeoutError"));
    if (failure === "parse") mocks.model.mockResolvedValue({ object: { invalid: "结果" } });
    const result = await resolveDomainTurn(context(app, state, "刚才那几项怎么定比较合适"));
    expect(result).toMatchObject({ intent: "CLARIFY", mutation: "NONE" }); expect(result.unresolved?.[0]).not.toContain("你这轮希望"); expect(mocks.model).toHaveBeenCalled();
    const payload = refreshSolution(emptySolution(), state.lastReferenceLookup!.query, state.lastReferenceLookup!.candidates.map(referenceSolutionCandidate));
    const action = await parseSolutionAction({ ...context(app, state, "第一个留下"), domainDecision: domainDecision("SOLUTION_ACTION", "第一个留下") }, "第一个留下", payload);
    expect(action?.clarification).toBeTruthy(); expect(mocks.mutate).not.toHaveBeenCalled();
  });
  it("真实Fastify inject/SSE协议两轮建议，四个optionId对应页5/6，正文不会暴露内部引用", async () => {
    const app = appFixture(); let state = await queriedState(app);
    const server = Fastify();
    server.post<{ Body: { message: string } }>("/fixture/advice", async (request, reply) => {
      const result = await adviceTurn(app, state, request.body.message); state = result.state;
      startSseStream(reply, request.id); emitSolutionAdvice(reply, result.result); writeSse(reply, "done", { verified: result.result.verified }); reply.raw.end();
    });
    try {
      for (const message of ["能不能出个方案", "不要考虑地区和建筑类型，先给个通用方案"]) {
        const response = await server.inject({ method: "POST", url: "/fixture/advice", payload: { message } });
        expect(response.statusCode).toBe(200);
        const events = response.body.trim().split("\n\n").map(value => { const lines = value.split("\n"); return { event: lines[0]!.slice(7), data: JSON.parse(lines[1]!.slice(6)) }; });
        const refs = events.find(event => event.event === "reference_pages")!.data.referencePages;
        expect(refs.flatMap((page: any) => page.matches.map((match: any) => match.optionId))).toEqual(state.lastReferenceLookup!.candidates.map(candidate => candidate.optionId));
        expect(events.find(event => event.event === "delta")!.data.text).not.toContain("[[KP:");
        expect(events.some(event => event.event === "solution_state" || event.event === "report_queued")).toBe(false);
      }
    } finally { await server.close(); }
  });
});

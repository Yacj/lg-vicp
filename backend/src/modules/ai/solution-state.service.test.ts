import "dotenv/config";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, getTableColumns } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { solutionStates, solutionSnapshots, aiConversations, aiConversationStates, thermalCalcRecords, constructionSchemes, insulationSystems, projects } from "../../db/schema.js";
import { actOnSolution, startSolution, loadActiveSolution, refreshActiveSolutionCandidates, activateSolutionFromLastLookup, recordCalculatedSolution, solutionPayloadFromLookup, getSolutionSnapshot, querySolution, type SolutionContext } from "./solution-state.service.js";
import { publishCandidateResult } from "./candidate-result.service.js";
import { parseConversationTaskState } from "./conversation-task.js";
import { groundSolutionAction } from "./solution-action-semantic.js";
import { querySolutionCandidates, DEFAULT_SOLUTION_QUERY_POLICY } from "./solution-candidate-query.service.js";
import { resolveReferenceQueryWithoutAgent } from "./reference-query.service.js";
import { createThermalTool, thermalInput } from "./tools/thermal-calculate.tool.js";
import { referenceSolutionCandidate } from "./solution-workflow.js";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import { toSolutionDocumentModel } from "./solution-document-model.js";

const mocks = vi.hoisted(() => ({ query: vi.fn(), pages: vi.fn(), readable: vi.fn(), audit: vi.fn(), semantic: vi.fn(), calc: vi.fn() }));
vi.mock("../thermal/thermal-calc.service.js", () => ({ executeThermalCalc: mocks.calc }));
vi.mock("../thermal/thermal-candidate.service.js", () => ({ queryThermalCandidates: mocks.query }));
vi.mock("./tools/thermal-calculate.tool.js", async importOriginal => ({ ...await importOriginal<typeof import("./tools/thermal-calculate.tool.js")>(), emitReferencePages: mocks.pages }));
vi.mock("./semantic-query.service.js", () => ({ parseSemanticQuery: mocks.semantic }));
vi.mock("../thermal/thermal-query-dictionary.service.js", () => ({ loadThermalQueryDictionary: async () => ({ entities: [], aliases: [] }) }));
vi.mock("./ai-conversation-state.service.js", () => ({ saveConversationTaskState: vi.fn() }));
vi.mock("./tools/tool-runtime.js", async importOriginal => ({ ...await importOriginal<typeof import("./tools/tool-runtime.js")>(),
  runRegisteredTool: async (_ctx: unknown, _name: unknown, _args: unknown, _options: unknown, run: () => unknown) => run() }));
vi.mock("./ai-reference-pages.service.js", () => ({ readConsumableReferencePages: mocks.readable }));
vi.mock("../audit-logs/audit-log.service.js", () => ({ writeAuditLog: mocks.audit }));
vi.mock("./tools/thermal-lookup.js", async importOriginal => ({ ...await importOriginal<typeof import("./tools/thermal-lookup.js")>(),
  compactCandidateResult: (row: { snapshot: unknown }) => row.snapshot }));

/** 服务事务契约测试：使用真实 Drizzle WHERE 编译结果模拟过滤与回滚；真实 PostgreSQL 验证另行运行。 */
function memoryDb() {
  let data: Record<string, any[]> = {};
  let queue = Promise.resolve();
  const dialect = new PgDialect();
  const db: any = {
    rows: (table: any) => data[getTableName(table)] ??= [],
    select: () => {
      let table: any, predicate: any;
      const builder: any = { from: (t: any) => { table = t; return builder; }, where: (p: any) => { predicate = p; return builder; },
        for: () => builder, limit: () => builder, then: (resolve: any, reject: any) => {
          let rows = db.rows(table);
          if (predicate) {
            const compiled = dialect.sqlToQuery(predicate);
            const columns: any = getTableColumns(table);
            const property = (name: string) => Object.keys(columns).find(key => columns[key].name === name)!;
            rows = rows.filter((row: any) => [...compiled.sql.matchAll(/"[^"]+"\."([^"]+)" = \$(\d+)/g)].every(match => row[property(match[1]!)] === compiled.params[Number(match[2]) - 1])
              && [...compiled.sql.matchAll(/"[^"]+"\."([^"]+)" is null/g)].every(match => row[property(match[1]!)] == null));
          }
          return Promise.resolve(structuredClone(rows)).then(resolve, reject);
        } };
      return builder;
    },
    insert: (table: any) => ({ values: (value: any) => {
      const row = { id: randomUUID(), active: true, version: 1, confirmedSnapshotId: null, createdAt: new Date(), updatedAt: new Date(), ...structuredClone(value) };
      const execute = () => { db.rows(table).push(row); return [structuredClone(row)]; };
      return { returning: async () => execute(), then: (resolve: any) => Promise.resolve(execute()).then(resolve) };
    } }),
    update: (table: any) => ({ set: (values: any) => ({ where: (predicate: any) => {
      const execute = async () => {
        const matched = await db.select().from(table).where(predicate);
        const ids = matched.map((row: any) => row.id);
        for (const row of db.rows(table)) if (ids.includes(row.id)) Object.assign(row, structuredClone(values));
        return db.rows(table).filter((row: any) => ids.includes(row.id)).map((row: any) => structuredClone(row));
      };
      return { returning: execute, then: (resolve: any, reject: any) => execute().then(resolve, reject) };
    } }) }),
    transaction: (run: any) => {
      const operation = queue.then(async () => { const old = structuredClone(data); try { return await run(db); } catch (error) { data = old; throw error; } });
      queue = operation.catch(() => {}); return operation;
    }
  };
  return db;
}
let ctx: SolutionContext, db: ReturnType<typeof memoryDb>;
const a = referenceSolutionCandidate({ id: randomUUID(), systemId: randomUUID(), systemName: "薄抹灰", schemeId: randomUUID(), schemeCode: "A1-3",
  productSpecId: randomUUID(), thicknessMm: 18, kValue: .3, productThermalResistance: 2.8, totalThermalResistance: 3.3,
  sourcePageId: randomUUID(), sourceDocumentId: randomUUID(), optionId: "option-1" });
const bId = randomUUID();
const b = { ...a, id: bId, candidateId: bId, thermalReferenceRowId: bId };
const pageData = { systems: [{ constructionCode: "A1-3", systemName: "薄抹灰", options: [{ thicknessMm: 18, productThermalResistance: 2.8, totalThermalResistance: 3.3, kValue: .3 }] }] };
a.optionId = buildKnowledgePageRenderModel(a.sourcePageId!, pageData)!.constructions[0]!.options[0]!.optionId;
b.optionId = a.optionId;
beforeEach(() => {
  vi.resetAllMocks(); db = memoryDb();
  const conversation = { id: randomUUID(), projectId: null, clientApp: "c_app", status: "active", deletedAt: null, userId: randomUUID() };
  db.rows(aiConversations).push(conversation);
  ctx = { app: { db, storage: { createDownloadUrl: vi.fn(async () => "signed") } }, request: {}, user: { id: conversation.userId, clientType: "C_APP" }, conversation } as unknown as SolutionContext;
  mocks.query.mockResolvedValue({ candidates: [{ candidateId: a.candidateId, snapshot: a }] });
  mocks.pages.mockResolvedValue({ candidates: [a] });
  mocks.readable.mockResolvedValue([{ page: { id: a.sourcePageId, versionId: "version", metadata: { confirmedStructuredData: pageData }, pageImageObjectKey: "pages/a.png" }, document: { id: a.sourceDocumentId, title: "图集" } }]);
  mocks.audit.mockResolvedValue(undefined);
});

describe("Candidate Result → 用户动作 → 懒激活生命周期", () => {
  const c = { ...a, id: "candidate-c", candidateId: "candidate-c", thermalReferenceRowId: "candidate-c" };
  function resultContext() { return { ...ctx, taskState: { taskType: "GENERAL" as const }, userMessage: "薄抹灰K0.3有么？", onEvent: vi.fn() }; }
  async function lookup(context = resultContext()) {
    mocks.pages.mockResolvedValue({ candidates: [a, b, c], sources: [], blocks: [], warnings: [] });
    mocks.query.mockResolvedValue({ candidates: [a, b, c].map(snapshot => ({ candidateId: snapshot.id, snapshot })) });
    return { context, ...await publishCandidateResult(context, { query: {}, candidates: [a, b, c], createdAt: new Date().toISOString() }) };
  }
  it("普通REFERENCE_LOOKUP保存结果和revision、发候选事件，不创建/发送方案", async () => {
    const context = resultContext();
    mocks.pages.mockResolvedValue({ candidates: [a], sources: [], blocks: [], warnings: [] });
    mocks.semantic.mockResolvedValue({ query: {}, lifecycle: "NEW_QUERY", needsClarification: false });
    await resolveReferenceQueryWithoutAgent(context as any);
    const saved = parseConversationTaskState(db.rows(aiConversationStates)[0].taskStateJson).lastReferenceLookup!;
    expect(saved).toMatchObject({ candidateQueryRevision: 1, projectId: null, candidates: [{ id: a.id }] });
    expect(await loadActiveSolution(ctx)).toBeNull();
    expect(context.onEvent).toHaveBeenCalledWith("reference_candidates", expect.objectContaining({ queryRevision: 1 }));
    expect(context.onEvent.mock.calls.some(([event]) => event === "solution_state")).toBe(false);
  });
  it("首次自然语言POSITION基于lookup revision Grounding，seed全池并选择一和三", async () => {
    const { lookup: saved } = await lookup();
    const message = "第一个和第三个留下";
    const intent = groundSolutionAction(message, { type: "SELECT", references: [
      { type: "POSITION", value: 1, evidence: "第一个" }, { type: "POSITION", value: 3, evidence: "第三个" }],
      selectionMode: "INCLUDE", referenceScope: "CURRENT_POOL", temporalScope: "CURRENT", evidence: message, confidence: .98, unresolved: [] },
      solutionPayloadFromLookup(saved), saved.candidateQueryRevision);
    expect(intent?.clarification).toBeUndefined();
    const result = await activateSolutionFromLastLookup(ctx, saved.candidateQueryRevision, { action: intent!.action, candidateIds: intent!.candidateIds });
    expect(result.solutionState.poolCandidateIds).toEqual([a.id, b.id, c.id]);
    expect(result.solutionState.selectedCandidateIds).toEqual([a.id, c.id]);
    expect(db.rows(solutionStates)).toHaveLength(1);
  });
  it("按钮首次ADD一次完成激活，正式ID与自然语言共用mutation", async () => {
    const { lookup: saved } = await lookup();
    const result = await activateSolutionFromLastLookup(ctx, saved.candidateQueryRevision, { action: "ADD", candidateIds: [a.id] });
    expect(result.solutionState.selectedCandidateIds).toEqual([a.id]);
    expect(result.solutionState.poolCandidateIds).toEqual([a.id, b.id, c.id]);
    expect(db.rows(solutionStates)).toHaveLength(1);
  });
  it("已有方案刷新池保留已选、重新标冲突、推进candidateSetRevision", async () => {
    const { context, lookup: saved } = await lookup();
    const initial = await activateSolutionFromLastLookup(ctx, saved.candidateQueryRevision, { action: "SELECT", candidateIds: [a.id, c.id] });
    const next = await publishCandidateResult(context, { query: { thicknessMax: 15 }, candidates: [{ ...b, id: "d", thicknessMm: 10 }], createdAt: new Date().toISOString() });
    expect(next.solutionState?.id).toBe(initial.solutionState.id);
    expect(next.solutionState?.poolCandidateIds).toEqual(["d"]);
    expect(next.solutionState?.selectedCandidateIds).toEqual([a.id, c.id]);
    expect(next.solutionState?.conflicts.map(conflict => conflict.candidateId)).toEqual([a.id, c.id]);
    expect(next.solutionState?.candidateSetRevision).toBe(initial.solutionState.candidateSetRevision + 1);
    expect(context.onEvent).toHaveBeenCalledWith("solution_state", { solutionState: next.solutionState });
  });
  it("Confirmed后普通查询仅返回Candidate Result，START_NEW才创建新状态", async () => {
    const state = await final();
    const confirmed = await actOnSolution(ctx, state.id, { action: "CONFIRM", expectedVersion: state.version });
    const { context, solutionState } = await lookup();
    expect(solutionState).toBeNull(); expect(db.rows(solutionStates)).toHaveLength(1);
    expect((await loadActiveSolution(ctx))?.id).toBe(confirmed.solutionState.id);
    expect(context.onEvent.mock.calls.map(([event]) => event)).toEqual(["reference_candidates"]);
    const started = await actOnSolution(ctx, state.id, { action: "START_NEW", expectedVersion: confirmed.solutionState.version });
    expect(started.solutionState.id).not.toBe(state.id); expect(started.solutionState.confirmedSnapshotId).toBeNull();
  });
  it("Confirmed后明确加入最近查询候选才激活新方案", async () => {
    const state = await final();
    await actOnSolution(ctx, state.id, { action: "CONFIRM", expectedVersion: state.version });
    const { lookup: saved } = await lookup();
    const result = await activateSolutionFromLastLookup(ctx, saved.candidateQueryRevision, { action: "ADD", positions: [3] });
    expect(result.solutionState.id).not.toBe(state.id); expect(result.solutionState.selectedCandidateIds).toEqual([c.id]);
    expect(db.rows(solutionSnapshots)).toHaveLength(1);
  });
  it("旧查询revision不能错误选择新列表第一个", async () => {
    const first = await lookup(); const second = await lookup(first.context);
    expect(second.lookup.candidateQueryRevision).toBe(2);
    await expect(activateSolutionFromLastLookup(ctx, first.lookup.candidateQueryRevision, { action: "SELECT", positions: [1] })).rejects.toThrow("候选列表已变化");
    expect(db.rows(solutionStates)).toHaveLength(0);
  });
  it("普通任务保存不能用旧lookup覆盖新的revision", async () => {
    const first = await lookup(); const second = await lookup(first.context);
    const real = await vi.importActual<typeof import("./ai-conversation-state.service.js")>("./ai-conversation-state.service.js");
    await real.saveConversationTaskState(ctx.app, ctx.conversation.id, { taskType: "GENERAL", lastReferenceLookup: first.lookup });
    const stored = parseConversationTaskState(db.rows(aiConversationStates)[0].taskStateJson).lastReferenceLookup!;
    expect(stored.candidateQueryRevision).toBe(second.lookup.candidateQueryRevision);
    await expect(activateSolutionFromLastLookup(ctx, first.lookup.candidateQueryRevision, { action: "ADD", positions: [1] })).rejects.toThrow("已变化");
  });
  it("历史候选解析损坏不能删掉一项后改变序号映射", async () => {
    const { lookup: saved } = await lookup();
    db.rows(aiConversationStates)[0].taskStateJson.lastReferenceLookup.candidates[1].thicknessMm = "损坏";
    await expect(activateSolutionFromLastLookup(ctx, saved.candidateQueryRevision, { action: "ADD", positions: [2] })).rejects.toThrow("无法完整校验");
    expect(db.rows(solutionStates)).toHaveLength(0);
  });
  it("有active时序号仍按最新可见查询结果定位，不能选到整个池第一项", async () => {
    const { context, lookup: saved } = await lookup();
    const initial = await activateSolutionFromLastLookup(ctx, saved.candidateQueryRevision, { action: "ADD", candidateIds: [a.id] });
    const next = await publishCandidateResult(context, { query: {}, candidates: [c], createdAt: new Date().toISOString() }, true);
    const payload = solutionPayloadFromLookup(next.lookup, await loadActiveSolution(ctx));
    expect(payload.poolCandidateIds).toEqual([c.id]);
    const result = await activateSolutionFromLastLookup(ctx, next.lookup.candidateQueryRevision, { action: "ADD", positions: [1] });
    expect(result.solutionState.id).toBe(initial.solutionState.id);
    expect(result.solutionState.selectedCandidateIds).toEqual([a.id, c.id]);
    expect(result.solutionState.poolCandidateIds).toEqual([a.id, b.id, c.id]);
    expect(result.solutionState.candidateSetRevision).toBe(next.solutionState!.candidateSetRevision);
  });
  it("显式开始智配从最近候选seed，不自动选择或Final", async () => {
    const { lookup: saved } = await lookup();
    const result = await activateSolutionFromLastLookup(ctx, saved.candidateQueryRevision, { action: "START_NEW" });
    expect(result.solutionState.poolCandidateIds).toEqual([a.id, b.id, c.id]);
    expect(result.solutionState.selectedCandidateIds).toEqual([]); expect(result.solutionState.finalCandidateIds).toEqual([]);
    expect(result.solutionState.stage).toBe("CANDIDATE_SELECTION");
  });
  it("懒激活仍重验本人会话、客户端及项目权限", async () => {
    const { lookup: saved } = await lookup();
    for (const user of [{ ...ctx.user, id: randomUUID() }, { ...ctx.user, clientType: "PC_AI" as const }]) {
      await expect(activateSolutionFromLastLookup({ ...ctx, user }, saved.candidateQueryRevision, { action: "ADD", positions: [1] })).rejects.toThrow("无权访问");
    }
    expect(db.rows(solutionStates)).toHaveLength(0);
  });
  it.each(["expired", "source", "id", "project", "audit"])("%s失败拒绝懒激活并回滚state/seed", async failure => {
    const { lookup: saved } = await lookup();
    const stored = db.rows(aiConversationStates)[0].taskStateJson.lastReferenceLookup;
    if (failure === "expired") stored.createdAt = "2026-01-01";
    if (failure === "project") stored.projectId = randomUUID();
    if (failure === "source") mocks.pages.mockResolvedValue({ candidates: [] });
    if (failure === "audit") mocks.audit.mockRejectedValueOnce(new Error("审计失败"));
    await expect(activateSolutionFromLastLookup(ctx, saved.candidateQueryRevision, { action: "ADD", candidateIds: [failure === "id" ? "invented" : a.id] })).rejects.toThrow();
    expect(db.rows(solutionStates)).toHaveLength(0);
  });
  it("refresh职责不允许无状态或Confirmed时隐式创建", async () => {
    expect(await refreshActiveSolutionCandidates(ctx, {}, [a])).toBeNull();
    const state = await final(); await actOnSolution(ctx, state.id, { action: "CONFIRM", expectedVersion: state.version });
    expect(await refreshActiveSolutionCandidates(ctx, {}, [b])).toBeNull();
    expect(db.rows(solutionStates)).toHaveLength(1);
  });
  it.each([false, true])("正式热工计算已有editable=%s：无方案只返回结果，有方案追加pool", async editable => {
    const { context, lookup: saved } = await lookup();
    context.taskState.lastReferenceLookup = { ...saved, candidates: [a] } as any;
    if (editable) await activateSolutionFromLastLookup(ctx, saved.candidateQueryRevision, { action: "ADD", candidateIds: [a.id] });
    const calcId = randomUUID();
    db.rows(thermalCalcRecords).push({ id: calcId, mode: "EQUIVALENT", createdById: ctx.user.id, projectId: null,
      inputJson: { schemeId: a.schemeId, productSpecId: a.productSpecId, thicknessMm: 55 }, resultJson: { kValue: .2, productResistance: 4.7, totalResistance: 5 } });
    db.rows(constructionSchemes).push({ id: a.schemeId, systemId: a.systemId, schemeCode: a.schemeCode, status: "PUBLISHED", deletedAt: null });
    db.rows(insulationSystems).push({ id: a.systemId, name: a.systemName });
    mocks.calc.mockResolvedValue({ valid: true, record: { id: calcId, result: { kValue: .2 }, steps: [] }, notes: [], errors: [] });
    context.onEvent.mockClear();
    await createThermalTool({ ...context, userMessage: "再算55mm的K", answerContract: "THERMAL" } as any).execute!(
      thermalInput.parse({ operation: "CALCULATE", mode: "EQUIVALENT", schemeId: a.schemeId, productSpecId: a.productSpecId, thicknessMm: 55 }), { toolCallId: "calc", messages: [] });
    const active = await loadActiveSolution(ctx);
    if (editable) { expect(active?.payload.poolCandidateIds).toContain(calcId); expect(active?.payload.selectedCandidateIds).toEqual([a.id]); }
    else expect(active).toBeNull();
    expect(context.onEvent.mock.calls.filter(([event]) => event === "solution_state")).toHaveLength(editable ? 1 : 0);
    expect(context.onEvent).toHaveBeenCalledWith("reference_candidates", expect.objectContaining({ candidates: [expect.objectContaining({ candidateId: calcId, sourceType: "CALCULATED" })] }));
    if (!editable) {
      const persisted = parseConversationTaskState(db.rows(aiConversationStates)[0].taskStateJson).lastReferenceLookup!;
      expect(persisted.candidates[0]?.inputSnapshot?.thicknessMm).toBe(55);
      expect((await activateSolutionFromLastLookup(ctx, persisted.candidateQueryRevision!, { action: "ADD", candidateIds: [calcId] })).solutionState.selectedCandidateIds).toEqual([calcId]);
    }
    const before = await loadActiveSolution(ctx);
    const beforeLookup = structuredClone(db.rows(aiConversationStates)[0].taskStateJson);
    mocks.audit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("初始ADD审计失败"));
    await expect(recordCalculatedSolution(ctx, calcId)).rejects.toThrow("初始ADD审计失败");
    expect(await loadActiveSolution(ctx)).toEqual(before);
    expect(db.rows(aiConversationStates)[0].taskStateJson).toEqual(beforeLookup);
  });
});
async function final() {
  await startSolution(ctx);
  const state = await refreshActiveSolutionCandidates(ctx, {}, [a], 1);
  return (await actOnSolution(ctx, state.id, { action: "SET_FINAL", expectedVersion: state.version, candidateIds: [a.candidateId] })).solutionState;
}
describe("SolutionState 服务事务/权限/并发", () => {
  it.each([["C_APP", "c_app"], ["PC_AI", "pc_ai"]] as const)("%s 令牌可读取本人真实来源 %s 的空状态，并创建和恢复方案", async (clientType, clientApp) => {
    db.rows(aiConversations)[0].clientApp = clientApp;
    const clientCtx = { ...ctx, user: { ...ctx.user, clientType } };
    expect(await loadActiveSolution(clientCtx)).toBeNull();
    const state = await startSolution(clientCtx);
    expect((await loadActiveSolution(clientCtx))?.id).toBe(state.id);
  });
  it("创建及恢复；一个 active，历史保留", async () => {
    const first = await startSolution(ctx); await startSolution(ctx, first.version);
    expect(db.rows(solutionStates)).toHaveLength(2);
    expect(db.rows(solutionStates).filter((row: any) => row.active)).toHaveLength(1);
    expect((await loadActiveSolution(ctx))?.id).not.toBe(first.id);
  });
  it("跨用户/跨客户端不可访问", async () => {
    await expect(loadActiveSolution({ ...ctx, user: { ...ctx.user, id: randomUUID() } })).rejects.toThrow("无权访问");
    await expect(loadActiveSolution({ ...ctx, user: { ...ctx.user, clientType: "PC_AI" } })).rejects.toThrow("无权访问");
  });
  it.each(["missing", "deleted", "inactive"])("%s 会话仍不可访问", async kind => {
    const conversation = db.rows(aiConversations)[0];
    if (kind === "missing") db.rows(aiConversations).length = 0;
    if (kind === "deleted") conversation.deletedAt = new Date();
    if (kind === "inactive") conversation.status = "ended";
    await expect(loadActiveSolution(ctx)).rejects.toThrow("无权访问");
  });
  it("来源映射正确也不能绕过私有项目权限", async () => {
    const projectId = randomUUID();
    db.rows(aiConversations)[0].projectId = projectId;
    db.rows(projects).push({ id: projectId, createdById: randomUUID(), visibility: "PRIVATE", deletedAt: null });
    await expect(loadActiveSolution(ctx)).rejects.toThrow("项目不存在或无权访问");
  });
  it("并发 ADD 仅一项通过，另一项版本冲突，重试保留之前选择", async () => {
    await startSolution(ctx); const state = await refreshActiveSolutionCandidates(ctx, {}, [a, b], 1);
    const results = await Promise.allSettled([a, b].map(candidate => actOnSolution(ctx, state.id, { action: "ADD", expectedVersion: state.version, candidateIds: [candidate.candidateId] })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const updated = await loadActiveSolution(ctx);
    await actOnSolution(ctx, state.id, { action: "ADD", expectedVersion: updated!.version, candidateIds: [b.candidateId] });
    expect((await loadActiveSolution(ctx))?.payload.selectedCandidateIds).toEqual([a.candidateId, b.candidateId]);
  });
  it("CONFIRM 原子创建/链接快照，重复确认幂等，后续 ADD 创建新状态", async () => {
    const state = await final();
    const confirmed = await actOnSolution(ctx, state.id, { action: "CONFIRM", expectedVersion: state.version });
    const repeated = await actOnSolution(ctx, state.id, { action: "CONFIRM", expectedVersion: state.version });
    expect(confirmed.snapshot?.id).toBe(repeated.snapshot?.id); expect(db.rows(solutionSnapshots)).toHaveLength(1);
    expect(confirmed.solutionState.stage).toBe("CONFIRMED");
    const next = await actOnSolution(ctx, state.id, { action: "ADD", expectedVersion: confirmed.solutionState.version, candidateIds: [a.candidateId] });
    expect(next.solutionState.id).not.toBe(state.id); expect(db.rows(solutionSnapshots)[0].payload.candidates[0].kValue).toBe(.3);
  });
  it("审计写入失败，snapshot 与 state 全部回滚", async () => {
    const state = await final(); mocks.audit.mockRejectedValueOnce(new Error("审计写入失败"));
    await expect(actOnSolution(ctx, state.id, { action: "CONFIRM", expectedVersion: state.version })).rejects.toThrow("审计写入失败");
    expect(db.rows(solutionSnapshots)).toHaveLength(0); expect((await loadActiveSolution(ctx))?.confirmedSnapshotId).toBeNull();
    expect((await loadActiveSolution(ctx))?.stage).toBe("READY_TO_CONFIRM");
  });
  it("来源变更禁止冻结，不写 snapshot", async () => {
    const state = await final(); mocks.pages.mockResolvedValue({ candidates: [{ ...a, kValue: .2 }] });
    await expect(actOnSolution(ctx, state.id, { action: "CONFIRM", expectedVersion: state.version })).rejects.toThrow("已变化");
    expect(db.rows(solutionSnapshots)).toHaveLength(0);
  });
  it("Snapshot 不存签名 URL；撤回来源后仍保留冻结表格，图片不签名", async () => {
    const state = await final(); const result = await actOnSolution(ctx, state.id, { action: "CONFIRM", expectedVersion: state.version });
    expect(JSON.stringify(result.snapshot)).not.toContain("imageUrl");
    mocks.readable.mockResolvedValue([]);
    const view = await getSolutionSnapshot(ctx, result.snapshot!.id);
    expect(view.payload.candidates[0]?.kValue).toBe(.3); expect(view.referenceImages[0]?.imageUrl).toBeNull();
    expect(ctx.app.storage.createDownloadUrl).not.toHaveBeenCalled();
  });
  it("未来 DocumentModel 只消费 snapshot，深复制值和整页来源", async () => {
    const state = await final(); const result = await actOnSolution(ctx, state.id, { action: "CONFIRM", expectedVersion: state.version });
    const model = toSolutionDocumentModel(result.snapshot!);
    result.snapshot!.payload.candidates[0]!.kValue = 99;
    expect(model.solutions[0]?.kValue).toBe(.3); expect(model.referencePages[0]?.renderModel).toBeTruthy();
    expect(model.solutionSnapshotId).toBe(result.snapshot!.id);
  });
  it("Chat / REST / Agent / refresh同QueryState的命中、nearby、排序和limit一致", async () => {
    const candidates = Array.from({ length: 15 }, (_, index) => referenceSolutionCandidate({ ...a, id: `row-${index}`,
      sourcePageId: null, sourceDocumentId: null, thicknessMm: index % 2 ? 20 : 18, kValue: .3 }));
    const nearby = referenceSolutionCandidate({ ...a, id: "nearby-30", sourcePageId: null, sourceDocumentId: null, thicknessMm: 30 });
    const query = { thicknessMax: 20, preferences: { preferThinner: true } };
    mocks.query.mockImplementation(async () => ({ candidates: candidates.map(snapshot => ({ candidateId: snapshot.id, snapshot })),
      nearbyCandidates: [{ candidateId: nearby.id, snapshot: nearby }], matchedCandidates: candidates, lookupMode: "APPROX", notes: [], queryState: query }));
    mocks.pages.mockImplementation(async (_ctx: unknown, rows: unknown[]) => ({ candidates: rows, sources: [], warnings: [] }));
    mocks.semantic.mockResolvedValue({ query, needsClarification: false, lifecycle: "REFINE_QUERY" });
    await startSolution(ctx);
    const chatContext = { ...ctx, taskState: { taskType: "GENERAL" }, userMessage: "刷新方案" } as any;
    const chat = await resolveReferenceQueryWithoutAgent(chatContext);
    let state = await loadActiveSolution(ctx);
    const rest = await querySolution(ctx, query, state!.version);
    const refreshed = await querySolution(ctx, query, rest.version);
    const agentContext = { ...ctx, user: { id: ctx.user.id }, taskState: { taskType: "GENERAL" }, userMessage: "刷新方案" } as any;
    const tool = createThermalTool(agentContext);
    const agent: any = await tool.execute!(thermalInput.parse({ operation: "LOOKUP_CANDIDATES" }), { toolCallId: "policy", messages: [] });
    const shared = await querySolutionCandidates(ctx, query);
    const ids = (values: Array<{ id: string }>) => values.map(value => value.id);
    const expected = ids(shared.matchedCandidates);
    expect(expected).toHaveLength(DEFAULT_SOLUTION_QUERY_POLICY.maxCandidates);
    expect(ids(chat.facts.candidates as any)).toEqual(expected);
    expect(rest.poolCandidateIds).toEqual(expected); expect(refreshed.poolCandidateIds).toEqual(expected);
    expect(ids(agent.data.candidates)).toEqual(expected);
    expect(ids(chat.facts.nearbyCandidates as any)).toEqual(["nearby-30"]);
    expect(ids(agentContext.thermalAllowedFacts.nearbyCandidates)).toEqual(["nearby-30"]);
    expect(ids(shared.nearbyCandidates)).toEqual(["nearby-30"]);
    for (const call of mocks.query.mock.calls) expect(call[3]).toMatchObject({ neighborTolerance: DEFAULT_SOLUTION_QUERY_POLICY.neighborTolerance, thicknessMax: 20 });
    expect(expected.slice(0, 8).every(id => Number(id.slice(4)) % 2 === 0)).toBe(true);
  });
});

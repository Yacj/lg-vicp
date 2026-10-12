import "dotenv/config";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, getTableColumns } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { solutionStates, solutionSnapshots, aiConversations } from "../../db/schema.js";
import { actOnSolution, startSolution, loadActiveSolution, recordSolutionCandidates, getSolutionSnapshot, querySolution, type SolutionContext } from "./solution-state.service.js";
import { querySolutionCandidates, DEFAULT_SOLUTION_QUERY_POLICY } from "./solution-candidate-query.service.js";
import { resolveReferenceQueryWithoutAgent } from "./reference-query.service.js";
import { createThermalTool, thermalInput } from "./tools/thermal-calculate.tool.js";
import { referenceSolutionCandidate } from "./solution-workflow.js";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import { toSolutionDocumentModel } from "./solution-document-model.js";

const mocks = vi.hoisted(() => ({ query: vi.fn(), pages: vi.fn(), readable: vi.fn(), audit: vi.fn(), semantic: vi.fn() }));
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
beforeEach(() => {
  vi.resetAllMocks(); db = memoryDb();
  const conversation = { id: randomUUID(), projectId: null, clientApp: "C_APP", status: "active", deletedAt: null, userId: randomUUID() };
  db.rows(aiConversations).push(conversation);
  ctx = { app: { db, storage: { createDownloadUrl: vi.fn(async () => "signed") } }, request: {}, user: { id: conversation.userId, clientType: "C_APP" }, conversation } as unknown as SolutionContext;
  mocks.query.mockResolvedValue({ candidates: [{ candidateId: a.candidateId, snapshot: a }] });
  mocks.pages.mockResolvedValue({ candidates: [a] });
  mocks.readable.mockResolvedValue([{ page: { id: a.sourcePageId, versionId: "version", metadata: { confirmedStructuredData: pageData }, pageImageObjectKey: "pages/a.png" }, document: { id: a.sourceDocumentId, title: "图集" } }]);
  mocks.audit.mockResolvedValue(undefined);
});
async function final() {
  await startSolution(ctx);
  const state = await recordSolutionCandidates(ctx, {}, [a]);
  return (await actOnSolution(ctx, state.id, { action: "SET_FINAL", expectedVersion: state.version, candidateIds: [a.candidateId] })).solutionState;
}
describe("SolutionState 服务事务/权限/并发", () => {
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
  it("并发 ADD 仅一项通过，另一项版本冲突，重试保留之前选择", async () => {
    await startSolution(ctx); const state = await recordSolutionCandidates(ctx, {}, [a, b]);
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

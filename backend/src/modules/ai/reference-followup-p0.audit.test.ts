import { domainDecision, type DomainIntent } from "./ai-domain-turn-decision.js";
import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), query: vi.fn(), runtime: vi.fn(), record: vi.fn(), calc: vi.fn(), read: vi.fn() }));
vi.mock("./ai-runtime.service.js", () => ({ resolveSceneRuntime: mocks.runtime }));
vi.mock("./ai-conversation-state.service.js", () => ({ saveConversationTaskState: mocks.save }));
vi.mock("../thermal/thermal-query-dictionary.service.js", () => ({ loadThermalQueryDictionary: async () => ({ entities: [], aliases: [] }) }));
vi.mock("./solution-candidate-query.service.js", () => ({ querySolutionCandidates: mocks.query }));
vi.mock("./solution-state.service.js", () => ({ loadActiveSolution: async () => null, isEditableSolution: () => false, recordCandidateResult: mocks.record, assertSolutionAccess: async () => ({ projectId: null }) }));
vi.mock("../thermal/thermal-calc.service.js", () => ({ executeThermalCalc: mocks.calc }));
vi.mock("./tools/tool-runtime.js", () => ({ runRegisteredTool: async (_ctx: unknown, _name: unknown, _args: unknown, _options: unknown, run: () => unknown) => run() }));
vi.mock("./ai-reference-pages.service.js", async original => ({ ...await original<typeof import("./ai-reference-pages.service.js")>(), readConsumableReferencePages: mocks.read }));
import { referenceReadFixture } from "./reference-read.fixture.js";
import { resolveReferenceQueryWithoutAgent } from "./reference-query.service.js";
import { createThermalTool, thermalInput } from "./tools/thermal-calculate.tool.js";
import { createCompareSolutionsTool, compareSolutionsInput } from "./tools/compare-solutions.tool.js";
import type { ToolRuntimeContext } from "./tools/tool-runtime.js";
import { normalizeConversationLookupQuery } from "./tools/thermal-lookup.js";

function context(message: string, intent: DomainIntent = "REFERENCE_VIEW"): ToolRuntimeContext {
  const read: any = { from: () => read, innerJoin: () => read, where: async () => [] };
  return { app: { db: { select: () => read }, log: { warn: vi.fn() } }, request: {}, user: { id: "u", clientType: "C_APP" },
    domainDecision: domainDecision(intent, message), conversation: { id: "c", projectId: null, scene: "general_chat" }, userMessage: message, onEvent: vi.fn(),
    taskState: { taskType: "GENERAL", lastReferenceLookup: { query: normalizeConversationLookupQuery({ systemId: "thin" }, "K0.3左右", undefined, { entities: [], aliases: [] }).query,
      candidates: referenceReadFixture().candidates,
      createdAt: new Date().toISOString(), candidateQueryRevision: 7, projectId: null } } } as unknown as ToolRuntimeContext;
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.read.mockResolvedValue([referenceReadFixture().row]); mocks.runtime.mockRejectedValue(new Error("受控模拟：语义模型不可用"));
  mocks.query.mockImplementation(async (_ctx, query) => ({ queryState: query, outcome: { matchedCandidates: [], lookupMode: "APPROX", tolerance: .02 },
    candidates: [], matchedCandidates: [], nearbyRaw: [], nearbyCandidates: [], identityMatchedButMetricFailed: [], matchedCount: 0, notes: [],
    pages: { candidates: [], sources: [], blocks: [], warnings: [] }, nearbyPages: { candidates: [], sources: [], blocks: [], warnings: [] }, identityPages: { candidates: [], sources: [], blocks: [], warnings: [] } }));
  // 仅隔离DB事务：模拟已有Candidate Result契约，不冒充真实SolutionState事务验证。
  mocks.record.mockImplementation(async (ctx, snapshot) => ({ lookup: { ...snapshot, projectId: null,
    candidateQueryRevision: (ctx.taskState?.lastReferenceLookup?.candidateQueryRevision ?? 0) + 1 }, solutionState: null }));
});

describe("P0静态审计：非Agent原页与比较边界（服务测试，非HTTP/SSE）", () => {
  it.each(["第一个原页", "第一个完整表格"])("%s 不得查询或发布新候选", async (message) => {
    const ctx = context(message), frozen = structuredClone(ctx.taskState);
    await resolveReferenceQueryWithoutAgent(ctx);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(ctx.taskState).toEqual(frozen);
  });
  it("普通比较只读明确的第一和第三个，不改变QueryState或Selected", async () => {
    const ctx = context("第一个和第三个比较", "COMPARE_CANDIDATES"), frozen = structuredClone(ctx.taskState);
    const result = await resolveReferenceQueryWithoutAgent(ctx);
    expect(result.facts.candidates.map(c => c.id)).toEqual(["row-1", "row-3"]);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(ctx.taskState).toEqual(frozen);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("局部Refine正式重查并更新Candidate revision", async () => {
    const ctx = context("那20mm以内", "REFERENCE_REFINE");
    await resolveReferenceQueryWithoutAgent(ctx);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0]![1]).toMatchObject({ systemId: "thin", thicknessMax: 20,
      filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX" }] });
    expect(ctx.taskState!.lastReferenceLookup!.candidateQueryRevision).toBe(8);
  });
});

describe("P0静态审计：Agent工具后端实际副作用（不含真实Agent模型）", () => {
  it.each(["第一个原页", "第一个完整表格"])("thermal复用候选后 %s 仍不得刷新revision或发reference_candidates", async (message) => {
    const ctx = context(message), frozen = structuredClone(ctx.taskState);
    const result: any = await createThermalTool(ctx).execute!(thermalInput.parse({ operation: "LOOKUP_CANDIDATES" }), { toolCallId: "p0", messages: [], context: {} });
    expect(result.ok).toBe(true);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(ctx.taskState).toEqual(frozen);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("compare_solutions普通比较不得保存临时Selected", async () => {
    const ctx = context("第一个和第三个比较", "COMPARE_CANDIDATES"), frozen = structuredClone(ctx.taskState);
    const result: any = await createCompareSolutionsTool(ctx).execute!(compareSolutionsInput.parse({ operation: "COMPARE" }), { toolCallId: "p0", messages: [], context: {} });
    expect(result.ok).toBe(true);
    expect(result.data.candidates.map((c: any) => c.id)).toEqual(["row-1", "row-3"]);
    expect(ctx.taskState).toEqual(frozen);
  });
  it("没有真实选择或明确授权时，单个历史候选不能替代计算入参授权", async () => {
    const ctx = context("这个K怎么算");
    ctx.taskState!.lastReferenceLookup!.candidates = [ctx.taskState!.lastReferenceLookup!.candidates[0]!];
    mocks.calc.mockResolvedValue({ valid: false, record: null, result: {} });
    await createThermalTool(ctx).execute!(thermalInput.parse({ operation: "CALCULATE", mode: "REFERENCE_TABLE" }), { toolCallId: "p0", messages: [], context: {} });
    expect(mocks.calc).not.toHaveBeenCalled();
  });
});

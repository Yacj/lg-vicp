import { domainDecision } from "../ai-domain-turn-decision.js";
import "dotenv/config";
import { buildKnowledgePageRenderModel } from "../../../shared/knowledge-page-render.js";
import { emptySolution, refreshSolution, referenceSolutionCandidate } from "../solution-workflow.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createThermalTool, thermalInput } from "./thermal-calculate.tool.js";
import { createCompareSolutionsTool, compareSolutionsInput } from "./compare-solutions.tool.js";
import type { ToolRuntimeContext } from "./tool-runtime.js";
import type { LastReferenceLookup, ReferenceLookupCandidate } from "../conversation-task.js";

const mocks = vi.hoisted(() => ({ calc: vi.fn(), save: vi.fn(), compare: vi.fn(), scope: vi.fn(), active: vi.fn(), read: vi.fn() }));
vi.mock("../solution-state.service.js", () => ({ assertSolutionAccess: async () => ({ projectId: null }), loadActiveSolution: mocks.active }));
vi.mock("../ai-reference-pages.service.js", async original => ({ ...await original<typeof import("../ai-reference-pages.service.js")>(), readConsumableReferencePages: mocks.read }));
vi.mock("../../thermal/thermal-calc.service.js", () => ({ executeThermalCalc: mocks.calc }));
vi.mock("../../thermal/thermal-standard-scope.service.js", () => ({ resolveScopedThermalStandard: mocks.scope }));
vi.mock("../ai-conversation-state.service.js", () => ({ saveConversationTaskState: mocks.save }));
vi.mock("../compare-solution.service.js", () => ({ compareSolutions: mocks.compare, toCompareToolOutput: vi.fn() }));
vi.mock("./tool-runtime.js", () => ({ runRegisteredTool: async (_ctx: unknown, _name: unknown, _args: unknown, _options: unknown, run: () => unknown) => run() }));
vi.mock("../../thermal/thermal-query-dictionary.service.js", () => ({ loadThermalQueryDictionary: async () => ({
  entities: [{ field: "schemeId", value: "11111111-1111-4111-8111-111111111111", names: ["构造甲"] },
    { field: "schemeId", value: "22222222-2222-4222-8222-222222222222", names: ["构造乙"] }], aliases: [],
  selectionFacts: [{ systemId: "sys-A", systemName: "体系甲" }, { systemId: "sys-B", systemName: "体系乙" },
    { schemeId: "11111111-1111-4111-8111-111111111111", systemId: "sys-A", substrateMaterial: "材料甲" },
    { schemeId: "22222222-2222-4222-8222-222222222222", systemId: "sys-B", substrateMaterial: "材料乙" },
    { productSpecId: "33333333-3333-4333-8333-333333333333", specClass: "I" }]
}) }));
const a: ReferenceLookupCandidate = { id: "A", schemeId: "11111111-1111-4111-8111-111111111111", productSpecId: "33333333-3333-4333-8333-333333333333",
  systemId: "sys-A", schemeCode: "S-A", thicknessMm: 20, kValue: 0.3, totalThermalResistance: 3.3, productThermalResistance: 2.8 };
const b = { ...a, id: "B", thicknessMm: 25, kValue: 0.25 };
function context(last: LastReferenceLookup, message = "重新算一下") {
  const data = { fullText: "", systems: last.candidates.map(candidate => ({ constructionCode: candidate.schemeCode,
    options: [{ thicknessMm: candidate.thicknessMm, kValue: candidate.kValue, totalThermalResistance: candidate.totalThermalResistance,
      productThermalResistance: candidate.productThermalResistance }] })) };
  const model = buildKnowledgePageRenderModel("page", data)!;
  const verified = structuredClone(last);
  verified.candidates = verified.candidates.map((candidate, index) => ({ ...candidate, referenceKind: "KNOWLEDGE_PAGE",
    sourcePageId: "page", sourceDocumentId: "doc", sourceVersionId: "version", optionId: model.constructions[index]!.options[0]!.optionId }));
  mocks.read.mockResolvedValue([{ page: { id: "page", documentId: "doc", versionId: "version", physicalPageNumber: 1,
    metadata: { confirmedStructuredData: data } }, document: { id: "doc", title: "确认测试来源" } }]);
  return { app: { db: {}, log: { warn: vi.fn() } }, conversation: { id: "c", projectId: null }, request: {}, user: { id: "u" },
    answerContract: "THERMAL", userMessage: message, taskState: { taskType: "GENERAL", lastReferenceLookup: verified }, onEvent: vi.fn() } as unknown as ToolRuntimeContext;
}
const snapshot = (candidates = [a]): LastReferenceLookup => ({ query: { systemId: "sys-A", metric: "K", targetValue: 0.3, mode: "MAX_LIMIT" }, candidates, candidateQueryRevision: 1, projectId: null, createdAt: new Date().toISOString() });
async function calculate(ctx: ToolRuntimeContext, input: Record<string, unknown> = {}) {
  ctx.domainDecision ??= domainDecision("THERMAL_CALCULATE", ctx.userMessage ?? "");
  return await createThermalTool(ctx).execute!(thermalInput.parse({ operation: "CALCULATE", mode: "EQUIVALENT", ...input }), { toolCallId: "calc", messages: [] }) as any;
}
async function compare(ctx: ToolRuntimeContext, input: Record<string, unknown>) {
  ctx.domainDecision ??= domainDecision("COMPARE_CANDIDATES", ctx.userMessage ?? "");
  return await createCompareSolutionsTool(ctx).execute!(compareSolutionsInput.parse(input), { toolCallId: "compare", messages: [] }) as any;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.active.mockResolvedValue(null);
  mocks.scope.mockResolvedValue({ limit: null, reason: "请确认地区、建筑类型和具体标准版本后判断合规。" });
  mocks.calc.mockResolvedValue({ valid: true, notes: [], errors: [], record: { mode: "EQUIVALENT", standard: null, steps: [], layers: [], result: { kValue: 0.29, totalResistance: 3.45, compliant: null } } });
});

describe("Intent 切换、计算继承与已选候选约束", () => {
  it("计算沿用唯一冻结候选，保留查表筛选状态，不要求再次输入已明确参数", async () => {
    const ctx = context(snapshot());
    await calculate(ctx);
    expect(mocks.calc).toHaveBeenCalledWith(ctx.app, ctx.request, ctx.user, expect.objectContaining({ schemeId: a.schemeId, productSpecId: a.productSpecId, thicknessMm: 20 }));
    expect(ctx.taskState?.lastReferenceLookup?.query).toMatchObject({ systemId: "sys-A", intent: "THERMAL", thicknessMm: 20, filters: [{ metric: "K", mode: "MAX_LIMIT" }] });
    expect(ctx.thermalCanonicalAnswers?.[0]).toContain("K=0.29");
  });
  it("多个候选不能默认拼第一条，已明确单选则只继承所选记录", async () => {
    const ambiguous = context(snapshot([a, b]));
    expect((await calculate(ambiguous)).code).toBe("THERMAL_CANDIDATE_REQUIRED"); expect(mocks.calc).not.toHaveBeenCalled();
    const chosen = context({ ...snapshot([a, b]), selectedCandidateIds: ["B"] });
    expect((await calculate(chosen)).code).toBe("THERMAL_CANDIDATE_REQUIRED");
    expect(mocks.calc).not.toHaveBeenCalled();
    chosen.userMessage = "重新算已选方案";
    const payload = refreshSolution(emptySolution(), chosen.taskState!.lastReferenceLookup!.query,
      chosen.taskState!.lastReferenceLookup!.candidates.map(referenceSolutionCandidate));
    payload.candidates.forEach(item => { item.candidate.referenceKind = "KNOWLEDGE_PAGE"; });
    payload.selectedCandidateIds = ["B"];
    mocks.active.mockResolvedValue({ payload, projectId: null });
    await calculate(chosen); expect(mocks.calc.mock.calls[0]?.[3].thicknessMm).toBe(25);
  });
  it.each([{ systemId: "sys-B" }, { substrateMaterial: "材料乙" }, { thicknessMax: 15 }])("正式计算不能绕过原有硬条件 %j", async constraint => {
    const ctx = context({ ...snapshot(), query: { ...snapshot().query, ...constraint } });
    expect((await calculate(ctx)).data.needsClarification).toBe(true); expect(mocks.calc).not.toHaveBeenCalled();
  });
  it("正式计算实际结果未满足原筛选条件时明确说明，不能冒充命中", async () => {
    mocks.calc.mockResolvedValue({ valid: true, notes: [], errors: [], record: { mode: "EQUIVALENT", result: { kValue: 0.4 }, steps: [], layers: [] } });
    const ctx = context(snapshot()); await calculate(ctx);
    expect(ctx.thermalCanonicalAnswers?.[0]).toContain("不能证明满足全部");
  });
  it("合规咨询不授权新计算，不改变查询条件或选择标准", async () => {
    const ctx = context(snapshot(), "按地区甲判断是否达标");
    ctx.domainDecision = domainDecision("COMPLIANCE_CHECK", ctx.userMessage!);
    const frozen = structuredClone(ctx.taskState);
    expect((await calculate(ctx, { regionCode: "region-A" })).code).toBe("THERMAL_USER_AUTHORIZATION_REQUIRED");
    expect(ctx.taskState).toEqual(frozen); expect(mocks.calc).not.toHaveBeenCalled();
  });
  it("对比只读取已选冻结候选，模型额外 ID 不扩展范围，不重新查询全库", async () => {
    const ctx = context({ ...snapshot([a, b, { ...a, id: "C" }]), selectedCandidateIds: ["A", "B"] }, "第一个和第二个哪个好");
    const result = await compare(ctx, { candidateIds: ["A", "B", "C"] });
    expect(result.data.candidates.map((item: ReferenceLookupCandidate) => item.id)).toEqual(["A", "B"]);
    expect(mocks.compare).not.toHaveBeenCalled(); expect(ctx.thermalCanonicalAnswers?.[0]).not.toContain("唯一");
  });
  it("对比拒绝不存在的用户序号，模型ID不能补出授权", async () => {
    const ctx = context(snapshot([a, b]), "对比第一个和第九个");
    expect((await compare(ctx, { candidateIds: ["A", "missing"] })).data.needsClarification).toBe(true);
    expect(ctx.thermalCanonicalAnswers?.[0]).toContain("序号"); expect(mocks.compare).not.toHaveBeenCalled();
  });
  it("用户明确第一和第三个覆盖旧选择，仍只比较冻结记录", async () => {
    const ctx = context({ ...snapshot([a, b, { ...a, id: "C", schemeCode: "S-C" }]), selectedCandidateIds: ["A", "B"] }, "第一个和第三个哪个好");
    const result = await compare(ctx, { candidateIds: ["A", "B"] });
    expect(result.data.candidates.map((item: ReferenceLookupCandidate) => item.id)).toEqual(["A", "C"]);
    expect(mocks.compare).not.toHaveBeenCalled();
  });
});

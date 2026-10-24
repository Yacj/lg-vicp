import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ thermal: vi.fn(), knowledge: vi.fn(), pages: vi.fn() }));
vi.mock("../thermal/thermal-candidate.service.js", () => ({ queryThermalCandidates: mocks.thermal }));
vi.mock("./ai-reference-pages.service.js", () => ({ loadPublishedKnowledgeReferences: mocks.knowledge }));
vi.mock("./tools/thermal-calculate.tool.js", () => ({ emitReferencePages: mocks.pages }));
vi.mock("./tools/thermal-lookup.js", () => ({ compactCandidateResult: (row: any) => row }));
import { querySolutionCandidates } from "./solution-candidate-query.service.js";
import { loadUnifiedReferencePages } from "./unified-reference-query.service.js";
const ctx = { app: {}, request: {}, user: { id: "u" }, conversation: { id: "c", projectId: "project" } } as any;
const q = { intent: "REFERENCE_LOOKUP" as const, filters: [{ metric: "K" as const, targetValue: .2, mode: "APPROX" as const }] };
const formal = { id: "formal", thicknessMm: 35, kValue: .2, productThermalResistance: 5, totalThermalResistance: 6 };
const knowledge = { id: "read", versionId: "v", documentId: "doc", pageId: "p", construction: { constructionId: "con", layers: [] },
  option: { optionId: "opt", thicknessMm: 20, kValue: .2 }, queryFacts: { thicknessMm: 20, kValue: .2, sourceDocumentId: "doc", sourceVersionId: "v" } };
beforeEach(() => {
  mocks.thermal.mockReset().mockResolvedValue({ candidates: [formal], matchedCandidates: [formal], sourceRows: [formal], filters: q.filters, notes: [], lookupMode: "APPROX" });
  mocks.knowledge.mockReset().mockResolvedValue({ pages: [], context: "", citationOptionIds: [], diagnosticRows: [knowledge.queryFacts], allConfirmedFacts: [knowledge], confirmedFacts: [knowledge], totalMatched: 1 });
  mocks.pages.mockReset().mockImplementation(async (_ctx: any, rows: any[]) => ({ candidates: rows, sources: [], blocks: [], warnings: [] }));
});
describe("正式候选和知识只读事实联合读取", () => {
  it("已核验的基层条件查询没有K/R目标时也读取正式行，不退回检索TopN", async () => {
    await loadUnifiedReferencePages(ctx, [], "查看已有示例", { intent: "REFERENCE_LOOKUP", parserSource: "LLM", substrateMaterial: "钢筋混凝土", substrateThickness: 200, filters: [] });
    expect(mocks.thermal).toHaveBeenCalledWith(ctx.app, ctx.request, ctx.user, expect.objectContaining({ substrateMaterial: "钢筋混凝土", substrateThickness: 200 }));
  });
  it("正式联合查询保留原范围并完整展示两行，不被知识内部文档范围收窄", async () => {
    mocks.thermal.mockResolvedValue({ candidates: [formal, { ...formal, id: "second", thicknessMm: 25 }], sourceRows: [], notes: [] });
    mocks.knowledge.mockResolvedValue({ pages: [], confirmedFacts: [], query: { documentIds: ["internal-only"] } });
    const result = await querySolutionCandidates(ctx, q);
    expect(result.readOnlyReferences.query.documentIds).toBeUndefined();
    expect(result.readOnlyReferences.answer).toContain("35 mm");
    expect(result.readOnlyReferences.answer).toContain("25 mm");
  });
  it("正式已命中仍完整读取知识；只读档位不进入可确认候选集合", async () => {
    const result = await querySolutionCandidates(ctx, q);
    expect(mocks.knowledge).toHaveBeenCalledWith(ctx.app, [], "project", "", expect.objectContaining(q), { completePublishedScope: true });
    expect(result.candidates.map(c => c.id)).toEqual(["formal"]); expect(result.queryDiagnostics.matchedCount).toBe(2);
    expect(result.knowledge?.confirmedFacts).toHaveLength(1); expect(result.readOnlyReferences.readOnlyPageFacts).toBe(true);
  });
  it("正式来源绑定失败后知识仍可只读返回，计数不使用绑定前数量", async () => {
    mocks.pages.mockResolvedValue({ candidates: [], blocks: [], sources: [], warnings: [] });
    const result = await querySolutionCandidates(ctx, q);
    expect(result.matchedCount).toBe(0); expect(result.candidates).toEqual([]); expect(result.queryDiagnostics.matchedCount).toBe(1);
    expect(result.queryDiagnostics.issues).toContain("SOURCE_NOT_VERIFIABLE");
  });
  it("显式资料/版本/项目限制逐项传给两类查询", async () => {
    const scoped = { ...q, documentIds: ["d"], knowledgeVersionIds: ["v"] };
    await querySolutionCandidates(ctx, scoped);
    expect(mocks.thermal.mock.calls[0]![3]).toMatchObject({ documentIds: ["d"], knowledgeVersionIds: ["v"], projectId: "project" });
    expect(mocks.knowledge.mock.calls[0]![4]).toMatchObject({ documentIds: ["d"], knowledgeVersionIds: ["v"] });
  });
  it("访问失败原样返回，不转成无命中或继续另一用户的资料", async () => {
    const denied = new Error("权限不足"); mocks.knowledge.mockRejectedValueOnce(denied);
    await expect(querySolutionCandidates(ctx, q)).rejects.toBe(denied);
  });
  it("未澄清查询不读取任何来源或发布空候选", async () => {
    await querySolutionCandidates(ctx, { unresolved: [{ field: "systemHint", reason: "体系待确认" }] });
    expect(mocks.thermal).not.toHaveBeenCalled(); expect(mocks.knowledge).not.toHaveBeenCalled();
  });
  it("生成入口的已验证pageQuery也进入两类来源；事实模式不创建正式候选", async () => {
    const result = await loadUnifiedReferencePages(ctx, [], "", { ...q, parserSource: "LLM" });
    expect(mocks.thermal).toHaveBeenCalledOnce(); expect(mocks.knowledge).toHaveBeenCalledOnce();
    expect(result.readOnlyPageFacts).toBe(true); expect(result.queryDiagnostics?.scope).toBe("JOINT");
  });
  it("同一已验证档位关联来源并避免重复计数，来源定位全部保留", async () => {
    const ids = { sourceDocumentId: "doc", sourceVersionId: "v", sourcePageId: "p", systemId: "sys", schemeId: "scheme", productSpecId: "spec" };
    const a = { ...formal, ...ids, optionId: "opt" };
    const fact = { ...knowledge, option: { ...knowledge.option, ...formal, optionId: "opt" }, queryFacts: { ...a } };
    mocks.thermal.mockResolvedValue({ candidates: [a], sourceRows: [a], notes: [] });
    mocks.knowledge.mockResolvedValue({ pages: [], context: "", diagnosticRows: [fact.queryFacts], allConfirmedFacts: [fact], confirmedFacts: [fact], citationOptionIds: ["opt"] });
    const result = await querySolutionCandidates(ctx, q);
    expect(result.sourceAssociations).toEqual([{ thermalRowId: "formal", pageId: "p", optionId: "opt", versionId: "v", qualification: "READ_ONLY" }]);
    expect(result.queryDiagnostics.matchedCount).toBe(1); expect(result.candidates).toHaveLength(1);
  });
  it("冲突只在当前身份范围诊断，其他厚度不能混入", async () => {
    const ids = { sourceDocumentId: "doc", sourceVersionId: "v", sourcePageId: "p", systemId: "sys", schemeId: "scheme", productSpecId: "spec" };
    const a = { ...formal, ...ids, thicknessMm: 99 };
    const fact = { ...knowledge, option: { ...knowledge.option, thicknessMm: 99, kValue: .8 }, queryFacts: { ...a, kValue: .8 } };
    mocks.thermal.mockResolvedValue({ candidates: [], sourceRows: [a], notes: [] });
    mocks.knowledge.mockResolvedValue({ pages: [], context: "", diagnosticRows: [fact.queryFacts], allConfirmedFacts: [fact], confirmedFacts: [] });
    const result = await querySolutionCandidates(ctx, { ...q, thicknessMm: 35 });
    expect(result.sourceConflicts).toEqual([]); expect(result.sourceAssociations).toEqual([]); expect(result.queryDiagnostics.metricScopes).toEqual([]);
  });
  it("来源校验先于截断，前12条失败仍返回后续有效行", async () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({ ...formal, id: `row-${i}` }));
    mocks.thermal.mockResolvedValue({ candidates: rows, sourceRows: rows, notes: [] });
    mocks.pages.mockImplementation(async (_ctx, rows) => ({ candidates: rows.filter((row: any) => row.id === "row-12"), sources: [], warnings: [], blocks: [] }));
    const result = await querySolutionCandidates(ctx, q);
    expect(result.candidates.map(row => row.id)).toEqual(["row-12"]); expect(result.queryDiagnostics.rejectedSourceCount).toBe(12);
  });
  it("展示截断不误报来源失败，全量命中数仍可核验", async () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ ...formal, id: `row-${i}` }));
    mocks.thermal.mockResolvedValue({ candidates: rows, sourceRows: rows, notes: [] });
    const result = await querySolutionCandidates(ctx, q);
    expect(result.candidates).toHaveLength(12); expect(result.matchedCount).toBe(15); expect(result.queryDiagnostics.issues).not.toContain("SOURCE_NOT_VERIFIABLE");
  });
});

it("厚度绑定冲突排除后仍向客户说明真实原因，不把缺少候选说成原表没有做法", async () => {
  mocks.thermal.mockResolvedValueOnce({ candidates: [], nearbyCandidates: [], identityMatchedButMetricFailed: [],
    specThicknessMismatchRows: [{ rowId: "bad", specCode: "BOARD-25", rowThicknessMm: 35, specThicknessMm: 25,
      schemeCode: "LAYERED", evidenceSource: "热工表甲", evidenceRef: "Sheet1", setVersion: 2, specVersion: 1 }] });
  const result = await querySolutionCandidates(ctx, q);
  expect(result.candidates).toEqual([]);
  expect(result.readOnlyReferences.answer).toContain("| 参考表中的保温厚度 | 35 mm | 热工表甲，Sheet1，版本 2 |");
  expect(result.readOnlyReferences.answer).toContain("| 关联规格的板厚 | 25 mm | BOARD-25，版本 1 |");
  expect(result.readOnlyReferences.answer).toContain("厚度不一致");
  expect(result.queryDiagnostics.dataConflicts).toMatchObject([{ kind: "SPEC_THICKNESS_MISMATCH", usage: "READ_ONLY" }]);
  expect(result.readOnlyReferences.solutionCandidates).toEqual([]);
});
it("同身份来源数值差异展示原值与各自来源，不把差异字段变成计算输入", async () => {
  const ids = { sourceDocumentId: "doc", sourceVersionId: "v", sourcePageId: "p", systemId: "sys", schemeId: "scheme", productSpecId: "spec" };
  const a = { ...formal, ...ids, optionId: "opt", evidenceSource: "正式表甲", evidenceRef: "Sheet A", setVersion: 3 };
  const page = { ...a, referenceKind: "KNOWLEDGE_PAGE", evidenceSource: "已确认图集乙", sourcePageLabel: "12", kValue: .21 };
  const fact = { ...knowledge, option: { ...knowledge.option, optionId: "opt" }, queryFacts: page };
  mocks.thermal.mockResolvedValue({ candidates: [a], sourceRows: [a], notes: [] });
  mocks.knowledge.mockResolvedValue({ pages: [], context: "", diagnosticRows: [page], allConfirmedFacts: [fact], confirmedFacts: [], citationOptionIds: [] });
  const result = await querySolutionCandidates(ctx, { ...q, filters: [] });
  expect(result.queryDiagnostics.dataConflicts).toMatchObject([{ kind: "SOURCE_VALUE_MISMATCH", field: "K", usage: "READ_ONLY",
    observations: [{ value: .2, source: { title: "正式表甲", location: "Sheet A", version: 3 } }, { value: .21, source: { title: "已确认图集乙", location: "印刷页码 12" } }] }]);
  expect(result.readOnlyReferences.answer).toContain("0.2 W/(m²·K)"); expect(result.readOnlyReferences.answer).toContain("0.21 W/(m²·K)");
  expect(result.readOnlyReferences.answer).toContain("不会自行选一个数值");
  expect(result.candidates[0]?.kValue).toBe(.2); expect(a.kValue).toBe(.2); expect(page.kValue).toBe(.21);
});

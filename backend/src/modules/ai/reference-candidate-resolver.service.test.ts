import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), read: vi.fn(), active: vi.fn(), current: vi.fn(), snapshot: vi.fn(), scoped: vi.fn() }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: mocks.access, loadActiveSolution: mocks.active, getSolutionSnapshot: mocks.snapshot }));
vi.mock("./reference-candidate-source.service.js", () => ({ referenceRowsStillCurrent: mocks.current }));
vi.mock("./ai-reference-pages.service.js", async original => ({ ...await original<typeof import("./ai-reference-pages.service.js")>(), readConsumableReferencePages: mocks.read, querySelectedKnowledgeCandidates: mocks.scoped }));
import { resolveReferenceRead } from "./reference-candidate-resolver.service.js";
import { resolveVisibleCandidateIds } from "./reference-candidate-selection.js";
import { referenceReadFixture } from "./reference-read.fixture.js";
import { emptySolution, refreshSolution, referenceSolutionCandidate } from "./solution-workflow.js";
import { validateAnswerFacts } from "./thermal-answer-validation.js";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import { domainDecision, decideDomainTurn } from "./ai-domain-turn-decision.js";
import { resolveReferenceQueryWithoutAgent } from "./reference-query.service.js";
import { parseSolutionAction } from "./solution-action-semantic.service.js";

function context(message = "第一个完整表格") {
  return { app: { db: {}, log: { warn: vi.fn() } }, request: {}, user: { id: "user", clientType: "C_APP" },
    domainDecision: domainDecision("REFERENCE_VIEW", message), conversation: { id: "session", projectId: null }, userMessage: message, onEvent: vi.fn(), candidateQueryRevision: 7,
    taskState: { taskType: "GENERAL", lastReferenceLookup: { query: {}, candidates: referenceReadFixture().candidates,
      projectId: null, candidateQueryRevision: 7, createdAt: new Date().toISOString() } } } as any;
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.access.mockResolvedValue({ projectId: null }); mocks.active.mockResolvedValue(null);
  mocks.read.mockResolvedValue([referenceReadFixture().row]); mocks.current.mockResolvedValue(true);
  mocks.scoped.mockResolvedValue([]);
});
describe("只读来源定位与生命周期", () => {
  it("已被筛选排除的明确编码只读来源，不换当前候选/revision，多个来源不任选", async () => {
    const ctx = context("A1-2的数据来源"), rows = referenceReadFixture().candidates;
    ctx.taskState.lastReferenceLookup.candidates = [rows[0]];
    ctx.taskState.lastReferenceLookup.query = { documentIds: ["doc"], filters: [{ metric: "K", targetValue: .1, mode: "MAX_LIMIT" }] };
    ctx.domainDecision.semantic = { reference: { items: [{ type: "CONSTRUCTION_CODE", value: "A1-2", evidence: "A1-2" }] } };
    const before = structuredClone(ctx.taskState);
    mocks.scoped.mockResolvedValue([rows[1]]);
    const result = await resolveReferenceRead(ctx);
    expect(result.candidates.map(c => c.id)).toEqual(["row-2"]);
    expect(ctx.taskState).toEqual(before);
    expect(mocks.scoped.mock.calls[0]?.[1]).toMatchObject({ schemeCode: "A1-2", filters: [] });
    expect(ctx.onEvent.mock.calls.map(([event]: any) => event)).not.toContain("reference_candidates");
    mocks.scoped.mockResolvedValue([rows[1], { ...rows[1], id: "other" }]);
    expect((await resolveReferenceRead(ctx)).needsClarification).toBe(true);
  });
  it("真实UAT-01最低K读取整个可见集合，候选/revision不变", async () => {
    const ctx = context("这里面哪个K最低？"), before = structuredClone(ctx.taskState);
    ctx.domainDecision = { ...domainDecision("COMPARE_CANDIDATES", ctx.userMessage), semantic: { reference: { scope: "LAST_VISIBLE_CANDIDATES", items: [] }, comparison: { metric: "K", direction: "MIN", evidence: "K最低" } } };
    const result = await resolveReferenceRead(ctx);
    expect(result.candidates).toHaveLength(3); expect(result.needsClarification).toBe(false);
    expect(result.facts.canonicalAnswers[0]).toContain("本次已展示的 3 条完整构造");
    expect(result.facts.canonicalAnswers[0]).toContain("A1-3");
    expect(ctx.taskState).toEqual(before);
    expect(ctx.onEvent.mock.calls.map(([event]:any) => event)).not.toContain("reference_candidates");
  });
  it("真实UAT-04已确认读取快照而不是后来查询列表；缺确认时拒绝", async () => {
    const ctx = context("查看已确认方案。");
    ctx.domainDecision = { ...domainDecision("REFERENCE_DETAIL", ctx.userMessage), referenceScope: "CURRENT_CONFIRMED" };
    mocks.active.mockResolvedValue({ projectId: null, confirmedSnapshotId: "frozen" });
    const candidates = referenceReadFixture().candidates;
    mocks.snapshot.mockResolvedValue({ projectId: null, payload: { queryStateSnapshot: {}, candidates: [candidates[0]], alternatives: [candidates[2]] } });
    const result = await resolveReferenceRead(ctx);
    expect(result.candidates.map(c => c.id)).toEqual(["row-1", "row-3"]);
    expect(mocks.snapshot).toHaveBeenCalledWith(ctx, "frozen");
    mocks.active.mockResolvedValue({ projectId: null, confirmedSnapshotId: null });
    expect((await resolveReferenceRead(ctx)).needsClarification).toBe(true);
  });
  it.each(["missing", "empty"])("真实UAT无候选%s时不误称过期或项目冲突，也不查询来源", async missing => {
    const ctx = context("把A3-2的原页给我看一下");
    ctx.candidateQueryRevision = undefined;
    if (missing === "missing") ctx.taskState.lastReferenceLookup = undefined;
    else ctx.taskState.lastReferenceLookup.candidates = [];
    const result = await resolveReferenceRead(ctx);
    expect(result.facts.canonicalAnswers.join(" ")).toContain("当前没有可定位的候选");
    expect(mocks.read).not.toHaveBeenCalled();
    expect(ctx.onEvent).not.toHaveBeenCalled();
  });
  it.each(["A3-3", "外墙A3-3", "Ａ３－３", "a3-3", "A3-3的参数"])("SM-CODE-01只提取强格式编码 %s，不从名称造身份", message => {
    const lookup = { query: {}, candidates: [{ id: "code-row", constructionCode: "外墙A3-3" }], createdAt: "" };
    expect(resolveVisibleCandidateIds(lookup, message).ids).toEqual(["code-row"]);
  });
  it.each(["A3-4", "A3-33", "A33-3", "B3-3", "A3-3和A3-4"])("SM-CODE-01相似/不存在编码 %s不扩展事实范围", message => {
    const lookup = { query: {}, candidates: [{ id: "code-row", constructionCode: "外墙A3-3" }, { id: "other-row", constructionCode: "A3-2" }], createdAt: "" };
    expect(resolveVisibleCandidateIds(lookup, message).ids).toBeUndefined();
  });
  it("裸指标追问只澄清，不读目录、不重查、不复制旧K目标", async () => {
    const ctx = context("总热阻"); ctx.domainDecision = { ...domainDecision("CLARIFY", "总热阻"), unresolved: ["你想查看当前候选参数还是设置新目标？"] }; ctx.taskState.lastReferenceLookup.query = { filters: [{ metric: "K", targetValue: .3, mode: "APPROX" }] };
    const before=structuredClone(ctx.taskState), result=await resolveReferenceQueryWithoutAgent(ctx);
    expect(result.needsClarification).toBe(true); expect(result.facts.canonicalAnswers[0]).toContain("当前候选");
    expect(ctx.taskState).toEqual(before); expect(mocks.read).not.toHaveBeenCalled(); expect(ctx.onEvent).not.toHaveBeenCalled();
  });
  it("同厚度比较恰好两项才唯一引用，多项/厚度不一致仍澄清", () => {
    const pair = { query: {}, candidates: [{id:"a",thicknessMm:45},{id:"b",thicknessMm:45}],createdAt:"" };
    expect(resolveVisibleCandidateIds(pair,"用同一厚度哪个好").ids).toEqual(["a","b"]);
    expect(resolveVisibleCandidateIds({...pair,candidates:[...pair.candidates,{id:"c",thicknessMm:45}]},"同一厚度哪个好").ids).toBeUndefined();
    expect(resolveVisibleCandidateIds({...pair,candidates:[pair.candidates[0]!,{id:"b",thicknessMm:30}]},"同一厚度哪个好").ids).toBeUndefined();
  });
  it.each(["第一个原页", "第一个完整表格", "第一个详细参数", "第一个和第三个比较"])("%s：顺序/revision/状态不变，完整模型重读", async message => {
    const ctx = context(message), before = structuredClone(ctx.taskState);
    const result = await resolveReferenceRead(ctx);
    expect(result.needsClarification).toBe(false); expect(ctx.taskState).toEqual(before);
    expect(result.facts.candidates.map(candidate => candidate.id)).toEqual(message.includes("第三") ? ["row-1", "row-3"] : ["row-1"]);
    expect(result.referencePages[0]?.renderModel?.constructions).toHaveLength(3);
    expect(result.referencePages[0]?.page.physicalPageNumber).toBe(33); expect(result.referencePages[0]?.page.pageLabel).toBe("A-22");
    expect(ctx.onEvent.mock.calls.map(([event]: any) => event)).toEqual(["reference_pages", "sources"]);
    expect(mocks.access).toHaveBeenCalledWith(ctx.app.db, ctx.user, "session");
  });
  it.each(["revision", "project", "expired", "corrupt", "oldOption", "withdrawn", "sourceVersion", "formalWithdrawn"])("%s：失效不重新绑定/不发候选", async failure => {
    const ctx = context();
    if (failure === "revision") ctx.candidateQueryRevision = 6;
    if (failure === "project") ctx.taskState.lastReferenceLookup.projectId = "other";
    if (failure === "expired") ctx.taskState.lastReferenceLookup.createdAt = new Date(Date.now() - 25 * 3600_000).toISOString();
    if (failure === "corrupt") ctx.taskState.lastReferenceLookup.candidateResultInvalid = true;
    if (failure === "oldOption") ctx.taskState.lastReferenceLookup.candidates[0].optionId = "obsolete";
    if (failure === "withdrawn") mocks.read.mockResolvedValue([]);
    if (failure === "sourceVersion") ctx.taskState.lastReferenceLookup.candidates[0].sourceVersionId = "old-version";
    if (failure === "formalWithdrawn") mocks.current.mockResolvedValue(false);
    const before = structuredClone(ctx.taskState), result = await resolveReferenceRead(ctx);
    expect(result.needsClarification).toBe(true); expect(result.facts.candidates).toEqual([]);
    expect(ctx.taskState).toEqual(before); expect(ctx.onEvent).not.toHaveBeenCalled();
  });
  it.each(["otherUser", "otherClient", "privateProject", "deletedSession"])("%s：权限拒绝发生在来源读取前", async failure => {
    mocks.access.mockRejectedValue(new Error(failure));
    await expect(resolveReferenceRead(context())).rejects.toThrow(failure);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("比较已选只消费真实SolutionState，忽略污染的lookup.Selected", async () => {
    const ctx = context("比较已选方案"); ctx.domainDecision = { ...domainDecision("COMPARE_CANDIDATES", "比较已选方案"), referenceScope: "CURRENT_SELECTED" }; ctx.domainDecision = { ...domainDecision("COMPARE_CANDIDATES", "比较已选方案"), referenceScope: "CURRENT_SELECTED" };
    ctx.taskState.lastReferenceLookup.selectedCandidateIds = ["row-1", "row-2"];
    const payload = refreshSolution(emptySolution(), {}, referenceReadFixture().candidates.map(referenceSolutionCandidate));
    payload.candidates.forEach(item => { item.candidate.referenceKind = "KNOWLEDGE_PAGE"; });
    payload.selectedCandidateIds = ["row-1", "row-3"];
    mocks.active.mockResolvedValue({ projectId: null, payload });
    const result = await resolveReferenceRead(ctx);
    expect(result.facts.candidates.map(candidate => candidate.id)).toEqual(["row-1", "row-3"]);
    expect(ctx.taskState.lastReferenceLookup.selectedCandidateIds).toEqual(["row-1", "row-2"]);
  });
  it("编码/厚度/显示K的重复引用与越界序号不能猜测", () => {
    const last = context().taskState.lastReferenceLookup;
    last.candidates[1] = { ...last.candidates[0], id: "duplicate", systemId: "other-system" };
    for (const message of ["A1-1参数", "18mm的参数", "K0.303的参数", "第一个和第99个比较"])
      expect(resolveVisibleCandidateIds(last, message).ids).toBeUndefined();
  });
  it("已选硬冲突仍可比较参数，但不冒充当前筛选命中", async () => {
    const ctx = context("比较已选方案"); ctx.domainDecision = { ...domainDecision("COMPARE_CANDIDATES", "比较已选方案"), referenceScope: "CURRENT_SELECTED" };
    const payload = refreshSolution(emptySolution(), { thicknessMax: 20 }, referenceReadFixture().candidates.map(referenceSolutionCandidate));
    payload.candidates.forEach(item => { item.candidate.referenceKind = "KNOWLEDGE_PAGE"; });
    payload.selectedCandidateIds = ["row-1", "row-3"];
    mocks.active.mockResolvedValue({ projectId: null, payload });
    const result = await resolveReferenceRead(ctx);
    expect(result.candidates.map(candidate => candidate.id)).toEqual(["row-1", "row-3"]);
    expect(result.facts.candidates.map(candidate => candidate.id)).toEqual(["row-1"]);
    expect(result.facts.nearbyCandidates?.map(candidate => candidate.id)).toEqual(["row-3"]);
    expect(result.facts.canonicalAnswers[0]).toContain("不满足当前筛选条件");
    expect(validateAnswerFacts("A1-3，25mm，K=0.303，满足全部条件。", result.facts).passed).toBe(false);
  });
  it("S1查表后详情→原页：同候选、同revision、完整页，不把来源重新当查询", async () => {
    const ctx = context("第二个基层是什么，厚度多少？"), before = structuredClone(ctx.taskState);
    const detail = await resolveReferenceQueryWithoutAgent(ctx);
    ctx.userMessage = "第二个原页给我看";
    const page = await resolveReferenceQueryWithoutAgent(ctx);
    expect(detail.facts.candidates[0]?.id).toBe("row-2");
    expect(page.facts.candidates[0]?.optionId).toBe(detail.facts.candidates[0]?.optionId);
    expect(page.referencePages?.[0]?.renderModel?.constructions).toHaveLength(3);
    expect(ctx.taskState).toEqual(before);
    expect(ctx.onEvent.mock.calls.every(([event]: any) => event !== "reference_candidates" && event !== "solution_state")).toBe(true);
  });
  it("S5解释→节点知识→第三个完整热工表：保留最近可见候选，不调用方案动作模型", async () => {
    const ctx = context(), before = structuredClone(ctx.taskState);
    const payload = refreshSolution(emptySolution(), {}, referenceReadFixture().candidates.map(referenceSolutionCandidate));
    for (const message of ["K值小就一定省钱吗", "施工时怎么处理热桥"]) {
      expect(decideDomainTurn(message, ctx.taskState.lastReferenceLookup)).toMatchObject({ intent: "GENERAL", mutation: "NONE", policyReason: "SEMANTIC_REQUIRED" });
      expect(await parseSolutionAction(ctx, message, payload)).toBeNull();
    }
    ctx.userMessage = "刚才第三个的完整热工表给我看看";
    const result = await resolveReferenceQueryWithoutAgent(ctx);
    expect(result.facts.candidates.map(candidate => candidate.id)).toEqual(["row-3"]);
    expect(ctx.taskState).toEqual(before);
  });
  it("S6按基层读取两个真实档位→两项原表，不交换K/R，也不刷新来源身份", async () => {
    // K/总R/基层沿用用户给出的关联fixture；PRODUCT_R=1.5为合成绑定字段，不宣称原资料值。
    const data = { fullText: "", systems: [
      { constructionCode: "A3-1", specClass: "III" as const, baseMaterial: "钢筋混凝土", baseThicknessMm: 200, options: [{ thicknessMm: 45, productThermalResistance: 1.5, totalThermalResistance: 3.313, kValue: .302 }] },
      { constructionCode: "A3-2", specClass: "III" as const, baseMaterial: "混凝土空心砌块", baseThicknessMm: 190, options: [{ thicknessMm: 45, productThermalResistance: 1.5, totalThermalResistance: 3.398, kValue: .294 }] },
      { constructionCode: "A3-4", specClass: "III" as const, baseMaterial: "加气混凝土砌块", baseThicknessMm: 200, options: [{ thicknessMm: 45, productThermalResistance: 1.5, totalThermalResistance: 4.04, kValue: .248 }] }
    ] };
    const model = buildKnowledgePageRenderModel("material-page", data)!;
    const candidates = data.systems.map((system, i) => ({ id: system.constructionCode, schemeCode: system.constructionCode,
      specClass: system.specClass, referenceKind: "KNOWLEDGE_PAGE", substrateMaterial: system.baseMaterial,
      substrateThickness: system.baseThicknessMm, ...system.options[0], sourcePageId: "material-page", sourceDocumentId: "doc",
      sourceVersionId: "version", optionId: model.constructions[i]!.options[0]!.optionId }));
    const ctx = context(); ctx.taskState.lastReferenceLookup.candidates = candidates;
    ctx.taskState.lastReferenceLookup.query = { specClass: "III", thicknessMm: 45 };
    const row = { page: { id: "material-page", documentId: "doc", versionId: "version", physicalPageNumber: 88,
      pageLabel: "A-22", pageLabelSource: "MANUAL", pageLabelVerified: true, metadata: { confirmedStructuredData: data } }, document: { id: "doc", title: "矩阵关联fixture" } };
    mocks.read.mockResolvedValue([row]);
    const before = structuredClone(ctx.taskState);
    ctx.userMessage = "混凝土空心砌块的K是多少";
    const block = await resolveReferenceQueryWithoutAgent(ctx);
    expect(block.facts.candidates[0]).toMatchObject({ id: "A3-2", substrateThickness: 190, thicknessMm: 45, kValue: .294, totalThermalResistance: 3.398 });
    ctx.userMessage = "那加气混凝土200mm呢";
    const aerated = await resolveReferenceQueryWithoutAgent(ctx);
    expect(aerated.facts.candidates[0]).toMatchObject({ id: "A3-4", substrateThickness: 200, thicknessMm: 45, kValue: .248, totalThermalResistance: 4.04 });
    expect(ctx.taskState).toEqual(before);
    // 明确两种基层避免猜测“两个”对应三项池的哪两项。
    ctx.userMessage = "把混凝土空心砌块和加气混凝土200mm两个结果都给我看原表";
    const both = await resolveReferenceQueryWithoutAgent(ctx);
    expect(both.facts.candidates.map(candidate => candidate.id)).toEqual(["A3-2", "A3-4"]);
    expect(both.referencePages?.[0]?.matches.map(match => match.optionId)).toEqual([candidates[1]!.optionId, candidates[2]!.optionId]);
    expect(ctx.taskState).toEqual(before);
  });
});

import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), history: vi.fn(), query: vi.fn(), read: vi.fn(), visible: vi.fn() }));
vi.mock("./reference-candidate-resolver.service.js", () => ({ resolveCandidateReference: mocks.visible }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: mocks.access }));
vi.mock("./reference-fact-history.js", async original => ({ ...await original<typeof import("./reference-fact-history.js")>(), readReferenceFactHistory: mocks.history }));
vi.mock("./ai-reference-pages.service.js", async original => ({ ...await original<typeof import("./ai-reference-pages.service.js")>(), querySelectedKnowledgeCandidates: mocks.query, readConsumableReferencePages: mocks.read }));
import { resolveReferenceFactRead, compareReferenceNumbers, compareClaimedMetricNumbers } from "./reference-fact-read.service.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import { domainDecision } from "./ai-domain-turn-decision.js";
import { referenceReadFixture } from "./reference-read.fixture.js";
import { historyMentionStatus } from "./reference-fact-history.js";
import { groundReadReferenceFormats } from "./reference-read-grounding.js";
import { publishedReferenceSource } from "./published-reference-source.js";

function context(message: string, mode: "EXPLAIN" | "VERIFY" | "COMPARE" | "DEFINE" = "EXPLAIN") {
  const semantic = domainSemanticFixture(message, "KNOWLEDGE_EXPLAIN", { factRead: { mode, metric: mode === "COMPARE" ? "PRODUCT_R" : "K", historyClaim: mode === "EXPLAIN", evidence: message } });
  return { app: { db: {}, storage: {}, log: { warn: vi.fn() } }, user: { id: "u", clientType: "C_APP" }, conversation: { id: "c", projectId: null },
    taskState: { taskType: "GENERAL" }, userMessage: message, onEvent: vi.fn(), domainDecision: { ...domainDecision("KNOWLEDGE_EXPLAIN", message), semantic } } as any;
}
const hits = [{ documentId: "doc", versionId: "version" }] as any;
it("概念含义按当前语义指标读取，不访问旧查询或生成候选", async () => {
  const ctx = context("先说传热系数的意思", "DEFINE"), before = structuredClone(ctx.taskState);
  ctx.domainDecision.semantic.factRead.explanationAspect = "MEANING";
  const result = await resolveReferenceFactRead(ctx, []);
  expect(result?.facts.canonicalAnswers[0]).toMatch(/^传热系数 K/);
  expect(result?.needsClarification).toBe(false);
  expect(result?.candidates).toEqual([]); expect(result?.referencePages).toEqual([]);
  expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled();
  expect(ctx.taskState).toEqual(before); expect(ctx.onEvent).not.toHaveBeenCalled();
});
it("来源续问读取同一已核验正式行，不以相近数值改绑原页或重算", async () => {
  const ctx = context("这个K是哪里来的？"); ctx.domainDecision.semantic.relation = "CONTINUE";
  const candidate = { id: "row", setId: "set", schemeId: "scheme", productSpecId: "spec", systemId: "system",
    setVersion: 2, schemeVersion: 3, specVersion: 4, evidenceSource: "客户热工表", evidenceRef: "SheetA",
    thicknessMm: 28, kValue: .2719, productThermalResistance: 3.7, totalThermalResistance: 3.927 };
  const row = { ...candidate, publishedReferenceSource: publishedReferenceSource(candidate) };
  ctx.taskState.lastReferenceLookup = { candidates: [row], query: {} };
  const before = structuredClone(ctx.taskState);
  mocks.visible.mockResolvedValue({ candidates: [row], pages: [], sources: [], reason: undefined });
  const result = await resolveReferenceFactRead(ctx, []);
  expect(result?.facts.canonicalAnswers[0]).toContain("K=0.2719");
  expect(result?.facts.canonicalAnswers[0]).toContain("客户热工表》SheetA，参考集版本2");
  expect(result?.facts.canonicalAnswers[0]).toContain("没有重新计算");
  expect(result?.facts.canonicalAnswers[0]).toContain("尚未关联原图");
  expect(mocks.query).not.toHaveBeenCalled(); expect(ctx.taskState).toEqual(before);
  mocks.visible.mockResolvedValue({ candidates: [], pages: [], reason: "当前候选已过期" });
  const expired = await resolveReferenceFactRead(ctx, []);
  expect(expired?.facts.canonicalAnswers[0]).toBe("当前候选已过期");
  expect(expired?.facts.canonicalAnswers[0]).not.toContain("0.2719");
});
it("指标定义由语义目标进入只读合同，不查数值或补算产品热阻", async () => {
  const ctx = context("20mm保温层的热阻是整体传热阻吗？", "DEFINE"), before = structuredClone(ctx.taskState);
  const result = await resolveReferenceFactRead(ctx, []);
  expect(result?.validationCode).toBe("THERMAL_METRIC_DEFINITION");
  expect(result?.facts.canonicalAnswers[0]).toContain("未单独给出");
  expect(result?.facts.canonicalAnswers[0]).not.toMatch(/4\.8|0\.11|0\.04/);
  expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled(); expect(ctx.taskState).toEqual(before);
});
beforeEach(() => {
  vi.resetAllMocks(); mocks.access.mockResolvedValue({ projectId: null }); mocks.history.mockResolvedValue([]);
  const fixture = referenceReadFixture();
  mocks.query.mockResolvedValue(fixture.candidates); mocks.read.mockResolvedValue([fixture.row]);
});
it.each(["先别计算，只解释芯材厚度怎样影响热阻。", "同一种材料变厚，R和K如何变化？"])("定性解释保留关系适用条件且不授权计算：%s", async message => {
  const ctx = context(message, "DEFINE"), before = structuredClone(ctx.taskState);
  const result = await resolveReferenceFactRead(ctx, []);
  expect(result?.needsClarification).toBe(false);
  const answer = result!.facts.canonicalAnswers[0]!;
  expect(answer).toContain("修正系数 α 相同");
  expect(answer).toContain("其他构造层及表面热阻不变");
  expect(answer).toContain("芯材越厚，该芯层热阻越大");
  expect(answer).toContain("无法确定产品整体或整构造的数值");
  expect(result?.candidates).toEqual([]); expect(result?.referencePages).toEqual([]);
  expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  expect(ctx.taskState).toEqual(before); expect(ctx.onEvent).not.toHaveBeenCalled();
});
it("型号热阻关系由代码计算，4.800小于5.000；不同指标不能混算", () => {
  const a = { productThermalResistance: 4.8, totalThermalResistance: 99 } as any, b = { productThermalResistance: 5 } as any;
  expect(compareReferenceNumbers(a, b, "PRODUCT_R")).toContain("4.800 < 5.000");
  expect(compareReferenceNumbers(b, a, "PRODUCT_R")).toContain("5.000 > 4.800");
  expect(compareReferenceNumbers(a, b, "TOTAL_R")).toContain("缺失");
});
it("用户给定大小关系可以直接确定，但不能当作正式来源已核验", () => {
  expect(compareClaimedMetricNumbers("I型15mm R=4.8与II型50mm R=5.0谁大？")).toContain("4.800 < 5.000");
  expect(compareClaimedMetricNumbers("R=4.8与K=5.0")).toBe("");
  expect(compareClaimedMetricNumbers("R=4.8与R=5.0与R=6.0")).toBe("");
  expect(compareClaimedMetricNumbers("R=-4.8与R=5.0")).toBe("");
});
it("历史前提只由真实助手消息编码核验，独立知识命中不是历史", async () => {
  const ctx = context("你前面说的A1-1是什么？"), before = structuredClone(ctx.taskState);
  let result = await resolveReferenceFactRead(ctx, hits);
  expect(result?.facts.canonicalAnswers[0]).toContain("此前未提到 A1-1");
  mocks.history.mockResolvedValue([{ content: "A1-1 的原表如下", metadata: {}, createdAt: new Date() }]);
  result = await resolveReferenceFactRead(ctx, hits);
  expect(result?.facts.canonicalAnswers[0]).toContain("先前的助手回答提到过 A1-1");
  expect(result?.facts.canonicalAnswers[0]).not.toContain("另一版");
  expect(ctx.taskState).toEqual(before); expect(ctx.onEvent).not.toHaveBeenCalled();
});
it("确认数字是只读；错误数字不反选另一条记录，指定构造来源后比较", async () => {
  const ctx = context("帮我确认A1-1 K=0.999这个数字对不对", "VERIFY"), before = structuredClone(ctx.taskState);
  const result = await resolveReferenceFactRead(ctx, hits);
  expect(result?.facts.canonicalAnswers[0]).toContain("不一致");
  expect(result?.candidates.map(c => c.constructionCode ?? c.schemeCode)).toEqual(["A1-1"]);
  expect(ctx.taskState).toEqual(before); expect(ctx.onEvent).not.toHaveBeenCalled();
});
it("缺构造身份只澄清缺失项，不伪称旧序号或创建候选", async () => {
  const result = await resolveReferenceFactRead(context("帮我确认K=0.294对不对", "VERIFY"), []);
  expect(result?.facts.canonicalAnswers[0]).toContain("构造编号");
  expect(mocks.query).not.toHaveBeenCalled();
});
it("Policy已拒绝的factRead提案不能借CLARIFY继续读取来源", async () => {
  const ctx = context("确认K=0.294", "VERIFY"); ctx.domainDecision.intent = "CLARIFY";
  expect(await resolveReferenceFactRead(ctx, hits)).toBeUndefined();
  expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled();
});
it.each(["project", "revision", "otherUser", "withdrawn", "oldOption"])("事实读取%s失效仍拒绝", async failure => {
  const ctx = context("A1-1是什么");
  if (failure === "project") mocks.access.mockResolvedValue({ projectId: "other" });
  if (failure === "revision") ctx.candidateQueryRevision = 5;
  if (failure === "otherUser") mocks.access.mockRejectedValue(new Error("otherUser"));
  if (failure === "withdrawn") mocks.read.mockResolvedValue([]);
  if (failure === "oldOption") mocks.query.mockResolvedValue(referenceReadFixture().candidates.map(c => ({ ...c, optionId: "old" })));
  if (failure === "otherUser") await expect(resolveReferenceFactRead(ctx, hits)).rejects.toThrow("otherUser");
  else expect((await resolveReferenceFactRead(ctx, hits))?.candidates).toEqual([]);
  expect(ctx.onEvent).not.toHaveBeenCalled();
});
it("SM-READ-FORMAT-01本轮只有45mm时不接受模型捏造历史编号，序号原样留给时间门禁", () => {
  const message = "还是给我原来45mm原页";
  const semantic = domainSemanticFixture(message, "REFERENCE_VIEW", { referenceTime: "EARLIER", reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: 7,
    items: [{ type: "CONSTRUCTION_CODE", value: "A3-2", evidence: "45mm" }] } });
  expect(groundReadReferenceFormats(message, semantic).reference.items).toEqual([{ type: "THICKNESS", value: 45, evidence: message }]);
  const position = domainSemanticFixture("原来第二个45mm原页", "REFERENCE_VIEW", { reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: 7,
    items: [{ type: "POSITION", value: 2, evidence: "第二个" }] } });
  expect(groundReadReferenceFormats("原来第二个45mm原页", position)).toBe(position);
  expect(historyMentionStatus("A3-2", [{ content: "A3-22" }])).toBe(false);
});

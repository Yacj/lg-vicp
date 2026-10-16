import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), history: vi.fn(), query: vi.fn(), read: vi.fn() }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: mocks.access }));
vi.mock("./reference-fact-history.js", async original => ({ ...await original<typeof import("./reference-fact-history.js")>(), readReferenceFactHistory: mocks.history }));
vi.mock("./ai-reference-pages.service.js", async original => ({ ...await original<typeof import("./ai-reference-pages.service.js")>(), querySelectedKnowledgeCandidates: mocks.query, readConsumableReferencePages: mocks.read }));
import { resolveReferenceFactRead, compareReferenceNumbers } from "./reference-fact-read.service.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import { domainDecision } from "./ai-domain-turn-decision.js";
import { referenceReadFixture } from "./reference-read.fixture.js";
import { historyMentionStatus } from "./reference-fact-history.js";
import { groundReadReferenceFormats } from "./reference-read-grounding.js";

function context(message: string, mode: "EXPLAIN" | "VERIFY" | "COMPARE" | "DEFINE" = "EXPLAIN") {
  const semantic = domainSemanticFixture(message, "KNOWLEDGE_EXPLAIN", { factRead: { mode, metric: mode === "COMPARE" ? "PRODUCT_R" : "K", historyClaim: mode === "EXPLAIN", evidence: message } });
  return { app: { db: {}, storage: {}, log: { warn: vi.fn() } }, user: { id: "u", clientType: "C_APP" }, conversation: { id: "c", projectId: null },
    taskState: { taskType: "GENERAL" }, userMessage: message, onEvent: vi.fn(), domainDecision: { ...domainDecision("KNOWLEDGE_EXPLAIN", message), semantic } } as any;
}
const hits = [{ documentId: "doc", versionId: "version" }] as any;
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
it("型号热阻关系由代码计算，4.800小于5.000；不同指标不能混算", () => {
  const a = { productThermalResistance: 4.8, totalThermalResistance: 99 } as any, b = { productThermalResistance: 5 } as any;
  expect(compareReferenceNumbers(a, b, "PRODUCT_R")).toContain("4.800 < 5.000");
  expect(compareReferenceNumbers(b, a, "PRODUCT_R")).toContain("5.000 > 4.800");
  expect(compareReferenceNumbers(a, b, "TOTAL_R")).toContain("缺失");
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

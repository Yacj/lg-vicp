import "dotenv/config";
import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), history: vi.fn(), query: vi.fn(), read: vi.fn() }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: mocks.access }));
vi.mock("./reference-fact-history.js", async original => ({ ...await original<typeof import("./reference-fact-history.js")>(), readReferenceFactHistory: mocks.history }));
vi.mock("./ai-reference-pages.service.js", async original => ({ ...await original<typeof import("./ai-reference-pages.service.js")>(), querySelectedKnowledgeCandidates: mocks.query, readConsumableReferencePages: mocks.read }));
import { resolveReferenceFactRead } from "./reference-fact-read.service.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import { domainDecision } from "./ai-domain-turn-decision.js";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import { referenceReadFixture } from "./reference-read.fixture.js";

function setup(message = "确认一下这里的R=5.369是否正确，不是确认方案。", metric = "TOTAL_R", both = false) {
  const data = JSON.parse(readFileSync(new URL("../../../tests/fixtures/complex-atlas/page-90.json", import.meta.url), "utf8")).data;
  const model = buildKnowledgePageRenderModel("page-90", data)!;
  const matches = model.constructions.slice(0, both ? 2 : 1).map(construction => ({ pageId: "page-90", constructionId: construction.constructionId,
    optionId: construction.options.find(row => row.thicknessMm === 20)!.optionId, confirmedRevision: model.confirmedRevision, fieldKeys: ["totalThermalResistance"], answerOffset: 123 }));
  const history = [{ content: "平屋面，20mm，传热阻 R=5.369。", createdAt: new Date(), metadata: { referencePages: [{ documentId: "document", pageId: "page-90", versionId: "version", matches }] } }];
  const row = { page: { id: "page-90", documentId: "document", versionId: "version", pageLabel: "90", pageLabelSource: "MANUAL", pageLabelVerified: true,
    physicalPageNumber: 2, metadata: { recognitionStatus: "CONFIRMED", confirmedStructuredData: data } }, document: { id: "document", title: "隔离人工基线", insulationSystemId: null }, version: { id: "version" } };
  mocks.read.mockResolvedValue([row]); mocks.history.mockResolvedValue(history);
  const query = { intent: "REFERENCE_LOOKUP", parserSource: "LLM", pageLabel: "90", thicknessMm: 20, ...(both ? {} : { placement: "UPRIGHT" }), documentIds: ["document"], knowledgeVersionIds: ["version"] };
  const semantic = domainSemanticFixture(message, "REFERENCE_DETAIL", { factRead: { mode: "VERIFY", metric: metric as any, historyClaim: false, evidence: message } });
  const ctx: any = { app: { db: {}, storage: {}, log: { warn: vi.fn() } }, user: { id: "user", clientType: "C_APP" },
    conversation: { id: "conversation", userId: "user", projectId: null, clientApp: "c_app" }, userMessage: message,
    taskState: { taskType: "GENERAL", confirmedPageLookup: { query, createdAt: new Date().toISOString(), conversationId: "conversation", userId: "user", projectId: null, clientApp: "c_app" } },
    domainDecision: { ...domainDecision("REFERENCE_DETAIL", message), semantic }, onEvent: vi.fn() };
  return { ctx, history, data, row, matches };
}
beforeEach(() => { vi.resetAllMocks(); mocks.access.mockResolvedValue({ projectId: null }); });
it("旧确认页只有事实引用时，也核对实际显示档位而不是按K反选构造", async () => {
  const { ctx } = setup("确认K=0.303是否正确", "K"), fixture = referenceReadFixture(), construction = fixture.model.constructions[0]!;
  ctx.taskState.confirmedPageLookup.query = { documentIds: ["doc"], knowledgeVersionIds: ["version"], schemeCode: "A1-1", thicknessMm: 18 };
  mocks.read.mockResolvedValue([fixture.row]);
  mocks.history.mockResolvedValue([{ content: "A1-1 18mm K=.303", createdAt: new Date(), metadata: { referencePages: [{ documentId: "doc", pageId: "page", versionId: "version", matches: [{
    pageId: "page", constructionId: construction.constructionId, optionId: construction.options[0]!.optionId,
    confirmedRevision: fixture.model.confirmedRevision, fieldKeys: ["thicknessMm", "kValue"] }] }] } }]);
  const result = await resolveReferenceFactRead(ctx, []);
  expect(result?.needsClarification).toBe(false); expect(result?.validationCode).toBe("CONFIRMED_PAGE_FACT_VERIFY");
  expect(result?.facts.canonicalAnswers[0]).toContain("一致"); expect(result?.referencePages[0]?.matches).toHaveLength(1);
  expect(mocks.query).not.toHaveBeenCalled(); expect(result?.candidates).toEqual([]);
});

it.each(["TOTAL_R", "PRODUCT_R"])("T11裸R按确认来源列核验，兼容模型旧默认%s，不造编号/产品R", async metric => {
  const { ctx } = setup(undefined, metric), before = structuredClone(ctx.taskState);
  const result = await resolveReferenceFactRead(ctx, []);
  expect(result?.needsClarification).toBe(false); expect(result?.validationCode).toBe("CONFIRMED_PAGE_FACT_VERIFY");
  expect(result?.facts.canonicalAnswers[0]).toContain("一致"); expect(result?.facts.canonicalAnswers[0]).toContain("5.369");
  expect(result?.facts.canonicalAnswers[0]).not.toMatch(/R₀|产品层热阻/);
  expect(result?.referencePages[0]?.matches).toHaveLength(1);
  expect(result?.referencePages[0]?.matches[0]?.answerOffset).toBeUndefined();
  expect(result?.candidates).toEqual([]); expect(mocks.query).not.toHaveBeenCalled(); expect(ctx.onEvent).not.toHaveBeenCalled(); expect(ctx.taskState).toEqual(before);
});
it("90页两组同值各自核验，错误数字也不反选其他档位", async () => {
  const { ctx, matches } = setup("核对这里R=5.999是否正确", "TOTAL_R", true);
  const result = await resolveReferenceFactRead(ctx, []);
  expect(result?.needsClarification).toBe(false); expect(result?.facts.canonicalAnswers[0]).toContain("不一致");
  expect(result?.referencePages[0]?.matches.map(item => item.optionId)).toEqual(matches.map(item => item.optionId));
  expect(new Set(result?.referencePages[0]?.matches.map(item => item.constructionId)).size).toBe(2);
});
it("同档位在旧回答多次引用时，新核验全部更新指标高亮并清除旧偏移", async () => {
  const { ctx, matches } = setup();
  matches.push({ ...matches[0]!, fieldKeys: ["thicknessMm"], answerOffset: 456 });
  const result = await resolveReferenceFactRead(ctx, []);
  expect(result?.referencePages[0]?.matches).toHaveLength(2);
  result?.referencePages[0]?.matches.forEach(match => { expect(match.fieldKeys).toContain("totalThermalResistance"); expect(match.answerOffset).toBeUndefined(); });
});
it("明确产品R不改成构造R，不以芯层R代替缺失值", async () => {
  const { ctx } = setup("核对产品热阻R=5.369是否正确", "PRODUCT_R");
  const result = await resolveReferenceFactRead(ctx, []);
  expect(result?.needsClarification).toBe(true); expect(result?.facts.canonicalAnswers[0]).toContain("未单独给出");
});
it("当前显示K也可核验，显式改厚度须先重新定位", async () => {
  let fixture = setup("核对K=0.186是否正确", "K");
  expect((await resolveReferenceFactRead(fixture.ctx, []))?.needsClarification).toBe(false);
  fixture = setup("核对25mm的R=5.369是否正确");
  expect((await resolveReferenceFactRead(fixture.ctx, []))?.facts.canonicalAnswers[0]).toContain("板厚");
});
it.each(["expired", "user", "client", "project", "version", "revision", "partialRevision", "withdrawn", "history", "scope", "noSymbol"])("%s失效或歧义不核验，不创建候选", async failure => {
  const { ctx, history, data, matches } = setup(undefined, "TOTAL_R", true);
  const lookup = ctx.taskState.confirmedPageLookup;
  if (failure === "expired") lookup.createdAt = new Date(Date.now() - 25 * 3600_000).toISOString();
  if (failure === "user") lookup.userId = "other";
  if (failure === "client") lookup.clientApp = "pc_ai";
  if (failure === "project") lookup.projectId = "other";
  if (failure === "version") history[0]!.metadata.referencePages[0]!.versionId = "old";
  if (failure === "revision") matches.forEach(match => match.confirmedRevision = "old");
  if (failure === "partialRevision") matches[1]!.confirmedRevision = "old";
  if (failure === "withdrawn") mocks.read.mockResolvedValue([]);
  if (failure === "history") mocks.history.mockResolvedValue([]);
  if (failure === "scope") lookup.query.knowledgeVersionIds = [];
  if (failure === "noSymbol") data.systems.forEach((system: any) => system.sourceColumns.forEach((column: any) => column.symbol = null));
  const result = await resolveReferenceFactRead(ctx, []);
  expect(result?.needsClarification).toBe(true); expect(result?.candidates).toEqual([]); expect(mocks.query).not.toHaveBeenCalled();
});

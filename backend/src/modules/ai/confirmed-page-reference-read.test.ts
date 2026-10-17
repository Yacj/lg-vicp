import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), history: vi.fn(), read: vi.fn() }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: mocks.access }));
vi.mock("./reference-fact-history.js", () => ({ readReferenceFactHistory: mocks.history }));
vi.mock("./ai-reference-pages.service.js", async original => ({ ...await original<typeof import("./ai-reference-pages.service.js")>(), readConsumableReferencePages: mocks.read }));
import { readHistoricalConfirmedPage } from "./confirmed-page-reference-read.js";
import { referenceReadFixture } from "./reference-read.fixture.js";
import { domainDecision } from "./ai-domain-turn-decision.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";

function setup() {
  const fixture = referenceReadFixture(), conversation = { id: "c", userId: "u", projectId: null, clientApp: "c_app" };
  const model = fixture.model, construction = model.constructions[0]!, option = construction.options[0]!;
  const stored: any = { documentId: "doc", pageId: "page", versionId: "version", matches: [{ pageId: "page", constructionId: construction.constructionId,
    optionId: option.optionId, confirmedRevision: model.confirmedRevision, fieldKeys: ["thicknessMm", "kValue"], answerOffset: 999 }] };
  const history: any = [{ createdAt: new Date(), metadata: { queryScope: conversation, referencePages: [stored] } }];
  mocks.history.mockResolvedValue(history); mocks.read.mockResolvedValue([fixture.row]);
  const message = "还是给我原来18mm的原页", semantic = domainSemanticFixture(message, "REFERENCE_VIEW", { reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: null,
    items: [{ type: "THICKNESS", value: 18, evidence: "18mm" }] } });
  const ctx: any = { app: { db: {}, storage: {}, log: { warn: vi.fn() } }, conversation, user: { id: "u", clientType: "C_APP" }, userMessage: message,
    taskState: { taskType: "GENERAL" }, domainDecision: { ...domainDecision("REFERENCE_VIEW", message), semantic }, onEvent: vi.fn() };
  return { ctx, history, stored, fixture };
}
beforeEach(() => { vi.resetAllMocks(); mocks.access.mockResolvedValue({ projectId: null }); });
it("无Candidate且已切出查询时仍可按实际历史引用返回原页，状态与候选不变", async () => {
  const { ctx } = setup(), before = structuredClone(ctx.taskState), result = await readHistoricalConfirmedPage(ctx);
  expect(result?.needsClarification).toBe(false); expect(result?.referencePages[0]?.matches).toHaveLength(1);
  expect(result?.referencePages[0]?.matches[0]?.summary.thicknessMm).toBe(18);
  expect(result?.referencePages[0]?.matches[0]?.answerOffset).toBeUndefined();
  expect(result?.candidates).toEqual([]); expect(ctx.taskState).toEqual(before); expect(ctx.onEvent).not.toHaveBeenCalled();
});
it.each(["expired", "future", "user", "client", "project", "scope", "position", "version", "revision", "withdrawn", "candidateRevision", "formal"])("%s不能借原页回溯绕过边界", async failure => {
  const { ctx, history, stored } = setup();
  if (failure === "expired") history[0].createdAt = new Date(0);
  if (failure === "future") history[0].createdAt = new Date(Date.now() + 3600_000);
  if (failure === "user") history[0].metadata.queryScope = { ...ctx.conversation, userId: "other" };
  if (failure === "client") history[0].metadata.queryScope = { ...ctx.conversation, clientApp: "pc_ai" };
  if (failure === "project") mocks.access.mockResolvedValue({ projectId: "other" });
  if (failure === "scope") delete history[0].metadata.queryScope;
  if (failure === "position") ctx.domainDecision.semantic.reference.items = [{ type: "POSITION", value: 1, evidence: "第一个" }];
  if (failure === "version") stored.versionId = "old";
  if (failure === "revision") stored.matches[0].confirmedRevision = "old";
  if (failure === "withdrawn") mocks.read.mockResolvedValue([]);
  if (failure === "candidateRevision") ctx.candidateQueryRevision = 1;
  if (failure === "formal") ctx.domainDecision = domainDecision("SOLUTION_ACTION", "选18mm");
  expect(await readHistoricalConfirmedPage(ctx)).toBeUndefined(); expect(ctx.onEvent).not.toHaveBeenCalled();
});

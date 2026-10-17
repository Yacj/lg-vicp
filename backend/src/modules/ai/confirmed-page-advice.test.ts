import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), access: vi.fn() }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: mocks.access }));
vi.mock("./ai-reference-pages.service.js", async original => ({ ...await original<typeof import("./ai-reference-pages.service.js")>(), loadPublishedKnowledgeReferences: mocks.read }));
import { confirmedPageProsCons } from "./confirmed-page-advice.js";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import { domainDecision } from "./ai-domain-turn-decision.js";
const conversation = { id: "c", userId: "u", clientApp: "c_app", projectId: null };
function ctx() { return { app: { db: {} }, conversation, user: { id: "u" }, userMessage: "列优缺点", taskState: { taskType: "GENERAL",
  confirmedPageLookup: { ...conversation, conversationId: "c", createdAt: new Date().toISOString(), query: { documentIds: ["doc"], knowledgeVersionIds: ["version"], thicknessMm: 25 } } },
  domainDecision: { ...domainDecision("SOLUTION_ADVICE", "列优缺点"), semantic: domainSemanticFixture("列优缺点", "SOLUTION_ADVICE", { adviceFocus: "PROS_CONS" }) } } as any; }
beforeEach(() => {
  vi.resetAllMocks(); mocks.access.mockResolvedValue({ projectId: null });
  const model = buildKnowledgePageRenderModel("page", { schemaVersion: 2, fullText: "", systems: [{ rawConstructionLabel: "倒置屋面", baseMaterial: "钢筋混凝土楼板", options: [{ thicknessMm: 25, kValue: .162, totalThermalResistance: 6.169 }] }] } as any)!;
  const id = model.constructions[0]!.options[0]!.optionId;
  mocks.read.mockResolvedValue({ authoritative: true, readOnlyPageFacts: true, answer: `[[KP:${id}:thicknessMm,kValue]]`, pages: [{ type: "REFERENCE_PAGE", page: { pageId: "page", documentId: "doc", versionId: "version", documentTitle: "确认图集", pageLabel: "90", pageNumber: 1, imageUrl: "" }, renderModel: model, matches: [] }] });
});
it("无正式Candidate、缺产品整体R仍可对照确认构造优缺点，状态不变", async () => {
  const context = ctx(), before = structuredClone(context.taskState), result = await confirmedPageProsCons(context);
  expect(result?.answer).toContain("优点："); expect(result?.answer).toContain("局限："); expect(result?.answer).toContain("K=0.162");
  expect(result?.candidates).toEqual([]); expect(context.taskState).toEqual(before);
  expect(result?.referencePages[0]?.matches[0]).toMatchObject({ fieldKeys: ["thicknessMm", "kValue"], summary: { thicknessMm: 25, kValue: .162 } });
});
it.each(["user", "project", "expired", "revision", "withdrawn"])("%s失效不提供v2建议", async failure => {
  const context = ctx();
  if (failure === "user") context.taskState.confirmedPageLookup.userId = "other";
  if (failure === "project") mocks.access.mockResolvedValue({ projectId: "other" });
  if (failure === "expired") context.taskState.confirmedPageLookup.createdAt = new Date(0).toISOString();
  if (failure === "revision") context.candidateQueryRevision = 7;
  if (failure === "withdrawn") mocks.read.mockResolvedValue({ authoritative: false });
  expect(await confirmedPageProsCons(context)).toBeUndefined();
});

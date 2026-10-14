import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
import { generateConfirmedSolutionReport } from "./solution-report.service.js";
import { loadConfirmedSolutionDocument } from "./confirmed-solution-document.service.js";
import { confirmedSolutionFixture } from "./solution-report.fixture.js";
import { domainDecision } from "./ai-domain-turn-decision.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import { isCurrentReportUiAction } from "./report-authorization.js";
const m = vi.hoisted(() => ({ access: vi.fn(), active: vi.fn(), snapshot: vi.fn(), generate: vi.fn() }));
vi.mock("./solution-state.service.js", () => ({ assertSolutionAccess: m.access, loadActiveSolution: m.active, getSolutionSnapshot: m.snapshot }));
vi.mock("../reports/report-snapshot.service.js", () => ({ generateTemplateReport: m.generate }));
const ctx = () => ({ app: {} as any, request: {} as any, user: { id: "user" } as any,
  conversation: { id: "conversation", projectId: null } as any, userMessage: "生成正式技术方案报告",
  reportAuthorization: { userId: "user", conversationId: "conversation" }, onEvent: vi.fn() });
beforeEach(() => {
  vi.clearAllMocks();
  const snapshot = confirmedSolutionFixture();
  m.access.mockResolvedValue({ id: "conversation", projectId: null });
  m.active.mockResolvedValue({ id: "state", userId: "user", conversationId: "conversation", stage: "CONFIRMED", projectId: null, confirmedSnapshotId: snapshot.id });
  m.snapshot.mockResolvedValue({ ...snapshot, referenceImages: [{ sourcePageId: "page", imageUrl: "signed-url-not-persisted" }] });
  m.generate.mockResolvedValue({ report: { id: "report", status: "QUEUED" }, taskId: "task", solutionSnapshotId: snapshot.id, reused: false });
});
it.each([null, { stage: "SELECTED", projectId: null }, { stage: "CONFIRMED", projectId: "other", confirmedSnapshotId: "s" }])("无当前确认状态拒绝：%s", async active => {
  m.active.mockResolvedValue(active); await expect(loadConfirmedSolutionDocument(ctx())).rejects.toMatchObject({ code: "SOLUTION_SNAPSHOT_REQUIRED" });
});
it.each(["userId", "conversationId", "projectId", "solutionStateId"])("拒绝跨归属快照：%s", async field => {
  const snapshot = await m.snapshot(); snapshot[field] = "other";
  await expect(loadConfirmedSolutionDocument(ctx())).rejects.toMatchObject({ code: "SOLUTION_SNAPSHOT_INVALID" });
});
it("旧确认快照标识拒绝，不使用最新状态替代用户期望", async () => {
  await expect(loadConfirmedSolutionDocument(ctx(), "old")).rejects.toMatchObject({ code: "SOLUTION_SNAPSHOT_CHANGED" });
});
it("项目仅可见不等于报告生成/管理权限，AI与REST保持同一门槛", async () => {
  const context = ctx(); context.conversation.projectId = "shared";
  m.access.mockResolvedValue({ id: "conversation", projectId: "shared" });
  m.active.mockResolvedValue({ id: "state", userId: "user", conversationId: "conversation", stage: "CONFIRMED", projectId: "shared", confirmedSnapshotId: confirmedSolutionFixture().id });
  context.app.db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "shared", createdById: "other", visibility: "PUBLIC" }] }) }) }) };
  await expect(loadConfirmedSolutionDocument(context)).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(m.snapshot).not.toHaveBeenCalled();
});
it.each(["final", "selected", "facts", "alternative"])("Final与冻结事实不完整拒绝：%s", async kind => {
  const snapshot = await m.snapshot();
  if (kind === "final") snapshot.payload.finalCandidateIds = [];
  if (kind === "selected") snapshot.payload.selectedCandidateIds = [];
  if (kind === "facts") delete snapshot.payload.candidates[0].kValue;
  if (kind === "alternative") snapshot.payload.alternatives = [snapshot.payload.candidates[0]];
  await expect(loadConfirmedSolutionDocument(ctx())).rejects.toThrow();
});
it("仅快照转换工程事实，图片失效时保留冻结整表；签名URL不入模型", async () => {
  const snapshot = await m.snapshot(); snapshot.referenceImages = [{ sourcePageId: "page", imageUrl: null }];
  const model = await loadConfirmedSolutionDocument(ctx());
  expect(model.solutions[0]).toMatchObject({ kValue: .1245, substrateMaterial: "混凝土", thicknessMm: 45 });
  expect(model.referencePages[0]).toMatchObject({ pageImageObjectKey: null, renderModel: { constructions: expect.any(Array) } });
  expect(JSON.stringify(model)).not.toContain("signed-url");
});
it("服务本身拒绝只读请求，即使拥有历史确认快照", async () => {
  const context = { ...ctx(), reportAuthorization: undefined, domainDecision: domainDecision("REPORT_REQUEST", "生成正式技术方案报告") };
  expect(await generateConfirmedSolutionReport(context)).toMatchObject({ ok: false, code: "REPORT_AUTHORIZATION_REQUIRED" });
  expect(m.generate).not.toHaveBeenCalled();
});
it("经过Domain Policy核验的本轮请求可以调用正式创建服务", async () => {
  const context = ctx();
  const decision = applyDomainPolicy(context.userMessage, domainSemanticFixture(context.userMessage, "REPORT_REQUEST"));
  await generateConfirmedSolutionReport({ ...context, reportAuthorization: undefined, domainDecision: decision }, "project_brief");
  expect(m.generate).toHaveBeenCalledWith(context.app, context.request, context.user, expect.objectContaining({ reportType: "project_brief", solutionAuthorization: expect.any(Object) }));
  expect(context.onEvent).toHaveBeenCalledWith("report_queued", expect.objectContaining({ status: "QUEUED", solutionSnapshotId: confirmedSolutionFixture().id }));
});
it("重复请求复用READY报告不发送排队/提前完成事件", async () => {
  m.generate.mockResolvedValue({ report: { id: "report", status: "READY" }, taskId: "task", solutionSnapshotId: confirmedSolutionFixture().id, reused: true });
  const context = ctx(); expect(await generateConfirmedSolutionReport(context)).toMatchObject({ ok: true, data: { reused: true, queued: false, status: "READY" } });
  expect(context.onEvent).not.toHaveBeenCalled();
});
it("普通报告授权不能直接调用正式方案入口", async () => {
  const context = ctx();
  expect(await generateConfirmedSolutionReport({ ...context, reportAuthorization: { ...context.reportAuthorization, reportType: "material_compare" } })).toMatchObject({ ok: false, code: "REPORT_TYPE_NOT_AUTHORIZED" });
  expect(m.generate).not.toHaveBeenCalled();
});
it("旧pending/自然语言续聊布尔不能签发UI授权，必须本轮真实UI枚举或Domain Policy", async () => {
  const resumed = { generateReportNow: true };
  for (const confirmAction of [undefined, "CONTINUE"]) expect(isCurrentReportUiAction(undefined, confirmAction, resumed)).toBe(false);
  expect(isCurrentReportUiAction(undefined, "GENERATE_REPORT", resumed)).toBe(true);
  expect(isCurrentReportUiAction(undefined, "GENERATE_REPORT", { generateReportNow: false })).toBe(false);
  expect(isCurrentReportUiAction("GENERATE_REPORT", undefined, null)).toBe(true);
  expect(await generateConfirmedSolutionReport({ ...ctx(), reportAuthorization: undefined, userMessage: "可以", domainDecision: domainDecision("GENERAL", "可以") })).toMatchObject({ ok: false, code: "REPORT_AUTHORIZATION_REQUIRED" });
  expect(m.generate).not.toHaveBeenCalled();
});

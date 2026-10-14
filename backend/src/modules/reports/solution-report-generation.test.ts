import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
import { reportMemoryDb } from "../../../tests/helpers/report-memory-db.js";
import { generateTemplateReport } from "./report-snapshot.service.js";
import { retryReport } from "./report-generation.service.js";
import { aiConversations, reports, reportSnapshots, reportTemplates, asyncTasks, enterpriseProfiles, files, reportSettings } from "../../db/schema.js";
import { confirmedSolutionFixture } from "../ai/solution-report.fixture.js";
import { toSolutionDocumentModel } from "../ai/solution-document-model.js";
const m = vi.hoisted(() => ({ load: vi.fn(), audit: vi.fn() }));
vi.mock("../ai/confirmed-solution-document.service.js", () => ({ loadConfirmedSolutionDocument: m.load }));
vi.mock("../audit-logs/audit-log.service.js", () => ({ writeAuditLog: m.audit }));
let db: any, app: any;
const actor = { id: "user", clientType: "C_APP" } as any;
const input = () => ({ reportType: "technical_scheme", projectId: null, conversationId: "conversation",
  solutionAuthorization: { reportAuthorization: { userId: "user", conversationId: "conversation" } } });
beforeEach(() => {
  vi.clearAllMocks(); db = reportMemoryDb();
  db.rows(aiConversations).push({ id: "conversation" });
  db.rows(reportTemplates).push({ id: "template", code: "standard_report", version: 1, name: "技术方案", sectionsJson: [], status: "PUBLISHED" });
  app = { db, queues: { reportGeneration: { add: vi.fn(async () => ({ id: "job" })) } } };
  m.load.mockResolvedValue(toSolutionDocumentModel(confirmedSolutionFixture()));
});
it("无授权或只有产品上下文拒绝，零报告/任务/队列", async () => {
  await expect(generateTemplateReport(app, {} as any, actor, { reportType: "technical_scheme", contextOverlay: { snapshotId: "product-context" } })).rejects.toMatchObject({ code: "REPORT_AUTHORIZATION_REQUIRED" });
  expect(db.rows(reports)).toHaveLength(0); expect(db.rows(asyncTasks)).toHaveLength(0); expect(m.load).not.toHaveBeenCalled();
});
it("材料报告授权不能被旧上下文改写成正式方案报告", async () => {
  const request = input(); request.solutionAuthorization.reportAuthorization = { ...request.solutionAuthorization.reportAuthorization, reportType: "material_compare" } as any;
  await expect(generateTemplateReport(app, {} as any, actor, request)).rejects.toMatchObject({ code: "REPORT_TYPE_NOT_AUTHORIZED" });
  expect(db.rows(reports)).toHaveLength(0); expect(m.load).not.toHaveBeenCalled();
});
it("并发同快照请求复用同报告与任务，新快照及不同版式可以新建", async () => {
  const [first, second] = await Promise.all([generateTemplateReport(app, {} as any, actor, input()), generateTemplateReport(app, {} as any, actor, input())]);
  expect(first.report.id).toBe(second.report.id); expect(first.taskId).toBe(second.taskId); expect(second.reused).toBe(true);
  expect(db.rows(reports)).toHaveLength(1); expect(db.rows(reportSnapshots)).toHaveLength(1); expect(db.rows(asyncTasks)).toHaveLength(1);
  const stored = db.rows(reportSnapshots)[0]; expect(stored.dataJson.solutionSnapshotId).toBe(confirmedSolutionFixture().id);
  const changed = toSolutionDocumentModel(confirmedSolutionFixture()); changed.solutionSnapshotId = "new-confirmation"; m.load.mockResolvedValue(changed);
  const next = await generateTemplateReport(app, {} as any, actor, input()); expect(next.report.id).not.toBe(first.report.id);
  db.rows(reportTemplates).push({ ...db.rows(reportTemplates)[0], id: "brief", code: "project_brief" });
  const brief = await generateTemplateReport(app, {} as any, actor, { ...input(), reportType: "project_brief" }); expect(brief.report.id).not.toBe(next.report.id);
});
it("READY/FAILED重复请求不自动排队，失败使用受控retry", async () => {
  const created = await generateTemplateReport(app, {} as any, actor, input()); app.queues.reportGeneration.add.mockClear();
  for (const status of ["READY", "FAILED"]) {
    db.rows(reports)[0].status = status;
    const repeat = await generateTemplateReport(app, {} as any, actor, input()); expect(repeat.report.id).toBe(created.report.id); expect(repeat.report.status).toBe(status);
  }
  expect(app.queues.reportGeneration.add).not.toHaveBeenCalled();
  // 独立报告显式关联项目后，不能作为另一次独立报告请求的缓存（访问边界不同）。
  db.rows(reports)[0].projectId = "linked-project";
  const independent = await generateTemplateReport(app, {} as any, actor, input());
  expect(independent.report.id).not.toBe(created.report.id); expect(independent.report.projectId).toBeNull();
});
it("缺模板及审计失败不留下半成品，不篡改发布模板", async () => {
  db.rows(reportTemplates)[0].code = "other";
  await expect(generateTemplateReport(app, {} as any, actor, input())).rejects.toMatchObject({ code: "REPORT_TEMPLATE_NOT_PUBLISHED" });
  db.rows(reportTemplates)[0].code = "standard_report"; m.audit.mockRejectedValueOnce(new Error("审计失败"));
  await expect(generateTemplateReport(app, {} as any, actor, input())).rejects.toThrow("审计失败"); expect(db.rows(reports)).toHaveLength(0); expect(db.rows(asyncTasks)).toHaveLength(0);
});
it("队列投递失败收敛FAILED，保留同一冻结快照供重试", async () => {
  app.queues.reportGeneration.add.mockRejectedValueOnce(new Error("队列不可用"));
  await expect(generateTemplateReport(app, {} as any, actor, input())).rejects.toMatchObject({ code: "REPORT_QUEUE_UNAVAILABLE" });
  expect(db.rows(reports)[0].status).toBe("FAILED"); expect(db.rows(asyncTasks)[0].status).toBe("FAILED");
  expect(db.rows(reportSnapshots)[0].dataJson.solutionSnapshotId).toBe(confirmedSolutionFixture().id);
});
it("并发retry复用同一重试任务，冻结ReportSnapshot不重建", async () => {
  const created = await generateTemplateReport(app, {} as any, actor, input());
  db.rows(reports)[0].status = "FAILED"; const frozen = structuredClone(db.rows(reportSnapshots)[0]); m.load.mockClear();
  const [first, second] = await Promise.all([retryReport(app, {} as any, actor, created.report.id), retryReport(app, {} as any, actor, created.report.id)]);
  expect(first.taskId).toBe(second.taskId); expect(second.reused).toBe(true); expect(db.rows(reportSnapshots)[0]).toEqual(frozen); expect(m.load).not.toHaveBeenCalled();
});
it("报告设置和企业Logo身份在创建时冻结，后台更换不会覆盖已创建报告", async () => {
  db.rows(enterpriseProfiles).push({ id: "company", code: "company_profile", name: "测试企业", logoFileId: "logo", status: "DRAFT" });
  db.rows(files).push({ id: "logo", objectKey: "isolated/brand-v1.png", mimeType: "image/png", status: "READY" });
  db.rows(reportSettings).push({ key: "default", coverTitle: "冻结封面", headerText: "页眉", footerText: "页脚", showCalculationProcess: false,
    showSourceReferences: false, showDisclaimer: false, defaultExportFormat: "DOCX" });
  const created = await generateTemplateReport(app, {} as any, actor, input());
  const snapshot = structuredClone(db.rows(reportSnapshots)[0].dataJson);
  expect(snapshot).toMatchObject({ settings: { coverTitle: "冻结封面", showCalculationProcess: false }, branding: {
    companyName: "测试企业", companyLogoFileId: "logo", logo: { fileId: "logo", objectKey: "isolated/brand-v1.png" } } });
  expect(JSON.stringify(snapshot)).not.toContain("signedUrl");
  db.rows(reportSettings)[0].coverTitle = "新封面"; db.rows(enterpriseProfiles)[0].logoFileId = "new-logo";
  const repeat = await generateTemplateReport(app, {} as any, actor, input());
  expect(repeat.report.id).toBe(created.report.id); expect(db.rows(reportSnapshots)[0].dataJson).toEqual(snapshot);
});

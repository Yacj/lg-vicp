import "dotenv/config";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { beforeEach, expect, it, vi } from "vitest";
import { reportMemoryDb } from "../../../tests/helpers/report-memory-db.js";
import { reportRoutes } from "./reports.routes.js";
import { reports, files, reportArtifacts, projects, asyncTasks, reportSnapshots } from "../../db/schema.js";
import { errorHandlerPlugin } from "../../plugins/error-handler.js";
const audit = vi.hoisted(() => vi.fn());
vi.mock("../audit-logs/audit-log.service.js", () => ({ writeAuditLog: audit }));
const id = "00000000-0000-4000-8000-000000000101";
let db: any, storage: any;
beforeEach(() => {
  vi.clearAllMocks(); db = reportMemoryDb();
  db.rows(reports).push({ id, projectId: null, createdById: "owner", reportType: "technical_scheme", status: "READY", publishedAt: null });
  db.rows(files).push({ id: "pdf-file", status: "READY", deletedAt: null, objectKey: "isolated/report.pdf", originalName: "方案.pdf" });
  db.rows(reportArtifacts).push({ reportId: id, type: "PDF", fileId: "pdf-file" });
  db.rows(reportSnapshots).push({ reportId: id, dataJson: { solutionSnapshotId: "snapshot" } });
  db.rows(asyncTasks).push({ id: "task", businessType: "report", businessId: id, status: "COMPLETED", progress: 100 });
  storage = { createDownloadUrl: vi.fn(async () => "controlled-download"), createPreviewUrl: vi.fn(async () => "controlled-preview") };
});
async function appFor(user: any = { id: "owner", clientType: "C_APP", role: "NORMAL_USER" }) {
  const app = Fastify(); app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
  await app.register(errorHandlerPlugin); app.decorate("db", db); app.decorate("storage", storage);
  app.decorate("queues", { reportGeneration: { add: vi.fn(async (_name, _data, options) => ({ id: options.jobId })) } });
  app.decorate("authenticate", async (request: any) => { request.currentUser = user; });
  await app.register(reportRoutes, { prefix: "/api/v1" }); return app;
}
it("本人可预览/下载未发布PDF，详情返回快照/任务/实际格式，不暴露队列内部payload", async () => {
  const app = await appFor();
  try {
    const detail = (await app.inject(`/api/v1/reports/${id}`)).json();
    expect(detail).toMatchObject({ success: true, data: { solutionSnapshotId: "snapshot", task: { id: "task", status: "COMPLETED" }, availableFormats: ["PDF"] } });
    expect(detail.data.task).not.toHaveProperty("payload");
    for (const mode of ["preview", "download"]) expect((await app.inject(`/api/v1/reports/${id}/artifacts/PDF/${mode}-url`)).json()).toMatchObject({ success: true, data: { url: `controlled-${mode}`, expiresIn: expect.any(Number) } });
    expect(audit).toHaveBeenCalledTimes(2);
  } finally { await app.close(); }
});
it.each(["other-owner", "deleted-file", "recycled-file", "deleted-project"])("%s不泄露预览/下载URL", async kind => {
  let user = { id: "owner", clientType: "C_APP", role: "NORMAL_USER" };
  if (kind === "other-owner") user.id = "other";
  if (kind === "deleted-file") db.rows(files)[0].deletedAt = new Date();
  if (kind === "recycled-file") db.rows(files)[0].status = "RECYCLED";
  if (kind === "deleted-project") db.rows(reports)[0].projectId = "deleted";
  const app = await appFor(user);
  try { expect((await app.inject(`/api/v1/reports/${id}/artifacts/PDF/download-url`)).json()).toMatchObject({ success: false, error: { code: 404 } }); expect(storage.createDownloadUrl).not.toHaveBeenCalled();
    if (kind === "deleted-file" || kind === "recycled-file") expect((await app.inject(`/api/v1/reports/${id}`)).json().data.availableFormats).toEqual([]);
  }
  finally { await app.close(); }
});
it("项目可见用户需已发布，技术方案发布仍需APPROVED", async () => {
  db.rows(reports)[0].projectId = "public-project";
  db.rows(projects).push({ id: "public-project", createdById: "owner", visibility: "PUBLIC", deletedAt: null });
  const viewer = await appFor({ id: "viewer", clientType: "PC_AI", role: "NORMAL_USER" });
  const owner = await appFor();
  try {
    expect((await viewer.inject(`/api/v1/reports/${id}/artifacts/PDF/preview-url`)).json()).toMatchObject({ success: false, error: { code: 404 } });
    expect((await owner.inject({ method: "POST", url: `/api/v1/reports/${id}/publish` })).json()).toMatchObject({ success: false, error: { details: { errorCode: "REPORT_NOT_REVIEWABLE" } } });
    db.rows(reports)[0].status = "APPROVED";
    expect((await owner.inject({ method: "POST", url: `/api/v1/reports/${id}/publish` })).json().success).toBe(true);
    expect((await viewer.inject(`/api/v1/reports/${id}/artifacts/PDF/preview-url`)).json().success).toBe(true);
  } finally { await viewer.close(); await owner.close(); }
});
it("预览拒绝HTML；新建技术方案无本人会话授权不能绕过Snapshot门槛", async () => {
  const app = await appFor();
  try {
    expect((await app.inject(`/api/v1/reports/${id}/artifacts/HTML/preview-url`)).json()).toMatchObject({ success: false, error: { code: 400 } });
    expect((await app.inject({ method: "POST", url: "/api/v1/reports", payload: { reportType: "technical_scheme", contentJson: { final: "fake" } } })).json()).toMatchObject({ success: false, error: { details: { errorCode: "REPORT_AUTHORIZATION_REQUIRED" } } });
  } finally { await app.close(); }
});
it("兼容generate与retry共用并发幂等服务，不留下两条新重试任务", async () => {
  db.rows(reports)[0].status = "FAILED";
  const app = await appFor(); const frozen = structuredClone(db.rows(reportSnapshots)[0]);
  try {
    const responses = await Promise.all(["generate", "retry"].map(action => app.inject({ method: "POST", url: `/api/v1/reports/${id}/${action}` })));
    const first = responses[0]!.json(), second = responses[1]!.json();
    expect(first.success).toBe(true); expect(second.success).toBe(true); expect(first.data.taskId).toBe(second.data.taskId);
    expect(db.rows(asyncTasks)).toHaveLength(2); expect(db.rows(reportSnapshots)[0]).toEqual(frozen);
  } finally { await app.close(); }
});
it("显式projectId/conversationId=null保留独立报告；正式方案无会话仍安全拒绝", async () => {
  const app = await appFor();
  try {
    const plain = await app.inject({ method: "POST", url: "/api/v1/reports", payload: { reportType: "ai_conversation", projectId: null, conversationId: null, contentJson: { title: "独立对话整理" } } });
    expect(plain.json()).toMatchObject({ success: true, data: { report: { projectId: null, reportType: "ai_conversation", status: "QUEUED" } } });
    const formal = await app.inject({ method: "POST", url: "/api/v1/reports", payload: { reportType: "technical_scheme", projectId: null, conversationId: null } });
    expect(formal.json()).toMatchObject({ success: false, error: { details: { errorCode: "REPORT_AUTHORIZATION_REQUIRED" } } });
  } finally { await app.close(); }
});

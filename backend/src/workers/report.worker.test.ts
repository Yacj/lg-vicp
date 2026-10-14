import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
import { reportMemoryDb } from "../../tests/helpers/report-memory-db.js";
import { createReportProcessor } from "./report.worker.js";
import { reconcileTerminalReportFailure, reconcileFailedReportTasks } from "./report-job-state.js";
import { asyncTasks, reports, reportSnapshots, reportArtifacts, files } from "../db/schema.js";
import { confirmedSolutionFixture } from "../modules/ai/solution-report.fixture.js";
import { toSolutionDocumentModel } from "../modules/ai/solution-document-model.js";
const m = vi.hoisted(() => ({ word: vi.fn(), notification: vi.fn() }));
vi.mock("../modules/reports/report-template-render.js", async original => ({ ...await original<any>(), renderTemplateWord: m.word }));
vi.mock("../modules/notifications/notification.service.js", () => ({ createNotification: m.notification }));
let db: any, storage: any, renderPdf: any, job: any;
beforeEach(() => {
  vi.clearAllMocks(); db = reportMemoryDb();
  db.rows(reports).push({ id: "report", projectId: null, createdById: "user", reportType: "technical_scheme", status: "QUEUED", templateVersion: "1" });
  const model = toSolutionDocumentModel(confirmedSolutionFixture());
  db.rows(reportSnapshots).push({ id: "report-snapshot", reportId: "report", dataJson: { title: "Fixture", reportType: "technical_scheme", outputPolicy: "SOLUTION_PDF_V1", solutionSnapshotId: model.solutionSnapshotId, documentModel: model, referencePages: model.referencePages } });
  db.rows(asyncTasks).push({ id: "task", businessId: "report", businessType: "report", status: "QUEUED", payload: { reportId: "report" } });
  storage = { provider: "oss", bucket: "isolated-fixture", putObject: vi.fn(async () => undefined), getObject: vi.fn(async () => { throw new Error("原图不可用"); }) };
  renderPdf = vi.fn(async () => ({ pdf: Buffer.from("%PDF-fixture"), image: undefined }));
  m.word.mockResolvedValue(Buffer.from("word")); m.notification.mockResolvedValue(undefined);
  job = { data: { reportId: "report", taskId: "task" }, attemptsMade: 0, opts: { attempts: 3 }, updateProgress: vi.fn(async () => undefined) };
});
it("正式方案仅需PDF，Word/图片不调用；原图失败保留整表，快照不被修改", async () => {
  m.word.mockRejectedValue(new Error("Word 不可用"));
  const before = structuredClone(db.rows(reportSnapshots)[0].dataJson);
  const result = await createReportProcessor(db, storage, { renderPdf })(job);
  expect(result.status).toBe("READY"); expect(db.rows(reports)[0].status).toBe("READY"); expect(m.word).not.toHaveBeenCalled();
  expect(renderPdf.mock.calls[0][1]).toMatchObject({ image: false, checkChineseFonts: true });
  expect(renderPdf.mock.calls[0][0]).toContain("来源图不可用"); expect(renderPdf.mock.calls[0][0]).toContain("0.1245");
  expect(db.rows(reportArtifacts).map((a: any) => a.type).sort()).toEqual(["HTML", "PDF"]);
  expect(db.rows(files)[0].objectKey).toContain("snapshot-report-snapshot/report.pdf");
  expect(db.rows(reportSnapshots)[0].dataJson).toEqual(before);
});
it("HTML保存失败不阻塞已保存PDF；availableFormats只列实际保存产物", async () => {
  storage.putObject.mockImplementation(async (key: string) => { if (key.endsWith(".html")) throw new Error("不可上传HTML"); });
  await createReportProcessor(db, storage, { renderPdf })(job);
  expect(db.rows(reports)[0].status).toBe("READY"); expect(db.rows(asyncTasks)[0].result.formats).toEqual(["PDF"]);
  expect(db.rows(asyncTasks)[0].result.warnings).toContain("REPORT_HTML_ARTIFACT_UNAVAILABLE：PDF 已保存，HTML 调试产物保存失败。");
});
it.each([true, false])("只加载冻结Logo对象键，失败不阻塞PDF且不改快照：%s", async available => {
  const payload = db.rows(reportSnapshots)[0].dataJson;
  payload.branding = { companyName: "冻结企业", companyLogoFileId: "old-logo", logo: { fileId: "old-logo", objectKey: "isolated/old-logo.png", mimeType: "image/png" } };
  payload.settings = { coverTitle: "设置封面", headerText: "冻结页眉", footerText: "冻结页脚" };
  const before = structuredClone(payload);
  storage.getObject.mockImplementation(async key => key === "isolated/old-logo.png" && available
    ? Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") : null);
  await createReportProcessor(db, storage, { renderPdf })(job);
  expect(renderPdf.mock.calls[0][0]).toContain("冻结企业"); expect(renderPdf.mock.calls[0][0]).toContain("设置封面");
  expect(renderPdf.mock.calls[0][0].includes('alt="企业Logo"')).toBe(available);
  expect(renderPdf.mock.calls[0][1]).toMatchObject({ headerText: "冻结页眉", footerText: "冻结页脚", image: false });
  expect(db.rows(reports)[0].status).toBe("READY"); expect(db.rows(reportSnapshots)[0].dataJson).toEqual(before);
  if (!available) expect(db.rows(asyncTasks)[0].result.warnings).toContain("REPORT_LOGO_UNAVAILABLE：冻结企业Logo不可用，保留封面标题和正文。");
});
it("关闭来源附录不加载原图，基本引用和数值保留", async () => {
  const payload = db.rows(reportSnapshots)[0].dataJson; payload.settings = { showSourceReferences: false };
  payload.referencePages[0].pageImageObjectKey = "isolated/source.png";
  await createReportProcessor(db, storage, { renderPdf })(job);
  expect(storage.getObject).not.toHaveBeenCalled(); expect(renderPdf.mock.calls[0][0]).toContain("资料编号 TEST-ATLAS");
  expect(renderPdf.mock.calls[0][0]).toContain("0.1245"); expect(renderPdf.mock.calls[0][0]).not.toContain('class="source-page"');
});
it("OSS失败中间attempt保持GENERATING，最后失败收敛并保留同一报告快照", async () => {
  storage.putObject.mockRejectedValue(new Error("storage-url-with-credentials-must-not-leak"));
  const processor = createReportProcessor(db, storage, { renderPdf });
  await expect(processor(job)).rejects.toMatchObject({ code: "REPORT_STORAGE_WRITE_FAILED" });
  expect(db.rows(reports)[0].status).toBe("GENERATING"); expect(m.notification).not.toHaveBeenCalled();
  job.attemptsMade = 2; m.notification.mockRejectedValueOnce(new Error("通知失败"));
  await expect(processor(job)).rejects.toMatchObject({ code: "REPORT_STORAGE_WRITE_FAILED" });
  expect(db.rows(reports)[0].status).toBe("FAILED"); expect(db.rows(asyncTasks)[0].status).toBe("FAILED");
  expect(db.rows(reports)[0].errorMessage).not.toContain("credentials"); expect(db.rows(reportSnapshots)).toHaveLength(1);
});
it.each(["CANCELLED", "READY", "PENDING_REVIEW", "APPROVED", "REJECTED"])("重复投递不改变%s或覆盖文件", async status => {
  db.rows(reports)[0].status = status;
  expect(await createReportProcessor(db, storage, { renderPdf })(job)).toMatchObject({ skipped: true, status });
  expect(db.rows(reports)[0].status).toBe(status); expect(renderPdf).not.toHaveBeenCalled(); expect(storage.putObject).not.toHaveBeenCalled();
});
it("较旧attempt在重投递完成后恢复，不能覆盖文件或READY状态", async () => {
  let started!: () => void, resume!: (value: any) => void;
  const entered = new Promise<void>(r => { started = r; });
  const delayed = new Promise(r => { resume = r; });
  renderPdf.mockImplementationOnce(() => { started(); return delayed; });
  const processor = createReportProcessor(db, storage, { renderPdf });
  const first = processor(job); await entered;
  expect(await processor({ ...job, attemptsMade: 1 })).toMatchObject({ status: "READY" });
  resume({ pdf: Buffer.from("old-attempt") });
  expect(await first).toMatchObject({ skipped: true, reason: "SUPERSEDED" });
  expect(storage.putObject.mock.calls.filter((c: any) => c[0].endsWith(".pdf"))).toHaveLength(1); expect(db.rows(reports)[0].status).toBe("READY");
});
it.each(["CANCELLED", "DELETED"])("渲染期间%s也结束当前任务，不写文件、不覆盖新任务", async reason => {
  renderPdf.mockImplementation(async () => {
    if (reason === "DELETED") db.rows(reports)[0].deletedAt = new Date(); else db.rows(reports)[0].status = "CANCELLED";
    return { pdf: Buffer.from("pdf") };
  });
  expect(await createReportProcessor(db, storage, { renderPdf })(job)).toMatchObject({ skipped: true });
  expect(db.rows(asyncTasks)[0]).toMatchObject({ status: "COMPLETED", result: { skipped: true, reason } });
  expect(storage.putObject).not.toHaveBeenCalled();
});
it.each(["material_compare", "ai_conversation", "TEMPLATE"])("旧%s保留HTML/Word/PDF/IMAGE", async reportType => {
  const report = db.rows(reports)[0]; report.reportType = reportType;
  db.rows(reportSnapshots).splice(0); report.contentJson = { title: "旧报告", content: "保留旧格式" };
  renderPdf.mockResolvedValue({ pdf: Buffer.from("pdf"), image: Buffer.from("png") });
  await createReportProcessor(db, storage, { renderPdf })(job);
  expect(renderPdf.mock.calls[0][1].image).toBe(true);
  expect(db.rows(reportArtifacts).map((a: any) => a.type).sort()).toEqual(["HTML", "IMAGE", "PDF", "WORD"]);
});
it("历史technical_scheme DocumentModel V1仍保留四种输出，Final合同字段兼容不读数据库重建", async () => {
  const payload = db.rows(reportSnapshots)[0].dataJson;
  delete payload.outputPolicy; delete payload.documentModel.finalCandidateIds; delete payload.documentModel.selectedCandidateIds;
  renderPdf.mockResolvedValue({ pdf: Buffer.from("pdf"), image: Buffer.from("png") });
  await createReportProcessor(db, storage, { renderPdf })(job);
  expect(m.word).toHaveBeenCalledOnce(); expect(db.rows(reportArtifacts).map((a: any) => a.type).sort()).toEqual(["HTML", "IMAGE", "PDF", "WORD"]);
});
it("Bull最终failed事件补偿领取前/进程中断，不能覆盖READY或新的任务", async () => {
  const failed = { ...job, attemptsMade: 3 };
  expect(await reconcileTerminalReportFailure(db, { ...job, attemptsMade: 1 }, new Error("失败"))).toBe(false);
  expect(await reconcileTerminalReportFailure(db, failed, new Error("失败"))).toBe(true);
  expect(db.rows(reports)[0].status).toBe("FAILED");
  db.rows(reports)[0].status = "READY";
  expect(await reconcileTerminalReportFailure(db, failed, new Error("失败"))).toBe(false);
  db.rows(reports)[0].status = "QUEUED"; db.rows(asyncTasks).push({ ...db.rows(asyncTasks)[0], id: "new-task" });
  expect(await reconcileTerminalReportFailure(db, failed, new Error("旧任务失败"))).toBe(false);
});
it("重启后以队列FAILED事实恢复状态，缺失job不能猜测失败或重建快照", async () => {
  db.rows(asyncTasks)[0].queueName = "report-generation";
  const getJob = vi.fn(async () => ({ ...job, attemptsMade: 1, failedReason: "提前不可恢复失败", getState: async () => "failed" }));
  expect(await reconcileFailedReportTasks(db, { getJob } as any)).toBe(1); expect(db.rows(reports)[0].status).toBe("FAILED");
  db.rows(reports)[0].status = "GENERATING"; getJob.mockResolvedValueOnce(undefined as any);
  expect(await reconcileFailedReportTasks(db, { getJob } as any)).toBe(0); expect(db.rows(reports)[0].status).toBe("GENERATING");
});

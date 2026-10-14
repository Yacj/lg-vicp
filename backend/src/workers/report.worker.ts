import type { Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { and, desc, eq, isNull } from "drizzle-orm";
import { env } from "../config/env.js";
import type { Database } from "../db/client.js";
import { asyncTasks, auditLogs, files, reportArtifacts, reportSnapshots, reports } from "../db/schema.js";
import type { ObjectStorage } from "../storage/index.js";
import {
  embedReferencePageImages,
  embedReportBranding,
  renderTemplateHtml,
  renderTemplateWord,
  type ReportSnapshotPayload
} from "../modules/reports/report-template-render.js";
import { createNotification } from "../modules/notifications/notification.service.js";
import { reportListTitle } from "../modules/reports/report-access.js";
import { isTerminalReportAttempt } from "./report-job-state.js";
import { renderReportPdf, type ReportPdfOptions } from "./report-pdf.js";
import { AppError } from "../shared/errors.js";

interface ReportJobData {
  taskId: string;
  reportId: string;
}
class ReportAttemptSuperseded extends Error {}
async function finishStoppedAttempt(db: Database, reportId: string, taskId: string, generationToken: string) {
  await db.transaction(async tx => {
    const [report] = await tx.select().from(reports).where(eq(reports.id, reportId)).for("update");
    const [task] = await tx.select().from(asyncTasks).where(eq(asyncTasks.id, taskId)).for("update");
    if (!report || task?.payload?.generationToken !== generationToken || !report.deletedAt && report.status !== "CANCELLED") return;
    await tx.update(asyncTasks).set({ status: "COMPLETED", progress: 100, finishedAt: new Date(), updatedAt: new Date(),
      result: { reportId, skipped: true, reason: report.deletedAt ? "DELETED" : "CANCELLED" } }).where(eq(asyncTasks.id, taskId));
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]!);
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return `<ul>${value.map((item) => `<li>${renderValue(item)}</li>`).join("")}</ul>`;
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `<section><h2>${escapeHtml(key)}</h2>${renderValue(item)}</section>`).join("");
  }
  return `<p>${escapeHtml(String(value))}</p>`;
}

function createReportHtml(title: string, content: Record<string, unknown>): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  body{font-family:"Microsoft YaHei",sans-serif;color:#1f2937;margin:48px;line-height:1.7}
  h1{font-size:28px;border-bottom:2px solid #176b57;padding-bottom:12px}h2{font-size:20px;margin-top:28px}
  p,li{font-size:14px}footer{margin-top:48px;color:#6b7280;font-size:12px}
  </style></head><body><h1>${escapeHtml(title)}</h1>${renderValue(content)}
  <footer>由蓝格 VICP 建筑节能 AI 智配系统生成，工程结论应由专业人员复核。</footer></body></html>`;
}

async function createWord(title: string, content: Record<string, unknown>): Promise<Buffer> {
  const paragraphs = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    ...Object.entries(content).flatMap(([key, value]) => [
      new Paragraph({ text: key, heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun(typeof value === "string" ? value : JSON.stringify(value, null, 2))] })
    ]),
    new Paragraph({ text: "由蓝格 VICP 建筑节能 AI 智配系统生成，工程结论应由专业人员复核。" })
  ];
  return Packer.toBuffer(new Document({ sections: [{ children: paragraphs }] }));
}

export function createReportProcessor(db: Database, storage: ObjectStorage, options: { renderPdf?: typeof renderReportPdf; executablePath?: string } = {}) {
  return async (job: Job<ReportJobData>) => {
    const { taskId, reportId } = job.data;
    const generationToken = randomUUID();
    let claimed = false;
    try {
      const claim = await db.transaction(async tx => {
        const [report] = await tx.select().from(reports).where(eq(reports.id, reportId)).for("update");
        const [task] = await tx.select().from(asyncTasks).where(eq(asyncTasks.id, taskId)).for("update");
        if (!report || !task || task.businessId !== reportId || task.businessType !== "report")
          throw new AppError("REPORT_TASK_INVALID", "报告或任务记录不存在或不一致。", 500);
        const [latestTask] = await tx.select().from(asyncTasks).where(and(eq(asyncTasks.businessType, "report"), eq(asyncTasks.businessId, reportId)))
          .orderBy(desc(asyncTasks.createdAt)).limit(1);
        if (latestTask?.id !== taskId || report.deletedAt || report.publishedAt || !["QUEUED", "GENERATING"].includes(report.status)) {
          await tx.update(asyncTasks).set({ status: "COMPLETED", progress: 100,
            result: { ...task.result, reportId, skipped: true, reason: report.deletedAt ? "DELETED" : report.status },
            finishedAt: new Date(), updatedAt: new Date() }).where(eq(asyncTasks.id, taskId));
          return { report, skipped: true };
        }
        await tx.update(asyncTasks).set({ status: "ACTIVE", startedAt: new Date(), progress: 5,
          payload: { ...task.payload, generationToken }, attempts: job.attemptsMade + 1, errorMessage: null, updatedAt: new Date() }).where(eq(asyncTasks.id, taskId));
        await tx.update(reports).set({ status: "GENERATING", errorMessage: null, updatedAt: new Date() }).where(eq(reports.id, reportId));
        return { report, skipped: false };
      });
      const report = claim.report;
      if (claim.skipped) return { reportId, status: report.status, skipped: true };
      claimed = true;
      const assertAttemptOwner = async (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => {
        const [current] = await tx.select().from(reports).where(eq(reports.id, reportId)).for("update");
        const [task] = await tx.select().from(asyncTasks).where(eq(asyncTasks.id, taskId)).for("update");
        const [latestTask] = await tx.select().from(asyncTasks).where(and(eq(asyncTasks.businessType, "report"), eq(asyncTasks.businessId, reportId)))
          .orderBy(desc(asyncTasks.createdAt)).limit(1);
        if (!current || current.status !== "GENERATING" || current.deletedAt || current.publishedAt || latestTask?.id !== taskId || task?.payload?.generationToken !== generationToken)
          throw new ReportAttemptSuperseded();
      };

      // 有快照则走内部模板渲染（含历史 TEMPLATE 与预置 reportType）；否则走 AI 会话 contentJson。
      let html: string;
      let word: Buffer | undefined;
      let title: string;
      let pdfOptions: Partial<ReportPdfOptions> = {};
      let formal = false;
      const sourceWarnings: string[] = [];
      const [snapshot] = await db.select().from(reportSnapshots)
        .where(eq(reportSnapshots.reportId, reportId)).limit(1);
      if (snapshot) {
        const payload = structuredClone(snapshot.dataJson) as ReportSnapshotPayload;
        formal = payload.outputPolicy === "SOLUTION_PDF_V1" && Boolean(payload.documentModel && payload.solutionSnapshotId)
          && (report.reportType === "technical_scheme" || report.reportType === "project_brief");
        await embedReportBranding(payload, async key => {
          try { return await storage.getObject(key); } catch { return null; }
        });
        if (payload.branding?.logoUnavailable) sourceWarnings.push("REPORT_LOGO_UNAVAILABLE：冻结企业Logo不可用，保留封面标题和正文。");
        const hideAppendix = formal && (payload.settings?.showSourceReferences === false
          || payload.template?.sections?.some(s => s.key === "sources" && !s.enabled));
        payload.referencePages = hideAppendix ? [] : await embedReferencePageImages(payload.referencePages, async (objectKey) => {
          try {
            return await storage.getObject(objectKey);
          } catch {
            return null;
          }
        });
        for (const page of payload.referencePages as Record<string, unknown>[]) if (page?.imageUnavailable)
          sourceWarnings.push(`REPORT_SOURCE_IMAGE_UNAVAILABLE：来源页 ${String(page.sourcePageId ?? page.pageId ?? "未提供")} 图片不可用，保留冻结表格。`);
        title = payload.title ?? "VICP 项目报告";
        html = renderTemplateHtml(payload);
        if (!formal) word = await renderTemplateWord(payload);
        pdfOptions = { image: !formal, checkChineseFonts: formal,
          headerText: payload.settings?.headerText ?? undefined, footerText: payload.settings?.footerText ?? undefined };
      } else {
        const content = report.contentJson ?? {};
        title = reportListTitle(report);
        html = createReportHtml(title, content);
        word = await createWord(title, content);
        pdfOptions.image = true;
      }
      await job.updateProgress(30);

      const { pdf, image } = await (options.renderPdf ?? renderReportPdf)(html, {
        ...pdfOptions, executablePath: options.executablePath ?? env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
      await job.updateProgress(65);

      const artifacts = [
        { type: "PDF" as const, extension: "pdf", mime: "application/pdf", data: pdf },
        { type: "HTML" as const, extension: "html", mime: "text/html; charset=utf-8", data: Buffer.from(html) },
        ...(word ? [{ type: "WORD" as const, extension: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: word }] : []),
        ...(image ? [{ type: "IMAGE" as const, extension: "png", mime: "image/png", data: image }] : [])
      ];

      const savedFormats: string[] = [];
      const warnings: string[] = [...sourceWarnings];
      for (const artifact of artifacts) {
        const objectKey = `reports/${report.projectId ?? "unassigned"}/${report.id}/v${report.templateVersion}/${formal ? `snapshot-${snapshot!.id}/` : ""}report.${artifact.extension}`;
        try {
        await db.transaction(async (tx) => {
          await assertAttemptOwner(tx);
          try { await storage.putObject(objectKey, artifact.data, artifact.mime); }
          catch { throw new AppError("REPORT_STORAGE_WRITE_FAILED", "报告文件写入对象存储失败，请检查存储权限及连接。", 500); }
          const [file] = await tx.insert(files).values({
            projectId: report.projectId,
            ownerUserId: report.createdById,
            storageProvider: storage.provider,
            bucket: storage.bucket,
            objectKey,
            originalName: `${title}.${artifact.extension}`,
            mimeType: artifact.mime,
            sizeBytes: artifact.data.length,
            status: "READY"
          }).onConflictDoUpdate({
            target: [files.bucket, files.objectKey],
            set: { sizeBytes: artifact.data.length, mimeType: artifact.mime, status: "READY", updatedAt: new Date() }
          }).returning();
          await tx.insert(reportArtifacts).values({ reportId: report.id, type: artifact.type, fileId: file!.id })
            .onConflictDoUpdate({
              target: [reportArtifacts.reportId, reportArtifacts.type],
              set: { fileId: file!.id }
            });
        });
        savedFormats.push(artifact.type);
        } catch (error) {
          if (error instanceof ReportAttemptSuperseded || !formal || artifact.type === "PDF") throw error;
          warnings.push("REPORT_HTML_ARTIFACT_UNAVAILABLE：PDF 已保存，HTML 调试产物保存失败。");
        }
      }

      await db.transaction(async (tx) => {
        await assertAttemptOwner(tx);
        await tx.update(reports).set({ status: "READY", errorMessage: null, updatedAt: new Date() }).where(eq(reports.id, report.id));
        await tx.update(asyncTasks).set({
          status: "COMPLETED", progress: 100,
          result: { reportId: report.id, formats: savedFormats, warnings }, errorMessage: null,
          finishedAt: new Date(), updatedAt: new Date()
        }).where(eq(asyncTasks.id, taskId));
        await tx.insert(auditLogs).values({
          actorUserId: report.createdById,
          projectId: report.projectId,
          action: "report.generated",
          targetType: "report",
          targetId: report.id,
          afterJson: { formats: savedFormats, warnings, taskId }
        });
      });
      // 数据库已完成时，Redis进度异常不能把READY反写FAILED；Bull重投递会按状态跳过。
      await job.updateProgress(100).catch(() => undefined);
      return { reportId: report.id, status: "READY" };
    } catch (error) {
      if (error instanceof ReportAttemptSuperseded) {
        await finishStoppedAttempt(db, reportId, taskId, generationToken);
        return { reportId, skipped: true, reason: "SUPERSEDED" };
      }
      const errorCode = error instanceof AppError ? error.code : "REPORT_GENERATION_FAILED";
      const message = `${errorCode}：${error instanceof AppError ? error.message : "报告生成失败，请根据任务编号检查服务状态。"}`;
      const terminal = isTerminalReportAttempt(job);
      const failedReport = claimed ? await db.transaction(async tx => {
        const [current] = await tx.select().from(reports).where(and(eq(reports.id, reportId), isNull(reports.deletedAt))).for("update");
        const [task] = await tx.select().from(asyncTasks).where(eq(asyncTasks.id, taskId)).for("update");
        const [latestTask] = await tx.select().from(asyncTasks).where(and(eq(asyncTasks.businessType, "report"), eq(asyncTasks.businessId, reportId)))
          .orderBy(desc(asyncTasks.createdAt)).limit(1);
        if (!current || current.status !== "GENERATING" || latestTask?.id !== taskId || task?.payload?.generationToken !== generationToken) return null;
        await tx.update(asyncTasks).set({ errorMessage: message, attempts: job.attemptsMade + 1, updatedAt: new Date(),
          ...(terminal ? { status: "FAILED" as const, finishedAt: new Date() } : {}) }).where(eq(asyncTasks.id, taskId));
        if (!terminal) return undefined;
        await tx.update(reports).set({ status: "FAILED", errorMessage: message, updatedAt: new Date() }).where(eq(reports.id, reportId));
        await tx.insert(auditLogs).values({
          actorUserId: current.createdById,
          projectId: current.projectId,
          action: "report.failed",
          targetType: "report",
          targetId: reportId,
          afterJson: { errorCode, errorMessage: message, taskId }
        });
        return current;
      }) : null;
      if (claimed && failedReport === null) {
        await finishStoppedAttempt(db, reportId, taskId, generationToken);
        return { reportId, skipped: true, reason: "SUPERSEDED" };
      }
      if (failedReport) {
        // 提醒闭环：报告生成失败生成 B 端通知（尽力写入，失败不阻塞失败状态收敛）
        await createNotification({ db }, {
          type: "REPORT_GENERATION_FAILED",
          title: "报告生成失败",
          content: message,
          targetType: "report",
          targetId: reportId,
          projectId: failedReport.projectId,
          createdById: failedReport.createdById
        }).catch(() => console.warn("报告失败通知未送达", { reportId, taskId, errorCode: "REPORT_NOTIFICATION_FAILED" }));
      }
      throw error;
    }
  };
}

import type { Job } from "bullmq";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { eq } from "drizzle-orm";
import { chromium } from "playwright-core";
import { env } from "../config/env.js";
import type { Database } from "../db/client.js";
import { asyncTasks, auditLogs, files, reportArtifacts, reports } from "../db/schema.js";
import type { ObjectStorage } from "../storage/index.js";

interface ReportJobData {
  taskId: string;
  reportId: string;
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

export function createReportProcessor(db: Database, storage: ObjectStorage) {
  return async (job: Job<ReportJobData>) => {
    const { taskId, reportId } = job.data;
    await db.update(asyncTasks).set({ status: "ACTIVE", startedAt: new Date(), progress: 5, attempts: job.attemptsMade + 1, updatedAt: new Date() })
      .where(eq(asyncTasks.id, taskId));
    await db.update(reports).set({ status: "GENERATING", errorMessage: null, updatedAt: new Date() }).where(eq(reports.id, reportId));

    try {
      const [report] = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
      if (!report) throw new Error("待生成报告不存在");
      const content = report.contentJson ?? {};
      const title = report.reportType === "energy_design" ? "建筑节能设计报告" : report.reportType === "design_note" ? "VICP 设计说明" : "VICP 项目说明";
      const html = createReportHtml(title, content);
      const word = await createWord(title, content);
      await job.updateProgress(30);

      if (!env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
        throw new Error("未配置 Chromium 路径，无法生成 PDF 和图片报告");
      }
      const browser = await chromium.launch({ executablePath: env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, headless: true });
      let pdf: Buffer;
      let image: Buffer;
      try {
        const page = await browser.newPage({ viewport: { width: 1240, height: 1754 } });
        await page.setContent(html, { waitUntil: "load" });
        pdf = await page.pdf({ format: "A4", printBackground: true });
        image = await page.screenshot({ fullPage: true, type: "png" });
      } finally {
        await browser.close();
      }
      await job.updateProgress(65);

      const artifacts = [
        { type: "HTML" as const, extension: "html", mime: "text/html; charset=utf-8", data: Buffer.from(html) },
        { type: "WORD" as const, extension: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", data: word },
        { type: "PDF" as const, extension: "pdf", mime: "application/pdf", data: pdf },
        { type: "IMAGE" as const, extension: "png", mime: "image/png", data: image }
      ];

      for (const artifact of artifacts) {
        const objectKey = `reports/${report.projectId}/${report.id}/v${report.templateVersion}/report.${artifact.extension}`;
        await storage.putObject(objectKey, artifact.data, artifact.mime);
        await db.transaction(async (tx) => {
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
      }

      await db.transaction(async (tx) => {
        await tx.update(reports).set({ status: "READY", errorMessage: null, updatedAt: new Date() }).where(eq(reports.id, report.id));
        await tx.update(asyncTasks).set({
          status: "COMPLETED", progress: 100,
          result: { reportId: report.id, formats: artifacts.map((item) => item.type) },
          finishedAt: new Date(), updatedAt: new Date()
        }).where(eq(asyncTasks.id, taskId));
        await tx.insert(auditLogs).values({
          actorUserId: report.createdById,
          projectId: report.projectId,
          action: "report.generated",
          targetType: "report",
          targetId: report.id,
          afterJson: { formats: artifacts.map((item) => item.type), taskId }
        });
      });
      await job.updateProgress(100);
      return { reportId: report.id, status: "READY" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "报告生成失败";
      await db.update(reports).set({ status: "FAILED", errorMessage: message, updatedAt: new Date() }).where(eq(reports.id, reportId));
      await db.update(asyncTasks).set({
        status: "FAILED", errorMessage: message, attempts: job.attemptsMade + 1,
        finishedAt: new Date(), updatedAt: new Date()
      }).where(eq(asyncTasks.id, taskId));
      const [failedReport] = await db.select({ projectId: reports.projectId, createdById: reports.createdById })
        .from(reports).where(eq(reports.id, reportId)).limit(1);
      if (failedReport) {
        await db.insert(auditLogs).values({
          actorUserId: failedReport.createdById,
          projectId: failedReport.projectId,
          action: "report.failed",
          targetType: "report",
          targetId: reportId,
          afterJson: { errorMessage: message, taskId }
        });
      }
      throw error;
    }
  };
}

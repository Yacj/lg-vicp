import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import mammoth from "mammoth";
import { extractText } from "unpdf";
import type { Database } from "../db/client.js";
import { asyncTasks, files, knowledgeChunks, knowledgeDocuments } from "../db/schema.js";
import type { ObjectStorage } from "../storage/index.js";

interface DocumentJobData {
  taskId: string;
  fileId: string;
}

interface ParsedPage {
  page: number | null;
  text: string;
}

export function splitText(text: string, maxLength = 1200, overlap = 150): string[] {
  const normalized = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];
  const result: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + maxLength, normalized.length);
    if (end < normalized.length) {
      const boundary = Math.max(normalized.lastIndexOf("\n", end), normalized.lastIndexOf("。", end));
      if (boundary > start + Math.floor(maxLength * 0.6)) end = boundary + 1;
    }
    result.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return result.filter(Boolean);
}

async function parseDocument(data: Buffer, mimeType: string): Promise<{ parser: string; pages: ParsedPage[] }> {
  if (mimeType === "application/pdf") {
    const result = await extractText(new Uint8Array(data), { mergePages: false });
    return {
      parser: "unpdf",
      pages: result.text.map((text, index) => ({ page: index + 1, text }))
    };
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer: data });
    return { parser: "mammoth", pages: [{ page: null, text: result.value }] };
  }
  return { parser: "ocr_required", pages: [] };
}

export function createDocumentProcessor(db: Database, storage: ObjectStorage) {
  return async (job: Job<DocumentJobData>) => {
    const { taskId, fileId } = job.data;
    await db.update(asyncTasks).set({ status: "ACTIVE", startedAt: new Date(), attempts: job.attemptsMade + 1, progress: 5, updatedAt: new Date() })
      .where(eq(asyncTasks.id, taskId));
    await db.update(files).set({ status: "PARSING", errorMessage: null, updatedAt: new Date() }).where(eq(files.id, fileId));

    try {
      const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
      if (!file) throw new Error("待解析文件不存在");
      const data = await storage.getObject(file.objectKey);
      const detected = await fileTypeFromBuffer(data);
      const mimeType = detected?.mime ?? file.mimeType;
      if (mimeType !== file.mimeType) {
        await db.update(files).set({ mimeType, updatedAt: new Date() }).where(eq(files.id, file.id));
      }
      await job.updateProgress(20);
      const parsed = await parseDocument(data, mimeType);
      const totalTextLength = parsed.pages.reduce((sum, page) => sum + page.text.trim().length, 0);
      if (parsed.parser === "ocr_required" || totalTextLength < 20) {
        await db.update(files).set({ status: "OCR_REQUIRED", errorMessage: null, updatedAt: new Date() }).where(eq(files.id, file.id));
        await db.update(asyncTasks).set({
          status: "COMPLETED", progress: 100,
          result: { status: "OCR_REQUIRED", message: "文件缺少可提取文本，需要 OCR 处理" },
          finishedAt: new Date(), updatedAt: new Date()
        }).where(eq(asyncTasks.id, taskId));
        return { status: "OCR_REQUIRED" };
      }

      await db.update(files).set({ status: "INDEXING", updatedAt: new Date() }).where(eq(files.id, file.id));
      await job.updateProgress(60);
      await db.transaction(async (tx) => {
        const oldDocuments = await tx.select({ id: knowledgeDocuments.id }).from(knowledgeDocuments)
          .where(eq(knowledgeDocuments.fileId, file.id));
        for (const old of oldDocuments) {
          await tx.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, old.id));
        }
        const [document] = await tx.insert(knowledgeDocuments).values({
          fileId: file.id,
          projectId: file.projectId,
          title: file.originalName,
          version: file.version,
          pageCount: parsed.pages.length,
          parser: parsed.parser
        }).returning();
        const chunkValues = parsed.pages.flatMap((page) => splitText(page.text).map((content) => ({
          documentId: document!.id,
          projectId: file.projectId,
          content,
          sourcePage: page.page
        }))).map((chunk, index) => ({ ...chunk, chunkIndex: index }));
        if (chunkValues.length > 0) await tx.insert(knowledgeChunks).values(chunkValues);
        await tx.update(files).set({ status: "READY", errorMessage: null, updatedAt: new Date() }).where(eq(files.id, file.id));
        await tx.update(asyncTasks).set({
          status: "COMPLETED", progress: 100,
          result: { status: "READY", documentId: document!.id, chunkCount: chunkValues.length },
          finishedAt: new Date(), updatedAt: new Date()
        }).where(eq(asyncTasks.id, taskId));
      });
      await job.updateProgress(100);
      return { status: "READY" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "文档解析失败";
      await db.update(files).set({ status: "FAILED", errorMessage: message, updatedAt: new Date() }).where(eq(files.id, fileId));
      await db.update(asyncTasks).set({
        status: "FAILED", errorMessage: message, attempts: job.attemptsMade + 1,
        finishedAt: new Date(), updatedAt: new Date()
      }).where(eq(asyncTasks.id, taskId));
      throw error;
    }
  };
}

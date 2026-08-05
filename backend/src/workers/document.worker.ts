import type { Job } from "bullmq";
import { eq, inArray } from "drizzle-orm";
import ExcelJS from "exceljs";
import { fileTypeFromBuffer } from "file-type";
import mammoth from "mammoth";
import { extractText } from "unpdf";
import type { Database, DbExecutor } from "../db/client.js";
import {
  asyncTasks,
  files,
  knowledgeAliases,
  knowledgeChunkTerms,
  knowledgeChunks,
  knowledgeCitations,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  knowledgePages,
  parsingJobs
} from "../db/schema.js";
import type { ObjectStorage } from "../storage/index.js";
import {
  buildChunksFromPages,
  buildChunksFromSheet,
  detectHeading,
  extractAnchors,
  splitText,
  type AliasDictEntry,
  type ExtractedChunk,
  type SheetData
} from "../modules/knowledge/knowledge-chunking.js";

// 兼容既有测试与调用方：splitText 由分块纯函数模块提供
export { splitText };

interface DocumentJobData {
  taskId?: string;
  fileId: string;
  parsingJobId?: string;
  versionId?: string;
  /** 知识库链路任务类型；缺省视为 PARSE */
  jobType?: "PARSE" | "REPARSE" | "CHUNK_REBUILD" | "OCR";
}

interface ParsedPage {
  page: number | null;
  text: string;
}

interface ParsedDocument {
  parser: string;
  pages: ParsedPage[];
  /** XLSX 工作表结构化数据（表格分块用），每项对应一个页面（pageNumber = sheet 序号） */
  sheets?: Array<{ data: SheetData; pageNumber: number }>;
}

/** exceljs 工作表 → 纯数据 SheetData（合并单元格取模型字符串范围如 "A1:B2"） */
function parseMergeRange(ref: string): { rowStart: number; colStart: number; rowEnd: number; colEnd: number } {
  const columnIndex = (letters: string): number => {
    let index = 0;
    for (const char of letters.toUpperCase()) index = index * 26 + char.charCodeAt(0) - 64;
    return index;
  };
  const parse = (part: string) => ({
    col: columnIndex(part.replace(/\d+/g, "")),
    row: Number.parseInt(part.replace(/[A-Za-z]/g, ""), 10)
  });
  const [start, end] = ref.split(":").map((part) => part.trim());
  const s = parse(start!);
  const e = parse(end ?? start!);
  return { rowStart: s.row, colStart: s.col, rowEnd: e.row, colEnd: e.col };
}

export function worksheetToSheetData(worksheet: ExcelJS.Worksheet): SheetData {
  const rows: SheetData["rows"] = [];
  worksheet.eachRow((row) => {
    const cells: SheetData["rows"][number] = [];
    row.eachCell({ includeEmpty: false }, (cell) => {
      const value: string = (cell.text ?? "").trim();
      if (value) {
        const col: number = Number(cell.col);
        cells.push({ col, value });
      }
    });
    if (cells.length > 0) rows.push(cells);
  });
  const mergedCells: SheetData["mergedCells"] = [];
  for (const merge of (worksheet.model.merges ?? [])) {
    mergedCells.push(parseMergeRange(merge));
  }
  return { name: worksheet.name, rows, mergedCells };
}

async function parseWorkbook(data: Buffer): Promise<ParsedDocument> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheets: ParsedDocument["sheets"] = [];
  const pages: ParsedPage[] = [];
  workbook.eachSheet((worksheet, index) => {
    const sheetData = worksheetToSheetData(worksheet);
    sheets!.push({ data: sheetData, pageNumber: index + 1 });
    pages.push({
      page: index + 1,
      text: sheetData.rows.map((row) => row.map((cell) => cell.value).join("\t")).join("\n")
    });
  });
  return { parser: "exceljs", pages, sheets };
}

async function parseDocument(data: Buffer, mimeType: string): Promise<ParsedDocument> {
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
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return parseWorkbook(data);
  }
  // 老格式不支持：.doc（二进制 Word）、.xls（BIFF，exceljs 仅支持 XLSX）
  if (mimeType === "application/msword" || mimeType === "application/vnd.ms-excel") {
    return { parser: "unsupported_doc", pages: [] };
  }
  return { parser: "ocr_required", pages: [] };
}

/** 读取启用的别名词典（term, alias），供分块关键词标注使用 */
async function loadActiveAliases(db: Database): Promise<AliasDictEntry[]> {
  const rows = await db.select({ term: knowledgeAliases.term, alias: knowledgeAliases.alias })
    .from(knowledgeAliases).where(eq(knowledgeAliases.enabled, true));
  return rows;
}

/** 页面首个章节标题作为页面章节路径 */
function detectPageSection(text: string): string | null {
  for (const line of text.split("\n")) {
    const heading = detectHeading(line);
    if (heading) return heading.title;
  }
  return null;
}

/** 文本中是否出现表格/图片编号引用 */
function detectPageMarks(text: string): { hasTables: boolean; hasImages: boolean } {
  return {
    hasTables: /表\s*\d+(?:[-.]\s*\d+)*/.test(text),
    hasImages: /图\s*\d+(?:[-.]\s*\d+)*/.test(text)
  };
}

interface WriteParsedInput {
  documentId: string;
  versionId: string;
  projectId: string | null;
  pages: ParsedPage[];
  aliases: AliasDictEntry[];
  evidenceLevel: "A" | "B" | "C" | null;
  /** XLSX 工作表结构化数据：每 sheet 追加为独立 TABLE 分块（保留行列/合并单元格元数据） */
  sheets?: ParsedDocument["sheets"];
}

interface WriteParsedResult {
  pageCount: number;
  chunkCount: number;
}

/**
 * 将解析结果按版本写入：页面 + 分块 + 分块术语 + 引用。
 * 先清空该版本旧内容（版本替代/重新解析场景；历史版本数据不受影响），
 * 文本流中表格区域独立成块；XLSX 每工作表一个页面并按行产出结构化 TABLE 块。
 */
async function writeParsedContent(tx: DbExecutor, input: WriteParsedInput): Promise<WriteParsedResult> {
  const { documentId, versionId, projectId, pages, aliases, evidenceLevel, sheets } = input;

  const oldChunks = await tx.select({ id: knowledgeChunks.id }).from(knowledgeChunks)
    .where(eq(knowledgeChunks.versionId, versionId));
  if (oldChunks.length > 0) {
    const chunkIds = oldChunks.map((chunk) => chunk.id);
    await tx.delete(knowledgeChunkTerms).where(inArray(knowledgeChunkTerms.chunkId, chunkIds));
    await tx.delete(knowledgeCitations).where(inArray(knowledgeCitations.chunkId, chunkIds));
    await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.versionId, versionId));
  }
  await tx.delete(knowledgePages).where(eq(knowledgePages.versionId, versionId));

  const pageValues = pages.map((page) => {
    const marks = detectPageMarks(page.text);
    return {
      documentId,
      versionId,
      pageNumber: page.page ?? 0,
      parsedText: page.text,
      sectionPath: detectPageSection(page.text),
      hasTables: marks.hasTables,
      hasImages: marks.hasImages,
      parseStatus: "PARSED" as const
    };
  });
  if (pageValues.length > 0) await tx.insert(knowledgePages).values(pageValues);

  const chunks: ExtractedChunk[] = [...buildChunksFromPages(pages, aliases)];
  for (const sheet of sheets ?? []) {
    chunks.push(...buildChunksFromSheet(sheet.data, aliases)
      .map((chunk) => ({ ...chunk, sourcePage: sheet.pageNumber, pageEnd: sheet.pageNumber })));
  }
  if (chunks.length === 0) return { pageCount: pages.length, chunkCount: 0 };

  const chunkValues = chunks.map((chunk: ExtractedChunk, index: number) => ({
    documentId,
    versionId,
    projectId,
    chunkIndex: index,
    content: chunk.content,
    sourcePage: chunk.sourcePage,
    pageEnd: chunk.pageEnd,
    sourceSection: chunk.sourceSection,
    headingLevel: chunk.headingLevel,
    contentType: chunk.contentType,
    searchText: chunk.searchText,
    keywords: chunk.keywords,
    aliasTerms: chunk.aliasTerms,
    citationAnchor: chunk.citationAnchor,
    metadata: chunk.metadata ?? null,
    sortWeight: 0
  }));
  const inserted = await tx.insert(knowledgeChunks).values(chunkValues).returning({ id: knowledgeChunks.id });

  const termValues = chunks.flatMap((chunk, index) => [
    ...chunk.keywords.map((term) => ({ chunkId: inserted[index]!.id, term, termType: "KEYWORD" as const, weight: 0 })),
    ...chunk.aliasTerms.map((term) => ({ chunkId: inserted[index]!.id, term, termType: "SYNONYM" as const, weight: 0 }))
  ]);
  if (termValues.length > 0) await tx.insert(knowledgeChunkTerms).values(termValues);

  const citationValues = chunks.flatMap((chunk, index) => {
    const anchors = extractAnchors(chunk.content);
    return anchors.slice(0, 3).map((anchor) => ({
      chunkId: inserted[index]!.id,
      documentId,
      versionId,
      sourceType: "OTHER" as const,
      pageNumber: chunk.sourcePage,
      clauseNo: /^第\s*\d+(?:\.\d+)*\s*条$/.test(anchor) ? anchor : null,
      evidenceLevel,
      note: /^第\s*\d+(?:\.\d+)*\s*条$/.test(anchor) ? null : anchor
    }));
  });
  if (citationValues.length > 0) await tx.insert(knowledgeCitations).values(citationValues);

  return { pageCount: pages.length, chunkCount: chunks.length };
}

/** 知识库链路解析任务：PARSE / REPARSE（重新读取 OSS 文件解析并重写页面与分块） */
async function handleParseJob(
  db: Database,
  storage: ObjectStorage,
  job: Job<DocumentJobData>,
  parsingJobId: string,
  fileId: string,
  versionId: string
): Promise<Record<string, unknown>> {
  await db.update(parsingJobs).set({
    status: "ACTIVE", startedAt: new Date(), attempts: job.attemptsMade + 1, progress: 5, updatedAt: new Date()
  }).where(eq(parsingJobs.id, parsingJobId));
  await db.update(knowledgeDocumentVersions).set({ parseStatus: "PARSING", pipelineStatus: "PARSING", updatedAt: new Date() })
    .where(eq(knowledgeDocumentVersions.id, versionId));

  try {
    const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
    if (!file) throw new Error("待解析文件不存在");
    await db.update(files).set({ status: "PARSING", errorMessage: null, updatedAt: new Date() }).where(eq(files.id, fileId));
    const data = await storage.getObject(file.objectKey);
    const detected = await fileTypeFromBuffer(data);
    const mimeType = detected?.mime ?? file.mimeType;
    if (mimeType !== file.mimeType) {
      await db.update(files).set({ mimeType, updatedAt: new Date() }).where(eq(files.id, file.id));
    }
    await job.updateProgress(20);
    const parsed = await parseDocument(data, mimeType);
    const totalTextLength = parsed.pages.reduce((sum, page) => sum + page.text.trim().length, 0);
    // OCR/格式不支持判定：老格式（.doc/.xls）与纯图片显式标记；文本过短阈值仅对文本型格式生效，
    // 电子表格内容少是正常现象（表格块按行落库），只有整簿无内容才需要 OCR。
    const needsOcr = parsed.parser === "ocr_required" || parsed.parser === "unsupported_doc" ||
      ((parsed.parser === "unpdf" || parsed.parser === "mammoth") && totalTextLength < 20) ||
      (parsed.parser === "exceljs" && parsed.pages.every((page) => !page.text.trim()));
    if (needsOcr) {
      const reason = parsed.parser === "unsupported_doc"
        ? "该文件格式暂不支持（.doc/.xls 老格式，请转换后重传）"
        : "文件缺少可提取文本，需要 OCR 处理";
      await db.update(files).set({ status: "OCR_REQUIRED", errorMessage: reason, updatedAt: new Date() }).where(eq(files.id, file.id));
      await db.update(knowledgeDocumentVersions).set({ parseStatus: "OCR_REQUIRED", pipelineStatus: "FAILED", updatedAt: new Date() })
        .where(eq(knowledgeDocumentVersions.id, versionId));
      await db.update(parsingJobs).set({
        status: "OCR_REQUIRED", progress: 100,
        result: { status: "OCR_REQUIRED", message: reason },
        finishedAt: new Date(), updatedAt: new Date()
      }).where(eq(parsingJobs.id, parsingJobId));
      return { status: "OCR_REQUIRED" };
    }

    await db.update(knowledgeDocumentVersions).set({ pipelineStatus: "CHUNKING", updatedAt: new Date() })
      .where(eq(knowledgeDocumentVersions.id, versionId));
    await job.updateProgress(60);
    const [version] = await db.select().from(knowledgeDocumentVersions).where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
    if (!version) throw new Error("文档版本不存在");
    const [document] = await db.select({ projectId: knowledgeDocuments.projectId }).from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, version.documentId)).limit(1);
    const aliases = await loadActiveAliases(db);
    const result = await db.transaction(async (tx) => {
      const written = await writeParsedContent(tx, {
        documentId: version.documentId,
        versionId,
        projectId: document?.projectId ?? null,
        pages: parsed.pages,
        aliases,
        evidenceLevel: version.evidenceLevel,
        sheets: parsed.sheets
      });
      // 解析管线完成：内容就绪待人工审核（审核通过后 publish 时置 PUBLISHED）
      await tx.update(knowledgeDocumentVersions).set({
        parseStatus: "PARSED", pipelineStatus: "REVIEW_PENDING", pageCount: written.pageCount, parser: parsed.parser, updatedAt: new Date()
      }).where(eq(knowledgeDocumentVersions.id, versionId));
      await tx.update(files).set({ status: "READY", errorMessage: null, updatedAt: new Date() }).where(eq(files.id, fileId));
      return written;
    });
    await db.update(parsingJobs).set({
      status: "COMPLETED", progress: 100,
      result: { status: "READY", versionId, pageCount: result.pageCount, chunkCount: result.chunkCount, parser: parsed.parser },
      finishedAt: new Date(), updatedAt: new Date()
    }).where(eq(parsingJobs.id, parsingJobId));
    await job.updateProgress(100);
    return { status: "READY" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "文档解析失败";
    await db.update(files).set({ status: "FAILED", errorMessage: message, updatedAt: new Date() }).where(eq(files.id, fileId));
    await db.update(knowledgeDocumentVersions).set({ parseStatus: "FAILED", pipelineStatus: "FAILED", updatedAt: new Date() })
      .where(eq(knowledgeDocumentVersions.id, versionId));
    await db.update(parsingJobs).set({
      status: "FAILED", errorMessage: message, attempts: job.attemptsMade + 1,
      finishedAt: new Date(), updatedAt: new Date()
    }).where(eq(parsingJobs.id, parsingJobId));
    throw error;
  }
}

/** 知识库链路切片重建：只读取该版本页面原文重新切块，不重新解析文件 */
async function handleChunkRebuild(
  db: Database,
  job: Job<DocumentJobData>,
  parsingJobId: string,
  versionId: string
): Promise<Record<string, unknown>> {
  await db.update(parsingJobs).set({
    status: "ACTIVE", startedAt: new Date(), attempts: job.attemptsMade + 1, progress: 5, updatedAt: new Date()
  }).where(eq(parsingJobs.id, parsingJobId));
  await db.update(knowledgeDocumentVersions).set({ pipelineStatus: "CHUNKING", updatedAt: new Date() })
    .where(eq(knowledgeDocumentVersions.id, versionId));

  try {
    const [version] = await db.select().from(knowledgeDocumentVersions).where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
    if (!version) throw new Error("文档版本不存在");
    const pageRows = await db.select().from(knowledgePages).where(eq(knowledgePages.versionId, versionId)).orderBy(knowledgePages.pageNumber);
    if (pageRows.length === 0) throw new Error("该版本缺少页面数据，无法重建分块，请先执行解析");
    const [document] = await db.select({ projectId: knowledgeDocuments.projectId }).from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, version.documentId)).limit(1);
    const aliases = await loadActiveAliases(db);
    const result = await db.transaction(async (tx) => {
      const written = await writeParsedContent(tx, {
        documentId: version.documentId,
        versionId,
        projectId: document?.projectId ?? null,
        pages: pageRows.map((page) => ({ page: page.pageNumber, text: page.parsedText ?? "" })),
        aliases,
        evidenceLevel: version.evidenceLevel
      });
      await tx.update(knowledgeDocumentVersions).set({ pipelineStatus: "REVIEW_PENDING", updatedAt: new Date() })
        .where(eq(knowledgeDocumentVersions.id, versionId));
      return written;
    });
    await db.update(parsingJobs).set({
      status: "COMPLETED", progress: 100,
      result: { status: "READY", versionId, pageCount: result.pageCount, chunkCount: result.chunkCount, mode: "CHUNK_REBUILD" },
      finishedAt: new Date(), updatedAt: new Date()
    }).where(eq(parsingJobs.id, parsingJobId));
    return { status: "READY" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "分块重建失败";
    await db.update(parsingJobs).set({
      status: "FAILED", errorMessage: message, attempts: job.attemptsMade + 1,
      finishedAt: new Date(), updatedAt: new Date()
    }).where(eq(parsingJobs.id, parsingJobId));
    throw error;
  }
}

/**
 * 既有文件链路任务（async_tasks + files）：行为与迁移前保持一致，
 * 但解析结果按新模型落库（自动创建 PUBLISHED v1 版本并回填版本/页面/分块）。
 */
async function handleLegacyJob(
  db: Database,
  storage: ObjectStorage,
  job: Job<DocumentJobData>,
  taskId: string,
  fileId: string
): Promise<Record<string, unknown>> {
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
    const aliases = await loadActiveAliases(db);
    const result = await db.transaction(async (tx) => {
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
      const [version] = await tx.insert(knowledgeDocumentVersions).values({
        documentId: document!.id,
        version: file.version,
        fileId: file.id,
        title: file.originalName,
        status: "PUBLISHED",
        pipelineStatus: "PUBLISHED",
        parseStatus: "PARSED",
        pageCount: parsed.pages.length,
        parser: parsed.parser,
        publishedAt: new Date()
      }).returning();
      await tx.update(knowledgeDocuments).set({ currentVersionId: version!.id, updatedAt: new Date() })
        .where(eq(knowledgeDocuments.id, document!.id));
      const written = await writeParsedContent(tx, {
        documentId: document!.id,
        versionId: version!.id,
        projectId: file.projectId,
        pages: parsed.pages,
        aliases,
        evidenceLevel: null
      });
      await tx.update(files).set({ status: "READY", errorMessage: null, updatedAt: new Date() }).where(eq(files.id, file.id));
      await tx.update(asyncTasks).set({
        status: "COMPLETED", progress: 100,
        result: { status: "READY", documentId: document!.id, versionId: version!.id, chunkCount: written.chunkCount },
        finishedAt: new Date(), updatedAt: new Date()
      }).where(eq(asyncTasks.id, taskId));
      return written;
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
}

export function createDocumentProcessor(db: Database, storage: ObjectStorage) {
  return async (job: Job<DocumentJobData>): Promise<Record<string, unknown>> => {
    const { taskId, fileId, parsingJobId, versionId, jobType } = job.data;
    if (!parsingJobId || !versionId) {
      if (!taskId) throw new Error("任务缺少 taskId");
      return handleLegacyJob(db, storage, job, taskId, fileId);
    }
    if (jobType === "CHUNK_REBUILD") {
      return handleChunkRebuild(db, job, parsingJobId, versionId);
    }
    return handleParseJob(db, storage, job, parsingJobId, fileId, versionId);
  };
}
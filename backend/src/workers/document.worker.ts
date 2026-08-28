import { createHash } from "node:crypto";
import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { fileTypeFromBuffer } from "file-type";
import mammoth from "mammoth";
import { toInsertBatches } from "../db/batch-insert.js";
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
  knowledgePageBlocks,
  knowledgePages,
  knowledgeSections,
  parsingJobs
} from "../db/schema.js";
import type { ObjectStorage } from "../storage/index.js";
import type { DocumentJobData } from "./document-job-state.js";
import { reconcileDocumentJobFailure } from "./document-job-state.js";
import { extractPdfTextInWorker, type PdfPageProgress } from "./pdf-text-extractor.js";
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

async function parseDocument(
  data: Buffer,
  mimeType: string,
  onPage?: (progress: PdfPageProgress) => void
): Promise<ParsedDocument> {
  if (mimeType === "application/pdf") {
    const pages = await extractPdfTextInWorker(data, onPage);
    return {
      parser: "unpdf",
      pages: pages.map((text, index) => ({ page: index + 1, text }))
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

/** PDF 逐页提取进度日志：按页抽样输出，数百页文档不刷屏 */
function logPdfProgress(fileId: string) {
  return ({ pageNumber, totalPages }: PdfPageProgress): void => {
    if (pageNumber % 50 === 0 || pageNumber === totalPages) {
      console.info("PDF 文本提取进度", { fileId, pageNumber, totalPages });
    }
  };
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

/** 生成稳定 UUID：解析重试时页面、章节和内容块的身份仍可由文档版本和位置确定。 */
function stableUuid(versionId: string, kind: string, key: string): string {
  const hex = createHash("sha256").update(`${versionId}:${kind}:${key}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

interface WikiSectionDraft {
  id: string;
  parentId: string | null;
  sectionKey: string;
  title: string;
  level: number;
  headingPath: string[];
  sortOrder: number;
  startPage: number | null;
  endPage: number | null;
  sourceAnchor: string | null;
}

interface WikiStructure {
  sections: WikiSectionDraft[];
  pageIds: Map<number, string>;
  pageSectionIds: Map<number, string>;
  pageTitleSectionIds: Map<string, string>;
}

/**
 * 从页面顺序构建 Wiki 章节树。章节键使用完整标题路径，不依赖数据库自增 ID；
 * 页面没有标题时挂在文档根章节下，保证纯正文和旧版本也有稳定阅读层级。
 */
function buildWikiStructure(versionId: string, title: string, pages: ParsedPage[]): WikiStructure {
  const rootId = stableUuid(versionId, "section", "root");
  const sections: WikiSectionDraft[] = [{
    id: rootId,
    parentId: null,
    sectionKey: "root",
    title: title.slice(0, 255) || "文档正文",
    level: 1,
    headingPath: [title.slice(0, 255) || "文档正文"],
    sortOrder: 0,
    startPage: pages[0]?.page ?? 0,
    endPage: pages[pages.length - 1]?.page ?? 0,
    sourceAnchor: null
  }];
  const sectionByKey = new Map<string, WikiSectionDraft>([["root", sections[0]!]]);
  const pageIds = new Map<number, string>();
  const pageSectionIds = new Map<number, string>();
  const pageTitleSectionIds = new Map<string, string>();
  let active: WikiSectionDraft = sections[0]!;
  const stack: WikiSectionDraft[] = [];

  for (const page of pages) {
    const pageNumber = page.page ?? 0;
    pageIds.set(pageNumber, stableUuid(versionId, "page", String(pageNumber)));
    for (const line of page.text.split("\n")) {
      const heading = detectHeading(line);
      if (!heading || heading.isClause) continue;
      while (stack.length > 0 && stack[stack.length - 1]!.level >= Math.max(1, heading.level)) stack.pop();
      const parentSection = stack[stack.length - 1] ?? sections[0]!;
      const headingPath = [...(parentSection === sections[0]! ? [] : parentSection.headingPath.slice(1)), heading.title];
      const sectionKey = headingPath.join("/") || heading.title;
      let section = sectionByKey.get(sectionKey);
      if (!section) {
        section = {
          id: stableUuid(versionId, "section", sectionKey),
          parentId: parentSection.id,
          sectionKey,
          title: heading.title.slice(0, 255),
          level: Math.max(1, heading.level),
          headingPath: [title.slice(0, 255) || "文档正文", ...headingPath],
          sortOrder: sections.filter((item) => item.parentId === parentSection.id).length + 1,
          startPage: pageNumber,
          endPage: pageNumber,
          sourceAnchor: heading.anchor
        };
        sectionByKey.set(sectionKey, section);
        sections.push(section);
      } else {
        section.endPage = pageNumber;
      }
      active = section;
      stack.push(section);
      pageTitleSectionIds.set(`${pageNumber}:${heading.title}`, section.id);
    }
    active.endPage = pageNumber;
    pageSectionIds.set(pageNumber, active.id);
  }
  return { sections, pageIds, pageSectionIds, pageTitleSectionIds };
}

interface WriteParsedInput {
  documentId: string;
  versionId: string;
  versionTitle: string;
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
  sectionCount: number;
  blockCount: number;
}

/** 单批分块行数：压低分块及其派生行的内存峰值，实际批量仍会再按绑定参数上限二次切分 */
const CHUNK_WRITE_BATCH_SIZE = 500;
/** 单批页面行数：页面行携带整页原文，批量过大会让单条 SQL 文本膨胀到数 MB */
const PAGE_WRITE_BATCH_SIZE = 200;

interface ChunkWriteContext {
  documentId: string;
  versionId: string;
  projectId: string | null;
  evidenceLevel: "A" | "B" | "C" | null;
  pageIds: Map<number, string>;
  pageSectionIds: Map<number, string>;
  rootSectionId: string;
}

/**
 * 分块写入器：Wiki 页面块先于兼容 Chunk 写入，Chunk 通过 pageBlockId/sectionId 关联回可读层。
 * 批量写入仍保留，避免大文档把所有派生记录一次性驻留内存。
 */
function createChunkWriter(tx: DbExecutor, context: ChunkWriteContext) {
  const { documentId, versionId, projectId, evidenceLevel, pageIds, pageSectionIds, rootSectionId } = context;
  const isClause = (anchor: string): boolean => /^第\s*\d+(?:\.\d+)*\s*条$/.test(anchor);
  const pageBlockIndexes = new Map<number, number>();
  let buffer: ExtractedChunk[] = [];
  let written = 0;
  let blockWritten = 0;

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    const blockRows = batch.map((chunk) => {
      const pageNumber = chunk.sourcePage ?? 0;
      const blockIndex = pageBlockIndexes.get(pageNumber) ?? 0;
      pageBlockIndexes.set(pageNumber, blockIndex + 1);
      const pageId = pageIds.get(pageNumber) ?? pageIds.get(0);
      if (!pageId) throw new Error(`页面 ${pageNumber} 不存在，无法写入 Wiki 内容块`);
      return {
        id: stableUuid(versionId, "block", `${pageNumber}:${blockIndex}`),
        documentId,
        versionId,
        pageId,
        sectionId: pageSectionIds.get(pageNumber) ?? rootSectionId,
        blockIndex,
        content: chunk.content,
        contentType: chunk.contentType,
        searchText: chunk.searchText,
        sourceAnchor: chunk.citationAnchor,
        metadata: chunk.metadata ?? null
      };
    });
    for (const values of toInsertBatches(blockRows)) await tx.insert(knowledgePageBlocks).values(values);

    const chunkRows = batch.map((chunk, offset) => {
      const block = blockRows[offset]!;
      const pageId = pageIds.get(chunk.sourcePage ?? 0) ?? pageIds.get(0);
      return {
        documentId,
        versionId,
        sectionId: block.sectionId,
        pageBlockId: block.id,
        projectId,
        chunkIndex: written + offset,
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
        metadata: { ...(chunk.metadata ?? {}), pageId, blockIndex: block.blockIndex },
        sortWeight: 0
      };
    });
    const chunkIds: string[] = [];
    for (const values of toInsertBatches(chunkRows)) {
      const inserted = await tx.insert(knowledgeChunks).values(values).returning({ id: knowledgeChunks.id });
      for (const row of inserted) chunkIds.push(row.id);
    }

    const termValues = batch.flatMap((chunk, offset) => [
      ...chunk.keywords.map((term) => ({ chunkId: chunkIds[offset]!, term, termType: "KEYWORD" as const, weight: 0 })),
      ...chunk.aliasTerms.map((term) => ({ chunkId: chunkIds[offset]!, term, termType: "SYNONYM" as const, weight: 0 }))
    ]);
    for (const values of toInsertBatches(termValues)) await tx.insert(knowledgeChunkTerms).values(values);

    const citationValues = batch.flatMap((chunk, offset) =>
      extractAnchors(chunk.content).slice(0, 3).map((anchor) => ({
        chunkId: chunkIds[offset]!,
        documentId,
        versionId,
        sourceType: "OTHER" as const,
        pageNumber: chunk.sourcePage,
        clauseNo: isClause(anchor) ? anchor : null,
        evidenceLevel,
        note: isClause(anchor) ? null : anchor
      }))
    );
    for (const values of toInsertBatches(citationValues)) await tx.insert(knowledgeCitations).values(values);
    written += batch.length;
    blockWritten += batch.length;
  };

  return {
    async push(chunks: readonly ExtractedChunk[]): Promise<void> {
      for (const chunk of chunks) {
        buffer.push(chunk);
        if (buffer.length >= CHUNK_WRITE_BATCH_SIZE) await flush();
      }
    },
    async finish(): Promise<{ chunkCount: number; blockCount: number }> {
      await flush();
      return { chunkCount: written, blockCount: blockWritten };
    }
  };
}

/**
 * 将解析结果按版本写入：页面 + 分块 + 分块术语 + 引用。
 * 先清空该版本旧内容（版本替代/重新解析场景；历史版本数据不受影响），
 * 文本流中表格区域独立成块；XLSX 每工作表一个页面并按行产出结构化 TABLE 块。
 * 页面与分块均分批写入，行数由文档规模决定，不能用单条语句一次插完。
 */
async function writeParsedContent(tx: DbExecutor, input: WriteParsedInput): Promise<WriteParsedResult> {
  const { documentId, versionId, versionTitle, projectId, pages, aliases, evidenceLevel, sheets } = input;
  const wiki = buildWikiStructure(versionId, versionTitle, pages);

  // 删除旧的兼容索引后再删除 Wiki 层，保证重新解析不会留下悬挂内容块。
  await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.versionId, versionId));
  await tx.delete(knowledgePageBlocks).where(eq(knowledgePageBlocks.versionId, versionId));
  await tx.delete(knowledgePages).where(eq(knowledgePages.versionId, versionId));
  await tx.delete(knowledgeSections).where(eq(knowledgeSections.versionId, versionId));

  for (const values of toInsertBatches(wiki.sections.map((section) => ({
    id: section.id,
    documentId,
    versionId,
    parentId: section.parentId,
    sectionKey: section.sectionKey,
    title: section.title,
    level: section.level,
    headingPath: section.headingPath,
    sortOrder: section.sortOrder,
    startPage: section.startPage,
    endPage: section.endPage,
    sourceAnchor: section.sourceAnchor
  })))) {
    await tx.insert(knowledgeSections).values(values);
  }

  const pageValues = pages.map((page) => {
    const pageNumber = page.page ?? 0;
    const marks = detectPageMarks(page.text);
    return {
      id: wiki.pageIds.get(pageNumber) ?? stableUuid(versionId, "page", String(pageNumber)),
      documentId,
      versionId,
      sectionId: wiki.pageSectionIds.get(pageNumber) ?? wiki.sections[0]!.id,
      pageNumber,
      parsedText: page.text,
      sectionPath: detectPageSection(page.text),
      hasTables: marks.hasTables,
      hasImages: marks.hasImages,
      parseStatus: "PARSED" as const
    };
  });
  for (const values of toInsertBatches(pageValues, PAGE_WRITE_BATCH_SIZE)) {
    await tx.insert(knowledgePages).values(values);
  }

  const writer = createChunkWriter(tx, {
    documentId,
    versionId,
    projectId,
    evidenceLevel,
    pageIds: wiki.pageIds,
    pageSectionIds: wiki.pageSectionIds,
    rootSectionId: wiki.sections[0]!.id
  });
  // buildChunksFromPages 按页独立成块，逐页调用与整体调用结果一致，但分块不再全量驻留。
  for (const page of pages) await writer.push(buildChunksFromPages([page], aliases));
  for (const sheet of sheets ?? []) {
    await writer.push(buildChunksFromSheet(sheet.data, aliases)
      .map((chunk) => ({ ...chunk, sourcePage: sheet.pageNumber, pageEnd: sheet.pageNumber })));
  }
  const written = await writer.finish();
  return {
    pageCount: pages.length,
    chunkCount: written.chunkCount,
    sectionCount: wiki.sections.length,
    blockCount: written.blockCount
  };
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
    const parsed = await parseDocument(data, mimeType, logPdfProgress(file.id));
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
        versionTitle: version.title,
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
    await reconcileDocumentJobFailure(db, job.data, message, job.attemptsMade + 1);
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
        versionTitle: version.title,
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
    await reconcileDocumentJobFailure(db, job.data, message, job.attemptsMade + 1);
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
    const parsed = await parseDocument(data, mimeType, logPdfProgress(file.id));
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
        versionTitle: version!.title,
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
    await reconcileDocumentJobFailure(db, job.data, message, job.attemptsMade + 1);
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
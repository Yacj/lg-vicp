import { createHash } from "node:crypto";
import type { Job } from "bullmq";
import { and, eq, ne, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { fileTypeFromBuffer } from "file-type";
import mammoth from "mammoth";
import { env } from "../config/env.js";
import { toInsertBatches } from "../db/batch-insert.js";
import type { Database, DbExecutor } from "../db/client.js";
import {
  asyncTasks,
  files,
  knowledgeAliases,
  knowledgeDocumentAssets,
  knowledgeChunkTerms,
  knowledgeChunks,
  knowledgeCitations,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  knowledgePageBlocks,
  knowledgePageMappings,
  knowledgePages,
  knowledgeSections,
  knowledgeTocItems,
  parsingJobs
} from "../db/schema.js";
import type { ObjectStorage } from "../storage/index.js";
import type { DocumentJobData } from "./document-job-state.js";
import { reconcileDocumentJobFailure } from "./document-job-state.js";
import {
  extractPdfDocumentInWorker,
  type PdfExtractedPage,
  type PdfOutlineItem,
  type PdfPageProgress
} from "./pdf-text-extractor.js";
import { renderPdfPagesInWorker } from "./pdf-page-renderer.js";
import {
  buildChunksFromBlocks,
  buildChunksFromSheet,
  buildSectionDrafts,
  createPageBlockScanState,
  parsePageToBlocks,
  splitText,
  type AliasDictEntry,
  type BlockDraft,
  type ExtractedChunk,
  type ParsedPageInput,
  type SheetData
} from "../modules/knowledge/knowledge-chunking.js";
import { buildPageMappings, type PageMappingDraft } from "../modules/knowledge/knowledge-page-mapping.js";
import { findVisualPageMatches } from "../modules/knowledge/pdf-visual-matcher.js";

// 兼容既有测试与调用方：splitText 由分块纯函数模块提供
export { splitText };

interface ParsedPage {
  page: number | null;
  text: string;
  items?: PdfExtractedPage["items"];
  label?: string | null;
  labelSource?: "PDF_PAGE_LABEL" | "FOOTER_TEXT" | null;
  labelConfidence?: number | null;
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

/** 非 PDF 文档解析（DOCX/XLSX/不支持格式）；PDF 由 handleParseJob 直接走双源感知的提取链路 */
async function parseDocument(
  data: Buffer,
  mimeType: string,
  onPage?: (progress: PdfPageProgress) => void
): Promise<ParsedDocument> {
  if (mimeType === "application/pdf") {
    const extraction = await extractPdfDocumentInWorker(data, onPage);
    return {
      parser: "unpdf",
      pages: extraction.pageDetails.map((page) => ({
        page: page.pageNumber,
        text: page.text,
        items: page.items,
        label: page.pageLabel,
        labelSource: page.pageLabelSource,
        labelConfidence: page.pageLabelConfidence
      }))
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

const CHUNK_WRITE_BATCH_SIZE = 500;
const PAGE_WRITE_BATCH_SIZE = 200;

// ---------------------------------------------------------------- Wiki 内容写入（原文页行 + 章节草稿 + Block 级 Section 归属 + 辅助 Chunk）

/** 原文页面行：physical = 物理页序号；label = 印刷页码（无则 String(physical)）；text = 机器提取文本（可为 null） */
interface OriginalPageInput {
  physical: number;
  label: string | null;
  labelSource?: "PDF_PAGE_LABEL" | "FOOTER_TEXT" | "TOC_MAPPING" | "COMPANION_FILE" | "VISUAL_MATCH" | "MANUAL" | "FALLBACK";
  labelConfidence?: number | null;
  text: string | null;
}

/** 文本来源页：physical = 来源物理页（Original 或 Search Source）；targetPhysical = 归属的原文物理页 */
interface ContentPageInput {
  /** 文本源中的物理页序号（Search Source 时只存入 metadata，不作为原文定位依据） */
  physical: number;
  text: string;
  /** 已确认可回溯的 ORIGINAL 物理页。未映射的检索页必须为 null，并且不进入索引。 */
  targetPhysical: number | null;
}

interface WriteContentInput {
  documentId: string;
  versionId: string;
  versionTitle: string;
  projectId: string | null;
  aliases: AliasDictEntry[];
  evidenceLevel: "A" | "B" | "C" | null;
  originalPages: OriginalPageInput[];
  /** 文本来源页；空数组 = 无文本层（仅写原文页面行 + 预览） */
  contentPages: ContentPageInput[];
  sheets?: Array<{ data: SheetData; pageNumber: number }> | null;
  /** 双源场景标记：内容来自检索源时，chunk.metadata 记录 searchPageNumber */
  contentFromSearchSource?: boolean;
}

interface WriteContentResult {
  pageCount: number;
  sectionCount: number;
  blockCount: number;
  chunkCount: number;
}

/** 内容块 + 派生 Chunk 的流式写入器：一页一刷，避免大文档全量驻留内存 */
function createContentWriter(
  tx: DbExecutor,
  context: { documentId: string; versionId: string; projectId: string | null; evidenceLevel: "A" | "B" | "C" | null }
) {
  let buffer: Array<{ block: ResolvedBlock; chunk: ExtractedChunk }> = [];
  let written = 0;
  let blockWritten = 0;
  let chunkIndexCounter = 0;

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];

    const blockRows = batch.map(({ block }) => ({
      id: block.id,
      documentId: context.documentId,
      versionId: context.versionId,
      pageId: block.pageId,
      sectionId: block.sectionId,
      blockIndex: block.blockIndex,
      content: block.content,
      contentType: block.contentType,
      searchText: block.searchText,
      sourceAnchor: block.sourceAnchor,
      metadata: block.metadata ?? null
    }));
    for (const values of toInsertBatches(blockRows)) await tx.insert(knowledgePageBlocks).values(values);

    for (const { block, chunk } of batch) {
      const chunkRow = {
        documentId: context.documentId,
        versionId: context.versionId,
        sectionId: block.sectionId,
        pageBlockId: block.id,
        projectId: context.projectId,
        chunkIndex: chunkIndexCounter++,
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
        metadata: { ...(chunk.metadata ?? {}), pageId: block.pageId, blockIndex: block.blockIndex },
        sortWeight: 0
      };
      const [inserted] = await tx.insert(knowledgeChunks).values(chunkRow).returning({ id: knowledgeChunks.id });
      const chunkId = inserted!.id;
      const termValues = [
        ...chunk.keywords.map((term) => ({ chunkId, term, termType: "KEYWORD" as const, weight: 0 })),
        ...chunk.aliasTerms.map((term) => ({ chunkId, term, termType: "SYNONYM" as const, weight: 0 }))
      ];
      if (termValues.length > 0) {
        for (const values of toInsertBatches(termValues)) await tx.insert(knowledgeChunkTerms).values(values);
      }
      const anchors = extractAnchorsFromContent(chunk.content).slice(0, 3);
      if (anchors.length > 0) {
        const citationValues = anchors.map((anchor) => ({
          chunkId,
          documentId: context.documentId,
          versionId: context.versionId,
          sourceType: "OTHER" as const,
          pageNumber: chunk.sourcePage,
          clauseNo: isClauseAnchor(anchor) ? anchor : null,
          evidenceLevel: context.evidenceLevel,
          note: isClauseAnchor(anchor) ? null : anchor
        }));
        for (const values of toInsertBatches(citationValues)) await tx.insert(knowledgeCitations).values(values);
      }
      written += 1;
    }
    blockWritten += batch.length;
  };

  return {
    async push(item: { block: ResolvedBlock; chunk: ExtractedChunk }): Promise<void> {
      buffer.push(item);
      if (buffer.length >= CHUNK_WRITE_BATCH_SIZE) await flush();
    },
    async finish(): Promise<{ chunkCount: number; blockCount: number }> {
      await flush();
      return { chunkCount: written, blockCount: blockWritten };
    }
  };
}

function isClauseAnchor(anchor: string): boolean {
  return /^第\s*\d+(?:\.\d+)*\s*条$/.test(anchor);
}

function extractAnchorsFromContent(content: string): string[] {
  const anchors: string[] = [];
  for (const pattern of [/(?:表|图)\s*\d+(?:[-.]\s*\d+)*/g, /第\s*\d+(?:\.\d+)*\s*条/g]) {
    for (const match of content.matchAll(pattern)) {
      const anchor = match[0].replace(/\s+/g, "");
      if (!anchors.includes(anchor)) anchors.push(anchor);
    }
  }
  return anchors;
}

/** 内容块解析结果：BlockDraft + 落库定位（页面/章节/页内序号） */
interface ResolvedBlock extends BlockDraft {
  id: string;
  pageId: string;
  sectionId: string;
  blockIndex: number;
}

/**
 * 按原文导航模型写入解析内容：
 * 1. 原文页面行（物理页码 + 印刷页码标签 + 机器提取文本）；
 * 2. 章节草稿由内容块的章节路径聚合（不再用 buildWikiStructure 按整页猜测）；
 * 3. Block 的 sectionId 为 Block 级绑定（同页多个小节各归各），不再整页继承；
 * 4. Chunk 仅由 Block 派生（超长段落 splitText，表格/标题块 1:1），保持兼容语义。
 */
async function writeKnowledgeContent(tx: DbExecutor, input: WriteContentInput): Promise<WriteContentResult> {
  const { documentId, versionId, versionTitle, aliases } = input;

  // 1) 内容块解析（跨页共享章节栈；双源场景块归属到映射后的原文物理页）
  const blocks: BlockDraft[] = [];
  const scanState = createPageBlockScanState();
  for (const contentPage of input.contentPages) {
    // Search Source 未映射到 ORIGINAL 的页面不能伪造原文定位，也不能进入 AI 索引。
    if (contentPage.targetPhysical == null) continue;
    const pageBlocks = parsePageToBlocks(
      { page: contentPage.targetPhysical, text: contentPage.text } satisfies ParsedPageInput,
      aliases,
      scanState
    );
    for (const block of pageBlocks) {
      if (input.contentFromSearchSource) {
        block.metadata = { ...(block.metadata ?? {}), searchPageNumber: contentPage.physical };
      }
      blocks.push(block);
    }
  }
  // XLSX：每行一个 TABLE 块（结构化元数据保留），归属 sheet 对应页面
  for (const sheet of input.sheets ?? []) {
    for (const chunk of buildChunksFromSheet(sheet.data, aliases)) {
      blocks.push({
        content: chunk.content,
        contentType: "TABLE",
        sourcePage: sheet.pageNumber,
        headingLevel: 0,
        sectionDraftPath: [],
        lastHeadingTitle: chunk.sourceSection,
        sourceAnchor: chunk.citationAnchor,
        searchText: chunk.searchText,
        keywords: chunk.keywords,
        aliasTerms: chunk.aliasTerms,
        metadata: chunk.metadata
      });
    }
  }

  // 2) 章节草稿（根章节恒在首位）。只删除派生索引：页面、预览、人工页签和映射必须稳定保留。
  const sectionDrafts = buildSectionDrafts(versionTitle, blocks);
  const confirmedTocSectionLinks = await tx.select({
    tocId: knowledgeTocItems.id,
    sectionKey: knowledgeSections.sectionKey
  }).from(knowledgeTocItems)
    .innerJoin(knowledgeSections, eq(knowledgeSections.id, knowledgeTocItems.sectionId))
    .where(and(
      eq(knowledgeTocItems.versionId, versionId),
      eq(knowledgeTocItems.status, "CONFIRMED")
    ));
  await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.versionId, versionId));
  await tx.delete(knowledgePageBlocks).where(eq(knowledgePageBlocks.versionId, versionId));
  await tx.delete(knowledgeSections).where(eq(knowledgeSections.versionId, versionId));

  const sectionIdByKey = new Map<string, string>();
  for (const draft of sectionDrafts) {
    sectionIdByKey.set(draft.sectionKey, stableUuid(versionId, "section", draft.sectionKey));
  }
  const rootSectionId = sectionIdByKey.get("root")!;
  for (const values of toInsertBatches(sectionDrafts.map((draft) => {
    const parentKey = draft.sectionKey === "root"
      ? null
      : draft.sectionKey.split("/").slice(0, -1).join("/") || "root";
    return {
      id: sectionIdByKey.get(draft.sectionKey)!,
      documentId,
      versionId,
      parentId: parentKey ? sectionIdByKey.get(parentKey) ?? rootSectionId : null,
      sectionKey: draft.sectionKey,
      title: draft.title,
      level: draft.level,
      headingPath: draft.headingPath,
      sortOrder: draft.sortOrder,
      startPage: draft.startPage,
      endPage: draft.endPage,
      searchText: draft.searchText,
      sourceAnchor: null
    };
  }))) {
    await tx.insert(knowledgeSections).values(values);
  }

  for (const link of confirmedTocSectionLinks) {
    const sectionId = sectionIdByKey.get(link.sectionKey);
    if (sectionId) {
      await tx.update(knowledgeTocItems).set({ sectionId }).where(eq(knowledgeTocItems.id, link.tocId));
    }
  }

  // 3) 原文页面行（物理页码 + 印刷页码标签；sectionId = 页面首个内容块所属章节）。
  // onConflict 仅更新解析派生字段，保留人工 pageLabel/pageTitle 与 pageImageObjectKey。
  const existingPages = await tx.select({ id: knowledgePages.id, physicalPageNumber: knowledgePages.physicalPageNumber })
    .from(knowledgePages).where(eq(knowledgePages.versionId, versionId));
  const existingPageIdByPhysical = new Map(existingPages.map((page) => [page.physicalPageNumber, page.id]));
  const pageIdByPhysical = new Map<number, string>();
  const firstBlockByPage = new Map<number, BlockDraft>();
  for (const block of blocks) {
    if (block.sourcePage != null && !firstBlockByPage.has(block.sourcePage)) firstBlockByPage.set(block.sourcePage, block);
  }
  const pageValues = input.originalPages.map((page) => {
    const id = existingPageIdByPhysical.get(page.physical) ?? stableUuid(versionId, "page", String(page.physical));
    pageIdByPhysical.set(page.physical, id);
    const firstBlock = firstBlockByPage.get(page.physical);
    const sectionKey = firstBlock ? (firstBlock.sectionDraftPath.join("/") || "root") : "root";
    return {
      id,
      documentId,
      versionId,
      sectionId: sectionIdByKey.get(sectionKey) ?? rootSectionId,
      pageNumber: page.physical,
      physicalPageNumber: page.physical,
      pageLabel: page.label ?? String(page.physical),
      pageLabelSource: page.labelSource ?? "FALLBACK",
      pageLabelConfidence: page.labelConfidence ?? null,
      pageLabelVerified: page.labelSource === "MANUAL",
      pageTitle: null,
      parsedText: page.text,
      sectionPath: firstBlock
        ? firstBlock.sectionDraftPath.length > 0
          ? firstBlock.sectionDraftPath[firstBlock.sectionDraftPath.length - 1]!
          : null
        : null,
      hasTables: page.text ? detectPageMarks(page.text).hasTables : false,
      hasImages: page.text ? detectPageMarks(page.text).hasImages : false,
      parseStatus: "PARSED" as const
    };
  });
  for (const values of toInsertBatches(pageValues, PAGE_WRITE_BATCH_SIZE)) {
    await tx.insert(knowledgePages).values(values).onConflictDoUpdate({
      target: [knowledgePages.versionId, knowledgePages.physicalPageNumber],
      set: {
        documentId,
        sectionId: sql`excluded.section_id`,
        pageNumber: sql`excluded.page_number`,
        pageLabel: sql`case when ${knowledgePages.pageLabelSource} = 'MANUAL' then ${knowledgePages.pageLabel} else excluded.page_label end`,
        pageLabelSource: sql`case when ${knowledgePages.pageLabelSource} = 'MANUAL' then ${knowledgePages.pageLabelSource} else excluded.page_label_source end`,
        pageLabelConfidence: sql`case when ${knowledgePages.pageLabelSource} = 'MANUAL' then ${knowledgePages.pageLabelConfidence} else excluded.page_label_confidence end`,
        pageLabelVerified: sql`case when ${knowledgePages.pageLabelSource} = 'MANUAL' then ${knowledgePages.pageLabelVerified} else excluded.page_label_verified end`,
        parsedText: sql`excluded.parsed_text`,
        sectionPath: sql`excluded.section_path`,
        hasTables: sql`excluded.has_tables`,
        hasImages: sql`excluded.has_images`,
        parseStatus: sql`excluded.parse_status`
      }
    });
  }

  // 4) 内容块解析为落库行（Block 级 sectionId；页内序号按目标物理页递增）
  const fallbackPageId = pageIdByPhysical.get(input.originalPages[0]?.physical ?? 0)
    ?? pageIdByPhysical.values().next().value
    ?? "";
  const blockIndexByPage = new Map<number, number>();
  const writer = createContentWriter(tx, {
    documentId,
    versionId,
    projectId: input.projectId,
    evidenceLevel: input.evidenceLevel
  });
  for (const block of blocks) {
    const targetPage = block.sourcePage ?? input.originalPages[0]?.physical ?? 0;
    const pageId = pageIdByPhysical.get(targetPage) ?? fallbackPageId;
    const blockIndex = blockIndexByPage.get(targetPage) ?? 0;
    blockIndexByPage.set(targetPage, blockIndex + 1);
    const sectionKey = block.sectionDraftPath.join("/") || "root";
    const resolved: ResolvedBlock = {
      ...block,
      id: stableUuid(versionId, "block", `${targetPage}:${blockIndex}`),
      pageId,
      sectionId: sectionIdByKey.get(sectionKey) ?? rootSectionId,
      blockIndex
    };
    for (const chunk of buildChunksFromBlocks([block])) {
      await writer.push({ block: resolved, chunk });
    }
  }
  const written = await writer.finish();
  return {
    pageCount: input.originalPages.length,
    sectionCount: sectionDrafts.length,
    blockCount: written.blockCount,
    chunkCount: written.chunkCount
  };
}

/** PDF 无文本层阈值（全文提取字符数；导出供测试与 B 端预检复用） */
export function isNoTextLayer(totalTextLength: number): boolean {
  return totalTextLength < env.PDF_TEXT_LAYER_MIN_CHARS;
}

/** 由书签大纲写 TOC（PENDING_REVIEW 初稿）：同来源非 CONFIRMED 条目可被重跑覆盖，人工确认条目永不覆盖 */
async function writeTocFromOutline(
  tx: DbExecutor,
  input: {
    documentId: string;
    versionId: string;
    outline: PdfOutlineItem[];
    source: "PDF_BOOKMARK" | "COMPANION_FILE";
    maxPage: number | null;
    createdById?: string | null;
  }
): Promise<number> {
  const items = input.outline.filter((item) => item.title.trim());
  if (items.length === 0) return 0;
  await tx.delete(knowledgeTocItems).where(and(
    eq(knowledgeTocItems.versionId, input.versionId),
    eq(knowledgeTocItems.source, input.source),
    ne(knowledgeTocItems.status, "CONFIRMED")
  ));
  const parentStack: Array<{ id: string; level: number }> = [];
  let sortOrder = 0;
  for (const item of items) {
    while (parentStack.length > 0 && parentStack[parentStack.length - 1]!.level >= Math.max(1, item.level)) {
      parentStack.pop();
    }
    const physical = item.pageNumber != null && item.pageNumber >= 1
      && (input.maxPage == null || item.pageNumber <= input.maxPage)
      ? item.pageNumber
      : null;
    const [row] = await tx.insert(knowledgeTocItems).values({
      documentId: input.documentId,
      versionId: input.versionId,
      parentId: parentStack.length > 0 ? parentStack[parentStack.length - 1]!.id : null,
      level: Math.max(1, item.level),
      sortOrder,
      title: item.title.slice(0, 255),
      physicalPageNumber: physical,
      source: input.source,
      confidence: physical != null ? 1 : 0.5,
      status: "PENDING_REVIEW" as const,
      createdById: input.createdById ?? null
    }).returning({ id: knowledgeTocItems.id });
    if (row) parentStack.push({ id: row.id, level: Math.max(1, item.level) });
    sortOrder += 1;
  }
  return sortOrder;
}

/** 落库页面映射草稿：仅替换自动映射，人工 MANUAL/verified 映射在重跑时保持不变。 */
async function writePageMappings(
  tx: DbExecutor,
  input: { documentId: string; versionId: string; mappings: PageMappingDraft[]; originalPageIdByPhysical: Map<number, string>; createdById?: string | null }
): Promise<number> {
  const preserved = await tx.select({ searchPhysicalPageNumber: knowledgePageMappings.searchPhysicalPageNumber })
    .from(knowledgePageMappings)
    .where(and(
      eq(knowledgePageMappings.versionId, input.versionId),
      sql`(${knowledgePageMappings.mappingMethod} = 'MANUAL' or ${knowledgePageMappings.verified} = true)`
    ));
  const preservedSearchPages = new Set(preserved.map((row) => row.searchPhysicalPageNumber));
  await tx.delete(knowledgePageMappings).where(and(
    eq(knowledgePageMappings.versionId, input.versionId),
    sql`${knowledgePageMappings.mappingMethod} <> 'MANUAL' and ${knowledgePageMappings.verified} = false`
  ));
  let written = 0;
  for (const mapping of input.mappings) {
    if (preservedSearchPages.has(mapping.searchPhysicalPageNumber)) continue;
    const originalPageId = input.originalPageIdByPhysical.get(mapping.originalPhysicalPageNumber);
    if (!originalPageId) continue;
    await tx.insert(knowledgePageMappings).values({
      documentId: input.documentId,
      versionId: input.versionId,
      originalPageId,
      searchPhysicalPageNumber: mapping.searchPhysicalPageNumber,
      pageLabel: mapping.pageLabel,
      mappingMethod: mapping.mappingMethod,
      confidence: mapping.confidence,
      verified: false,
      createdById: input.createdById ?? null
    });
    written += 1;
  }
  return written;
}

/**
 * 页面预览派生（P0-4）：ORIGINAL PDF 逐页渲染 → OSS → 回写 pageImageObjectKey。
 * 逐页处理、并发 1、跳过已渲染页（幂等）；尽力而为：渲染失败不影响解析主流程。
 */
async function renderOriginalPreviews(
  db: Database,
  storage: ObjectStorage,
  input: { versionId: string; objectKey: string }
): Promise<void> {
  if (!env.PDF_PREVIEW_ENABLED) return;
  try {
    const rows = await db.select({
      physicalPageNumber: knowledgePages.physicalPageNumber,
      pageImageObjectKey: knowledgePages.pageImageObjectKey
    }).from(knowledgePages).where(eq(knowledgePages.versionId, input.versionId));
    if (rows.length === 0) return;
    const skip = new Set(rows.filter((row) => row.pageImageObjectKey).map((row) => row.physicalPageNumber));
    // 渲染需要独立的可转移 Buffer（提取线程会接管所有权），重新读一次对象存储
    const data = await storage.getObject(input.objectKey);
    const outcome = await renderPdfPagesInWorker(data, {
      dpi: env.PDF_PREVIEW_DPI,
      format: env.PDF_PREVIEW_FORMAT,
      shouldSkip: (pageNumber) => skip.has(pageNumber),
      onPageRendered: async ({ pageNumber, data: image }) => {
        const objectKey = `knowledge/previews/${input.versionId}/p${pageNumber}.${env.PDF_PREVIEW_FORMAT}`;
        await storage.putObject(objectKey, image, env.PDF_PREVIEW_FORMAT === "webp" ? "image/webp" : "image/png");
        await db.update(knowledgePages).set({ pageImageObjectKey: objectKey })
          .where(and(
            eq(knowledgePages.versionId, input.versionId),
            eq(knowledgePages.physicalPageNumber, pageNumber)
          ));
      }
    });
    console.info("PDF 页面预览渲染完成", {
      versionId: input.versionId,
      totalPages: outcome.totalPages,
      rendered: outcome.rendered.length,
      failed: outcome.failed.length
    });
  } catch (error) {
    console.warn("PDF 页面预览渲染失败（不影响解析结果）", {
      versionId: input.versionId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

// ---------------------------------------------------------------- 解析任务处理

/** 知识解析链路失败提醒：终态失败时生成 B 端通知（尽力写入，失败不阻塞失败状态收敛） */
async function notifyKnowledgeParseFailure(db: Database, data: DocumentJobData, message: string): Promise<void> {
  if (!data.versionId) return;
  await import("../modules/notifications/notification.service.js").then(({ createNotification }) => createNotification({ db }, {
    type: "KNOWLEDGE_PARSE_FAILED",
    title: data.jobType === "CHUNK_REBUILD" ? "知识库分块重建失败" : "知识库文档解析失败",
    content: message,
    targetType: "knowledge_document_version",
    targetId: data.versionId
  }));
}

interface ParseContext {
  db: Database;
  storage: ObjectStorage;
  job: Job<DocumentJobData>;
  parsingJobId: string;
  versionId: string;
  fileId: string;
  /** UPGRADE_PARSE：已发布版本重跑解析时不降级管线状态 */
  preservePublishedStatus?: boolean;
}

/** 单源解析（有文本层的 Original / DOCX / XLSX）：parsed/outline 由调用方解析一次后传入 */
async function parseSingleSource(
  context: ParseContext,
  parsed: ParsedDocument,
  outline: PdfOutlineItem[],
  version: typeof knowledgeDocumentVersions.$inferSelect,
  documentRow: { projectId: string | null }
): Promise<Record<string, unknown>> {
  const { db, storage, job } = context;
  const aliases = await loadActiveAliases(db);

  await db.update(knowledgeDocumentVersions).set({ pipelineStatus: "CHUNKING", updatedAt: new Date() })
    .where(eq(knowledgeDocumentVersions.id, context.versionId));
  await job.updateProgress(60);

  const result = await db.transaction(async (tx) => {
    const written = await writeKnowledgeContent(tx, {
      documentId: version.documentId,
      versionId: context.versionId,
      versionTitle: version.title,
      projectId: documentRow.projectId,
      aliases,
      evidenceLevel: version.evidenceLevel,
      originalPages: parsed.pages.map((page) => ({
        physical: page.page ?? 0,
        label: page.label ?? null,
        labelSource: page.labelSource ?? "FALLBACK",
        labelConfidence: page.labelConfidence ?? null,
        text: page.text
      })),
      contentPages: parsed.pages
        .filter((page) => page.page != null)
        .map((page) => ({ physical: page.page!, text: page.text, targetPhysical: page.page! })),
      sheets: parsed.sheets ?? null
    });
    if (outline.length > 0) {
      await writeTocFromOutline(tx, {
        documentId: version.documentId,
        versionId: context.versionId,
        outline,
        source: "PDF_BOOKMARK",
        maxPage: parsed.pages.length
      });
    }
    await tx.update(knowledgeDocumentVersions).set({
      parseStatus: "PARSED",
      pageCount: written.pageCount,
      parser: parsed.parser,
      ...(context.preservePublishedStatus && version.status === "PUBLISHED"
        ? {}
        : { pipelineStatus: "REVIEW_PENDING" as const }),
      updatedAt: new Date()
    }).where(eq(knowledgeDocumentVersions.id, context.versionId));
    await tx.update(files).set({ status: "READY", errorMessage: null, updatedAt: new Date() })
      .where(eq(files.id, context.fileId));
    return written;
  });

  await db.update(parsingJobs).set({
    status: "COMPLETED", progress: 100,
    result: {
      status: "READY", versionId: context.versionId,
      pageCount: result.pageCount, chunkCount: result.chunkCount, parser: parsed.parser,
      tocItemCount: outline.length
    },
    finishedAt: new Date(), updatedAt: new Date()
  }).where(eq(parsingJobs.id, context.parsingJobId));
  await job.updateProgress(100);
  if (parsed.parser === "unpdf") {
    const [fileRow] = await db.select({ objectKey: files.objectKey }).from(files).where(eq(files.id, context.fileId)).limit(1);
    if (fileRow) await renderOriginalPreviews(db, storage, { versionId: context.versionId, objectKey: fileRow.objectKey });
  }
  return { status: "READY" };
}

/** 双源解析（Original 无文本层 + Search Source 有文本）：页映射 + 检索源内容 + 原页预览 */
async function parseDualSource(
  context: ParseContext,
  originalPageDetails: PdfExtractedPage[],
  originalOutline: PdfOutlineItem[],
  version: typeof knowledgeDocumentVersions.$inferSelect,
  documentRow: { projectId: string | null },
  searchAsset: { id: string; fileId: string }
): Promise<Record<string, unknown>> {
  const { db, storage, job } = context;
  const [searchFile] = await db.select().from(files).where(eq(files.id, searchAsset.fileId)).limit(1);
  if (!searchFile) throw new Error("检索文本源文件不存在");
  const searchMimeType = searchFile.mimeType;
  if (searchMimeType !== "application/pdf") {
    // 检索源暂仅支持 PDF 文本源；无可用文本源 → SEARCH_SOURCE_REQUIRED（可浏览不可 AI）
    return finishNoSearchSource(context, originalPageDetails, version, "检索文本源不是 PDF 文件");
  }
  const searchData = await storage.getObject(searchFile.objectKey);
  const searchExtraction = await extractPdfDocumentInWorker(searchData, logPdfProgress(searchFile.id));
  const searchTextLength = searchExtraction.pages.reduce((sum, text) => sum + text.trim().length, 0);
  const originalTotalPages = originalPageDetails.length;
  if (isNoTextLayer(searchTextLength)) {
    // 检索源同样没有文本层（两份都是转曲件）：不产空内容，直接进入待补检索源状态
    return finishNoSearchSource(context, originalPageDetails, version, "检索文本源也没有文本层：请提供可复制文本的检索版 PDF，或开启 OCR 后重试");
  }
  const aliases = await loadActiveAliases(db);

  // Original 只保存页面与预览；其印刷页码优先来自自身 PDF 标签或页脚识别结果。
  const originalPages: OriginalPageInput[] = originalPageDetails.map((page) => ({
    physical: page.pageNumber,
    label: page.pageLabel,
    labelSource: page.pageLabelSource ?? undefined,
    labelConfidence: page.pageLabelConfidence ?? null,
    text: null
  }));
  // 视觉匹配只生成候选，低于置信度门槛的页面保持未映射。
  let visualMatches: Awaited<ReturnType<typeof findVisualPageMatches>> = [];
  try {
    const [originalFile] = await db.select({ objectKey: files.objectKey })
      .from(files).where(eq(files.id, context.fileId)).limit(1);
    if (originalFile) {
      visualMatches = await findVisualPageMatches(
        await storage.getObject(originalFile.objectKey),
        searchData
      );
    }
  } catch (error) {
    console.warn("双源页面视觉匹配失败，保留其他映射候选", {
      versionId: context.versionId,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // 原文 TOC（书签草稿/人工/配套来源）参与 TOC_TITLE 映射策略
  const tocRows = await db.select({
    title: knowledgeTocItems.title,
    pageLabel: knowledgeTocItems.pageLabel,
    physicalPageNumber: knowledgeTocItems.physicalPageNumber
  }).from(knowledgeTocItems).where(eq(knowledgeTocItems.versionId, context.versionId));
  const mappings = buildPageMappings({
    originalPages: originalPages.map((page) => ({ physical: page.physical, label: page.label })),
    searchPages: searchExtraction.pageDetails.map((page) => ({
      physical: page.pageNumber,
      label: page.pageLabel
    })),
    searchTotalPages: searchExtraction.pages.length,
    tocItems: [
      ...tocRows.map((row) => ({
        title: row.title,
        pageLabel: row.pageLabel,
        physicalPageNumber: row.physicalPageNumber
      })),
      ...originalOutline.map((item) => ({
        title: item.title,
        pageLabel: null,
        physicalPageNumber: item.pageNumber
      }))
    ],
    searchOutline: searchExtraction.outline.map((item) => ({
      title: item.title,
      pageNumber: item.pageNumber
    })),
    visualMatches
  });
  const preservedMappings = await db.select({
    searchPhysicalPageNumber: knowledgePageMappings.searchPhysicalPageNumber,
    originalPhysicalPageNumber: knowledgePages.physicalPageNumber,
    verified: knowledgePageMappings.verified,
    confidence: knowledgePageMappings.confidence,
    mappingMethod: knowledgePageMappings.mappingMethod
  }).from(knowledgePageMappings)
    .innerJoin(knowledgePages, eq(knowledgePages.id, knowledgePageMappings.originalPageId))
    .where(and(
      eq(knowledgePageMappings.versionId, context.versionId),
      sql`(${knowledgePageMappings.mappingMethod} = 'MANUAL' or ${knowledgePageMappings.verified} = true)`
    ));
  const mappingBySearchPage = new Map<number, number>();
  for (const mapping of [...mappings.map((item) => ({
    searchPhysicalPageNumber: item.searchPhysicalPageNumber,
    originalPhysicalPageNumber: item.originalPhysicalPageNumber,
    verified: false,
    confidence: item.confidence
  })), ...preservedMappings]) {
    if (mapping.verified || (mapping.confidence != null && mapping.confidence >= env.KNOWLEDGE_MAPPING_MIN_AI_CONFIDENCE)) {
      mappingBySearchPage.set(mapping.searchPhysicalPageNumber, mapping.originalPhysicalPageNumber);
    }
  }

  await db.update(knowledgeDocumentVersions).set({ pipelineStatus: "CHUNKING", updatedAt: new Date() })
    .where(eq(knowledgeDocumentVersions.id, context.versionId));
  await job.updateProgress(60);

  const result = await db.transaction(async (tx) => {
    const written = await writeKnowledgeContent(tx, {
      documentId: version.documentId,
      versionId: context.versionId,
      versionTitle: version.title,
      projectId: documentRow.projectId,
      aliases,
      evidenceLevel: version.evidenceLevel,
      originalPages,
      contentPages: searchExtraction.pages.map((text, index) => ({
        physical: index + 1,
        text,
        // 不按物理页硬对齐；未映射内容不进入可引用索引。
        targetPhysical: mappingBySearchPage.get(index + 1) ?? null
      })),
      sheets: null,
      contentFromSearchSource: true
    });
    if (originalOutline.length > 0) {
      await writeTocFromOutline(tx, {
        documentId: version.documentId,
        versionId: context.versionId,
        outline: originalOutline,
        source: "PDF_BOOKMARK",
        maxPage: originalTotalPages
      });
    }
    const originalPageIdByPhysical = new Map<number, string>();
    const pageRows = await tx.select({ id: knowledgePages.id, physicalPageNumber: knowledgePages.physicalPageNumber })
      .from(knowledgePages).where(eq(knowledgePages.versionId, context.versionId));
    for (const row of pageRows) originalPageIdByPhysical.set(row.physicalPageNumber, row.id);
    const mappingCount = await writePageMappings(tx, {
      documentId: version.documentId,
      versionId: context.versionId,
      mappings,
      originalPageIdByPhysical
    });
    if (searchExtraction.outline.length > 0) {
      await writeTocFromOutline(tx, {
        documentId: version.documentId,
        versionId: context.versionId,
        outline: searchExtraction.outline,
        source: "COMPANION_FILE",
        maxPage: searchExtraction.pages.length
      });
    }
    await tx.update(knowledgeDocumentVersions).set({
      parseStatus: "NO_TEXT_LAYER",
      pageCount: written.pageCount,
      parser: "unpdf+search_source",
      ...(context.preservePublishedStatus && version.status === "PUBLISHED"
        ? {}
        : { pipelineStatus: "REVIEW_PENDING" as const }),
      updatedAt: new Date()
    }).where(eq(knowledgeDocumentVersions.id, context.versionId));
    await tx.update(files).set({ status: "READY", errorMessage: null, updatedAt: new Date() })
      .where(eq(files.id, context.fileId));
    return { written, mappingCount };
  });

  await db.update(parsingJobs).set({
    status: "COMPLETED", progress: 100,
    result: {
      status: "READY_DUAL_SOURCE", versionId: context.versionId,
      pageCount: result.written.pageCount, chunkCount: result.written.chunkCount,
      searchPageCount: searchExtraction.pages.length,
      mappedPages: result.mappingCount,
      verifiedMappings: 0
    },
    finishedAt: new Date(), updatedAt: new Date()
  }).where(eq(parsingJobs.id, context.parsingJobId));
  await job.updateProgress(100);
  const [originalFile] = await db.select({ objectKey: files.objectKey }).from(files).where(eq(files.id, context.fileId)).limit(1);
  if (originalFile) {
    await renderOriginalPreviews(db, storage, { versionId: context.versionId, objectKey: originalFile.objectKey });
  }
  return { status: "READY_DUAL_SOURCE" };
}

/** 无文本层且无可用检索源：NOT 解析失败 —— 页面行 + 预览照常产出，版本进入待补检索源状态 */
async function finishNoSearchSource(
  context: ParseContext,
  originalPageDetails: PdfExtractedPage[],
  version: typeof knowledgeDocumentVersions.$inferSelect,
  reason: string
): Promise<Record<string, unknown>> {
  const { db, job } = context;
  const aliases = await loadActiveAliases(db);
  const originalPages: OriginalPageInput[] = originalPageDetails.map((page) => ({
    physical: page.pageNumber,
    label: page.pageLabel,
    labelSource: page.pageLabelSource ?? undefined,
    labelConfidence: page.pageLabelConfidence ?? null,
    text: null
  }));
  const written = await db.transaction(async (tx) => {
    const result = await writeKnowledgeContent(tx, {
      documentId: version.documentId,
      versionId: context.versionId,
      versionTitle: version.title,
      projectId: null,
      aliases,
      evidenceLevel: version.evidenceLevel,
      originalPages,
      contentPages: [],
      sheets: null
    });
    await tx.update(knowledgeDocumentVersions).set({
      parseStatus: "SEARCH_SOURCE_REQUIRED",
      pageCount: result.pageCount,
      parser: "unpdf",
      ...(context.preservePublishedStatus && version.status === "PUBLISHED"
        ? {}
        : { pipelineStatus: "REVIEW_PENDING" as const }),
      updatedAt: new Date()
    }).where(eq(knowledgeDocumentVersions.id, context.versionId));
    await tx.update(files).set({ status: "READY", errorMessage: null, updatedAt: new Date() })
      .where(eq(files.id, context.fileId));
    return result;
  });
  await db.update(parsingJobs).set({
    status: "COMPLETED", progress: 100,
    result: {
      status: "SEARCH_SOURCE_REQUIRED", versionId: context.versionId,
      pageCount: written.pageCount, message: reason
    },
    finishedAt: new Date(), updatedAt: new Date()
  }).where(eq(parsingJobs.id, context.parsingJobId));
  await job.updateProgress(100);
  const { storage } = context;
  const [originalFile] = await db.select({ objectKey: files.objectKey }).from(files).where(eq(files.id, context.fileId)).limit(1);
  if (originalFile) {
    await renderOriginalPreviews(db, storage, { versionId: context.versionId, objectKey: originalFile.objectKey });
  }
  return { status: "SEARCH_SOURCE_REQUIRED" };
}

async function handleParseJob(
  db: Database,
  storage: ObjectStorage,
  job: Job<DocumentJobData>,
  parsingJobId: string,
  fileId: string,
  versionId: string,
  options: { preservePublishedStatus?: boolean } = {}
): Promise<Record<string, unknown>> {
  const context: ParseContext = { db, storage, job, parsingJobId, versionId, fileId, ...options };
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
    const [version] = await db.select().from(knowledgeDocumentVersions).where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
    if (!version) throw new Error("文档版本不存在");
    const [documentRow] = await db.select({ projectId: knowledgeDocuments.projectId }).from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, version.documentId)).limit(1);

    // PDF：先判定文本层。转曲/扫描件不是解析失败，进入 NO_TEXT_LAYER / 双源链路
    if (mimeType === "application/pdf") {
      const extraction = await extractPdfDocumentInWorker(data, logPdfProgress(file.id));
      const totalTextLength = extraction.pages.reduce((sum, text) => sum + text.trim().length, 0);
      const parsed: ParsedDocument = {
        parser: "unpdf",
        pages: extraction.pageDetails.map((page) => ({
          page: page.pageNumber,
          text: page.text,
          label: page.pageLabel,
          labelSource: page.pageLabelSource ?? undefined,
          labelConfidence: page.pageLabelConfidence
        }))
      };
      if (isNoTextLayer(totalTextLength)) {
        const [searchAsset] = await db.select({ id: knowledgeDocumentAssets.id, fileId: knowledgeDocumentAssets.fileId })
          .from(knowledgeDocumentAssets)
          .where(and(
            eq(knowledgeDocumentAssets.versionId, versionId),
            eq(knowledgeDocumentAssets.role, "SEARCH_SOURCE")
          )).limit(1);
        if (searchAsset) {
          return await parseDualSource(context, extraction.pageDetails, extraction.outline, version, { projectId: documentRow?.projectId ?? null }, searchAsset);
        }
        return await finishNoSearchSource(context, extraction.pageDetails, version, "原文件没有文本层，请绑定检索文本源后重新解析，或以浏览版（BROWSE_ONLY）发布");
      }
      return await parseSingleSource(context, parsed, extraction.outline, version, { projectId: documentRow?.projectId ?? null });
    }

    // 非 PDF（DOCX/XLSX/不支持）：维持既有判定
    const parsed = await parseDocument(data, mimeType, logPdfProgress(file.id));
    const totalTextLength = parsed.pages.reduce((sum, page) => sum + page.text.trim().length, 0);
    const needsOcr = parsed.parser === "ocr_required" || parsed.parser === "unsupported_doc"
      || ((parsed.parser === "unpdf" || parsed.parser === "mammoth") && totalTextLength < 20)
      || (parsed.parser === "exceljs" && parsed.pages.every((page) => !page.text.trim()));
    if (needsOcr) {
      const reason = parsed.parser === "unsupported_doc"
        ? "该文件格式暂不支持（.doc/.xls 老格式，请转换后重传）"
        : "文件缺少可提取文本，需要 OCR 处理";
      await db.update(files).set({ status: "OCR_REQUIRED", errorMessage: reason, updatedAt: new Date() }).where(eq(files.id, fileId));
      await db.update(knowledgeDocumentVersions).set({ parseStatus: "OCR_REQUIRED", pipelineStatus: "FAILED", updatedAt: new Date() })
        .where(eq(knowledgeDocumentVersions.id, versionId));
      await db.update(parsingJobs).set({
        status: "OCR_REQUIRED", progress: 100,
        result: { status: "OCR_REQUIRED", message: reason },
        finishedAt: new Date(), updatedAt: new Date()
      }).where(eq(parsingJobs.id, parsingJobId));
      return { status: "OCR_REQUIRED" };
    }
    return await parseSingleSource(context, parsed, [], version, { projectId: documentRow?.projectId ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "文档解析失败";
    await reconcileDocumentJobFailure(db, job.data, message, job.attemptsMade + 1);
    await notifyKnowledgeParseFailure(db, job.data, message);
    throw error;
  }
}

/** 知识库链路切片重建：只读取该版本页面原文重新切块，不重新解析文件（不产出预览/TOC） */
async function handleChunkRebuild(
  db: Database,
  storage: ObjectStorage,
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
    const originalPages: OriginalPageInput[] = pageRows.map((page) => ({
      physical: page.physicalPageNumber ?? page.pageNumber,
      label: page.pageLabel ?? null,
      labelSource: page.pageLabelSource,
      labelConfidence: page.pageLabelConfidence,
      text: page.parsedText
    }));
    const [searchAsset] = await db.select({ fileId: knowledgeDocumentAssets.fileId })
      .from(knowledgeDocumentAssets)
      .where(and(
        eq(knowledgeDocumentAssets.versionId, versionId),
        eq(knowledgeDocumentAssets.role, "SEARCH_SOURCE")
      )).limit(1);
    let contentPages: ContentPageInput[] = pageRows
      .filter((page) => (page.parsedText ?? "").trim().length > 0)
      .map((page) => ({
        physical: page.physicalPageNumber ?? page.pageNumber,
        text: page.parsedText ?? "",
        targetPhysical: page.physicalPageNumber ?? page.pageNumber
      }));
    let contentFromSearchSource = false;
    // 双源版本的 ORIGINAL 页面通常没有 parsedText；重建时必须重新读取 SEARCH_SOURCE，
    // 并仅使用已有映射回溯到 ORIGINAL 页面。
    if (searchAsset) {
        const [searchFile] = await db.select({ objectKey: files.objectKey, mimeType: files.mimeType })
          .from(files).where(eq(files.id, searchAsset.fileId)).limit(1);
        if (searchFile?.mimeType === "application/pdf") {
          const extraction = await extractPdfDocumentInWorker(await storage.getObject(searchFile.objectKey));
          const mappings = await db.select({
            searchPhysicalPageNumber: knowledgePageMappings.searchPhysicalPageNumber,
            originalPhysicalPageNumber: knowledgePages.physicalPageNumber,
            verified: knowledgePageMappings.verified,
            confidence: knowledgePageMappings.confidence
          }).from(knowledgePageMappings)
            .innerJoin(knowledgePages, eq(knowledgePages.id, knowledgePageMappings.originalPageId))
            .where(and(
              eq(knowledgePageMappings.versionId, versionId),
              sql`(${knowledgePageMappings.verified} = true or ${knowledgePageMappings.confidence} >= ${env.KNOWLEDGE_MAPPING_MIN_AI_CONFIDENCE})`
            ));
          const originalBySearchPage = new Map(mappings.map((row) => [row.searchPhysicalPageNumber, row.originalPhysicalPageNumber]));
          contentPages = extraction.pages.map((text, index) => ({
            physical: index + 1,
            text,
            targetPhysical: originalBySearchPage.get(index + 1) ?? null
          }));
          contentFromSearchSource = true;
        }
    }
    const result = await db.transaction(async (tx) => {
      const written = await writeKnowledgeContent(tx, {
        documentId: version.documentId,
        versionId,
        versionTitle: version.title,
        projectId: document?.projectId ?? null,
        aliases,
        evidenceLevel: version.evidenceLevel,
        originalPages,
        contentPages,
        sheets: null,
        contentFromSearchSource
      });
      await tx.update(knowledgeDocumentVersions).set(
        // 已发布版本的 Wiki 层重建（历史资料升级）只重写派生内容，不把管线状态降级回 REVIEW_PENDING
        version.status === "PUBLISHED"
          ? { updatedAt: new Date() }
          : { pipelineStatus: "REVIEW_PENDING", updatedAt: new Date() }
      )
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
    await notifyKnowledgeParseFailure(db, job.data, message);
    throw error;
  }
}

/**
 * 既有文件链路任务（async_tasks + files）：仅创建待审核草稿版本，
 * 与版本化解析、双源绑定、审核发布流程保持一致，绝不绕过发布门禁。
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
      const [version] = await tx.insert(knowledgeDocumentVersions).values({
        documentId: document!.id,
        version: file.version,
        fileId: file.id,
        title: file.originalName,
        status: "DRAFT",
        pipelineStatus: "REVIEW_PENDING",
        parseStatus: "PARSED",
        pageCount: parsed.pages.length,
        parser: parsed.parser
      }).returning();
      await tx.insert(knowledgeDocumentAssets).values({
        documentId: document!.id,
        versionId: version!.id,
        fileId: file.id,
        role: "ORIGINAL",
        isPrimary: true
      }).onConflictDoNothing();
      const written = await writeKnowledgeContent(tx, {
        documentId: document!.id,
        versionId: version!.id,
        versionTitle: version!.title,
        projectId: file.projectId,
        aliases,
        evidenceLevel: null,
        originalPages: parsed.pages.map((page) => ({
          physical: page.page ?? 0,
          label: page.label ?? null,
          labelSource: page.labelSource ?? "FALLBACK",
          labelConfidence: page.labelConfidence ?? null,
          text: page.text
        })),
        contentPages: parsed.pages
          .filter((page) => page.page != null)
          .map((page) => ({ physical: page.page!, text: page.text, targetPhysical: page.page! })),
        sheets: parsed.sheets ?? null
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
      return handleChunkRebuild(db, storage, job, parsingJobId, versionId);
    }
    if (jobType === "UPGRADE_PARSE") {
      // 升级解析：重读 ORIGINAL（+检索源）重跑完整链路，已发布版本不降级状态
      const [version] = await db.select({ fileId: knowledgeDocumentVersions.fileId })
        .from(knowledgeDocumentVersions).where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
      const [asset] = await db.select({ fileId: knowledgeDocumentAssets.fileId })
        .from(knowledgeDocumentAssets)
        .where(and(eq(knowledgeDocumentAssets.versionId, versionId), eq(knowledgeDocumentAssets.role, "ORIGINAL")))
        .limit(1);
      const originalFileId = asset?.fileId ?? version?.fileId ?? fileId;
      return handleParseJob(db, storage, job, parsingJobId, originalFileId, versionId, { preservePublishedStatus: true });
    }
    return handleParseJob(db, storage, job, parsingJobId, fileId, versionId);
  };
}

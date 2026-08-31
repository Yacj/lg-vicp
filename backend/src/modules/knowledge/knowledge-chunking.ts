import { normalizeSearchText } from "./knowledge.normalize.js";

/**
 * 知识库分块纯函数：按页切块、章节标题检测、表格/条款锚点提取、词典关键词标注。
 * 全部为确定性规则（正则 + 词典包含匹配），不做 NLP 分词，便于单元测试与审计。
 */

export const CHUNK_MAX_LENGTH = 1200;
export const CHUNK_OVERLAP = 150;

export type ChunkContentType =
  | "PARAGRAPH"
  | "TITLE"
  | "SECTION"
  | "CLAUSE"
  | "TABLE"
  | "NOTE"
  | "FORMULA"
  | "IMAGE_CAPTION";

export interface AliasDictEntry {
  term: string;
  alias: string;
}

export interface ExtractedChunk {
  content: string;
  sourcePage: number | null;
  pageEnd: number | null;
  headingLevel: number;
  contentType: ChunkContentType;
  sourceSection: string | null;
  searchText: string;
  keywords: string[];
  aliasTerms: string[];
  citationAnchor: string | null;
  /** 结构化元数据（表格行列/工作表/合并单元格等），落库到 knowledge_chunks.metadata */
  metadata?: Record<string, unknown>;
}

export interface ParsedPageInput {
  page: number | null;
  text: string;
}

/** 按句号/换行边界切块，保证块间少量重叠，避免切断句子。 */
export function splitText(text: string, maxLength = CHUNK_MAX_LENGTH, overlap = CHUNK_OVERLAP): string[] {
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

export interface DetectedHeading {
  level: number;
  title: string;
  isClause: boolean;
  anchor: string | null;
}

const HEADING_PATTERNS: ReadonlyArray<{ regex: RegExp; level: number; isClause: boolean }> = [
  // 第X章 / 第X篇 / 附录
  { regex: /^第\s*[0-9一二三四五六七八九十百零]+[章篇]\s*/, level: 1, isClause: false },
  // 数字编号章节：1 / 1.1 / 1.1.1 / 1.1.1.1
  { regex: /^\d+(\.\d+){1,3}\s*/, level: 0, isClause: false },
  // 中文编号条/项：一、 / 1、
  { regex: /^[一二三四五六七八九十]+、\s*/, level: 3, isClause: false },
  // 第X条（条款内容整行作为 CLAUSE 块，不截断）
  { regex: /^第\s*\d+(?:\.\d+)*\s*条/, level: 3, isClause: true }
];

/** 检测一行是否为章节标题；数字编号按层级段数推算（1→1 级，1.1→2 级）。 */
export function detectHeading(line: string): DetectedHeading | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  for (const pattern of HEADING_PATTERNS) {
    const match = pattern.regex.exec(trimmed);
    if (!match) continue;
    let level = pattern.level;
    if (pattern.level === 0) {
      const segments = match[0].trim().split(".").filter(Boolean).length;
      level = Math.min(segments, 4);
    }
    const title = trimmed.replace(pattern.regex, "").trim().slice(0, 60);
    if (!title) return null;
    const anchor = pattern.isClause ? match[0].replace(/\s+/g, "") : null;
    return { level, title, isClause: pattern.isClause, anchor };
  }
  return null;
}

const ANCHOR_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:表|图)\s*\d+(?:[-.]\s*\d+)*/g,
  /第\s*\d+(?:\.\d+)*\s*条/g
];

/** 提取表格/图片编号与条款号引用锚点，如"表3.2-1"、"第4.1.2条"。 */
export function extractAnchors(text: string): string[] {
  const anchors: string[] = [];
  for (const pattern of ANCHOR_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const anchor = match[0].replace(/\s+/g, "");
      if (!anchors.includes(anchor)) anchors.push(anchor);
    }
  }
  return anchors;
}

export interface KeywordExtraction {
  keywords: string[];
  aliasTerms: string[];
}

/** 用别名词典做包含匹配：命中别名记录原文，规范词进入关键词。词典命中 + 编号正则，不做 NLP。 */
export function extractKeywords(text: string, aliases: ReadonlyArray<AliasDictEntry>): KeywordExtraction {
  const keywords: string[] = [];
  const aliasTerms: string[] = [];
  const seen = new Set<string>();
  for (const entry of aliases) {
    if (text.includes(entry.alias) && !seen.has(entry.alias)) {
      seen.add(entry.alias);
      aliasTerms.push(entry.alias);
      if (entry.term && !keywords.includes(entry.term)) keywords.push(entry.term);
    }
  }
  return { keywords, aliasTerms };
}

// ---------------------------------------------------------------- 表格区域

export interface TableRegion {
  startLine: number;
  endLine: number;
  anchor: string | null;
}

const TABLE_ANCHOR_RE = /^表\s*\d+(?:[-.]\s*\d+)*/;

/** 疑似表格行：含竖线/制表符，或 3 段以上空白分隔的单元格，或以数字起始的多列数据行 */
function looksLikeTableRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/[|│]/.test(trimmed) || trimmed.includes("\t")) return true;
  const cells = trimmed.split(/\s{2,}/).filter(Boolean);
  if (cells.length >= 3) return true;
  return /^\d+(\.\d+)?\s+\d/.test(trimmed);
}

/**
 * 检测文本流中的表格行区间：以"表X-X"标题行起始，后续连续表格行并入，
 * 遇到章节标题或连续两行非表格行则结束。表格区间整体独立成块，不与相邻条文混块。
 */
export function detectTableRegions(lines: string[]): TableRegion[] {
  const regions: TableRegion[] = [];
  let start = -1;
  let anchor: string | null = null;
  let nonTableStreak = 0;

  const close = (endLine: number) => {
    if (start >= 0 && endLine > start) regions.push({ startLine: start, endLine, anchor });
    start = -1;
    anchor = null;
    nonTableStreak = 0;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (start < 0) {
      const match = TABLE_ANCHOR_RE.exec(line.trim());
      if (match && !detectHeading(line)) {
        start = index;
        anchor = match[0].replace(/\s+/g, "");
        nonTableStreak = 0;
      }
      continue;
    }
    if (detectHeading(line)) {
      close(index - 1);
      continue;
    }
    // 表注（"注：..."）是表格组成部分，重置非表格行计数，不中断区域
    if (/^注\s*[:：]/.test(line.trim())) {
      nonTableStreak = 0;
    } else if (line.trim() === "" || !looksLikeTableRow(line)) {
      nonTableStreak += 1;
    } else {
      nonTableStreak = 0;
    }
    if (nonTableStreak >= 2) close(index - nonTableStreak);
  }
  if (start >= 0) {
    const endLine = lines.length - 1 - nonTableStreak;
    if (endLine > start) regions.push({ startLine: start, endLine, anchor });
  }
  return regions;
}

// ---------------------------------------------------------------- 电子表格

export interface SheetCell {
  col: number;
  value: string;
}

export interface SheetData {
  name: string;
  rows: SheetCell[][];
  mergedCells: Array<{ rowStart: number; rowEnd: number; colStart: number; colEnd: number }>;
}

/** 按行构建表格分块：每行一个 TABLE 块，元数据保留工作表名、行列范围与合并单元格信息 */
export function buildChunksFromSheet(sheet: SheetData, aliases: ReadonlyArray<AliasDictEntry> = []): ExtractedChunk[] {
  const output: ExtractedChunk[] = [];
  for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex++) {
    const cells = sheet.rows[rowIndex]!;
    if (cells.length === 0) continue;
    const content = cells.map((cell) => cell.value).join("\t").trim();
    if (!content) continue;
    const { keywords, aliasTerms } = extractKeywords(content, aliases);
    const mergedHere = sheet.mergedCells.filter((merge) => merge.rowStart <= rowIndex && merge.rowEnd >= rowIndex);
    output.push({
      content,
      sourcePage: null,
      pageEnd: null,
      headingLevel: 0,
      contentType: "TABLE",
      sourceSection: sheet.name,
      searchText: normalizeSearchText(content),
      keywords,
      aliasTerms,
      citationAnchor: null,
      metadata: {
        sheet: sheet.name,
        rowIndex,
        colStart: cells[0]!.col,
        colEnd: cells[cells.length - 1]!.col,
        mergedCells: mergedHere.map((merge) => ({
          rowStart: merge.rowStart,
          rowEnd: merge.rowEnd,
          colStart: merge.colStart,
          colEnd: merge.colEnd
        }))
      }
    });
  }
  return output;
}

/**
 * 按页构建分块：检测章节标题行（生成 TITLE/SECTION 块并切换当前章节），
 * 表格区域（"表X-X"起始的连续表格行）整体独立成 TABLE 块不与条文混块，
 * 其余文本累积后按 splitText 切块。条款/图片仅打标记与锚点，不抽取结构。
 *
 * 兼容包装：内部走「页面 → 内容块 → 辅助 Chunk」的新管线（parsePageToBlocks + buildChunksFromBlocks），
 * 保证 Wiki 阅读层（Block）与辅助索引（Chunk)永远同源。
 */
export function buildChunksFromPages(
  pages: ReadonlyArray<ParsedPageInput>,
  aliases: ReadonlyArray<AliasDictEntry> = []
): ExtractedChunk[] {
  const state: PageBlockScanState = createPageBlockScanState();
  const blocks: BlockDraft[] = [];
  for (const page of pages) blocks.push(...parsePageToBlocks(page, aliases, state));
  return buildChunksFromBlocks(blocks);
}

// ---------------------------------------------------------------- 页面内容块（Wiki 阅读层，Block 级 Section 归属）

/** 页面内容块草稿：Wiki 阅读层最小单位（标题/段落/表格/条款），携带所属语义章节的标题路径 */
export interface BlockDraft {
  content: string;
  contentType: ChunkContentType;
  sourcePage: number | null;
  headingLevel: number;
  /** 所属语义章节的标题路径（不含文档标题根）；标题行自身为路径末项；空数组 = 文档根章节 */
  sectionDraftPath: string[];
  /** chunk.sourceSection 兼容字段：最近一个标题（含条款标题），与旧分块行为一致 */
  lastHeadingTitle: string | null;
  sourceAnchor: string | null;
  searchText: string;
  keywords: string[];
  aliasTerms: string[];
  metadata?: Record<string, unknown>;
}

/** 跨页扫描状态：章节标题栈在多页之间延续（Section 跨页是常态） */
export interface PageBlockScanState {
  /** 语义章节栈（不含条款标题，与章节树一致） */
  stack: Array<{ title: string; level: number }>;
  /** 最近一个标题（含条款标题），用于 chunk.sourceSection 兼容 */
  lastHeadingTitle: string | null;
}

export function createPageBlockScanState(): PageBlockScanState {
  return { stack: [], lastHeadingTitle: null };
}

/**
 * 单页 → 内容块序列：
 * 逐行扫描，遇到标题切换 activeSection（后续 Block 记录当前 Section），
 * 下一标题出现后再切换——同页多个小节各自归属，不再整页绑定一个 Section。
 * 表格区域整体独立成 TABLE 块；条款行整行为 CLAUSE 块。
 */
export function parsePageToBlocks(
  page: ParsedPageInput,
  aliases: ReadonlyArray<AliasDictEntry>,
  state: PageBlockScanState
): BlockDraft[] {
  const output: BlockDraft[] = [];
  const currentPath = (): string[] => state.stack.map((item) => item.title);

  const lines = page.text.split("\n");
  const regions = detectTableRegions(lines);
  const regionByLine = new Map<number, TableRegion>();
  for (const region of regions) {
    for (let index = region.startLine; index <= region.endLine; index++) regionByLine.set(index, region);
  }

  const acc: { lines: string[] } = { lines: [] };
  const flushAccumulator = () => {
    const buffer = acc.lines.join("\n").trim();
    acc.lines = [];
    if (!buffer) return;
    const path = currentPath();
    for (const piece of splitText(buffer)) {
      if (!piece) continue;
      const { keywords, aliasTerms } = extractKeywords(piece, aliases);
      output.push({
        content: piece,
        contentType: path.length > 0 ? "SECTION" : "PARAGRAPH",
        sourcePage: page.page,
        headingLevel: state.stack.length > 0 ? Math.max(1, state.stack.length) : 0,
        sectionDraftPath: path,
        lastHeadingTitle: state.lastHeadingTitle,
        sourceAnchor: extractAnchors(piece)[0] ?? null,
        searchText: normalizeSearchText(piece),
        keywords,
        aliasTerms
      });
    }
  };

  let index = 0;
  while (index < lines.length) {
    const region = regionByLine.get(index);
    if (region) {
      flushAccumulator();
      const tableLines = lines.slice(region.startLine, region.endLine + 1);
      const content = tableLines.join("\n").trim();
      if (content) {
        const { keywords, aliasTerms } = extractKeywords(content, aliases);
        output.push({
          content,
          contentType: "TABLE",
          sourcePage: page.page,
          headingLevel: 0,
          sectionDraftPath: currentPath(),
          lastHeadingTitle: state.lastHeadingTitle,
          sourceAnchor: region.anchor,
          searchText: normalizeSearchText(content),
          keywords,
          aliasTerms,
          metadata: { tableRegion: { startLine: region.startLine, endLine: region.endLine } }
        });
      }
      index = region.endLine + 1;
      continue;
    }

    const line = lines[index]!;
    const heading = detectHeading(line);
    if (heading) {
      flushAccumulator();
      const { keywords, aliasTerms } = extractKeywords(heading.title, aliases);
      // 条款行整行保留作为 CLAUSE 块；其余标题行作为 TITLE/SECTION 块
      const clauseContent = heading.isClause ? line.trim() : heading.title;
      // 先更新章节栈（同层标题弹栈），标题块归属它打开的章节；条款标题不进栈，保持当前章节
      if (!heading.isClause) {
        while (state.stack.length > 0 && state.stack[state.stack.length - 1]!.level >= Math.max(1, heading.level)) {
          state.stack.pop();
        }
        state.stack.push({ title: heading.title, level: Math.max(1, heading.level) });
      }
      const headingPath = currentPath();
      output.push({
        content: clauseContent,
        contentType: heading.isClause ? "CLAUSE" : heading.level <= 2 ? "TITLE" : "SECTION",
        sourcePage: page.page,
        headingLevel: heading.level,
        sectionDraftPath: headingPath,
        lastHeadingTitle: heading.title,
        sourceAnchor: heading.anchor,
        searchText: normalizeSearchText(clauseContent),
        keywords,
        aliasTerms
      });
      state.lastHeadingTitle = heading.title;
    } else {
      acc.lines.push(line);
    }
    index += 1;
  }
  flushAccumulator();
  return output;
}

/** 章节草稿：由内容块的章节路径按首次出现顺序聚合（替代旧 buildWikiStructure 的整页猜测） */
export interface SectionDraft {
  sectionKey: string;
  title: string;
  level: number;
  /** 完整标题路径（首项 = 文档版本标题，与旧 headingPath 兼容） */
  headingPath: string[];
  sortOrder: number;
  startPage: number | null;
  endPage: number | null;
  searchText: string;
}

/**
 * 由内容块聚合章节草稿：文档根章节恒为首项（path 为空的块挂在根下）；
 * startPage/endPage 取该章节下内容块的最小/最大页；不依赖任何"目录猜测"。
 */
export function buildSectionDrafts(versionTitle: string, blocks: ReadonlyArray<BlockDraft>): SectionDraft[] {
  const rootTitle = versionTitle.slice(0, 255) || "文档正文";
  const drafts = new Map<string, SectionDraft>();
  const rootKey = "root";
  drafts.set(rootKey, {
    sectionKey: rootKey,
    title: rootTitle,
    level: 1,
    headingPath: [rootTitle],
    sortOrder: 0,
    startPage: null,
    endPage: null,
    searchText: normalizeSectionTitleText(rootTitle)
  });

  let nextSortOrder = 1;
  let firstBlockPage: number | null = null;
  let lastBlockPage: number | null = null;
  for (const block of blocks) {
    if (block.sourcePage != null) {
      if (firstBlockPage == null || block.sourcePage < firstBlockPage) firstBlockPage = block.sourcePage;
      if (lastBlockPage == null || block.sourcePage > lastBlockPage) lastBlockPage = block.sourcePage;
    }
  }
  for (const block of blocks) {
    const path = block.sectionDraftPath;
    const key = path.length === 0 ? rootKey : path.join("/");
    let draft = drafts.get(key);
    if (!draft) {
      draft = {
        sectionKey: key,
        title: path[path.length - 1]!.slice(0, 255),
        level: Math.max(1, path.length),
        headingPath: [rootTitle, ...path.map((item) => item.slice(0, 255))],
        sortOrder: nextSortOrder,
        startPage: block.sourcePage,
        endPage: block.sourcePage,
        searchText: normalizeSectionTitleText([rootTitle, ...path].join(" "))
      };
      drafts.set(key, draft);
      nextSortOrder += 1;
    }
    if (block.sourcePage != null) {
      if (draft.startPage == null || block.sourcePage < draft.startPage) draft.startPage = block.sourcePage;
      if (draft.endPage == null || block.sourcePage > draft.endPage) draft.endPage = block.sourcePage;
    }
  }
  const root = drafts.get(rootKey);
  if (root) {
    // 根章节（无标题路径的散落内容）覆盖整份文档的页码区间
    root.startPage = firstBlockPage;
    root.endPage = lastBlockPage;
  }
  return [...drafts.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

function normalizeSectionTitleText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * 由内容块派生辅助检索 Chunk（Chunk 仅是 Block 的辅助索引，不是独立知识单位）：
 * 超长段落按 splitText 切分（保持旧 1200/150 语义），TABLE/标题/条款块 1:1。
 */
export function buildChunksFromBlocks(blocks: ReadonlyArray<BlockDraft>): ExtractedChunk[] {
  const output: ExtractedChunk[] = [];
  for (const block of blocks) {
    const sourceSection = block.sectionDraftPath.length > 0
      ? block.sectionDraftPath[block.sectionDraftPath.length - 1]!
      : block.lastHeadingTitle;
    if (block.contentType === "PARAGRAPH" || block.contentType === "SECTION") {
      const pieces = splitText(block.content);
      for (const piece of pieces) {
        if (!piece) continue;
        output.push({
          content: piece,
          sourcePage: block.sourcePage,
          pageEnd: block.sourcePage,
          headingLevel: block.headingLevel,
          contentType: block.contentType,
          sourceSection: sourceSection ?? null,
          searchText: normalizeSearchText(piece),
          keywords: block.keywords,
          aliasTerms: block.aliasTerms,
          citationAnchor: block.sourceAnchor,
          metadata: block.metadata
        });
      }
      continue;
    }
    output.push({
      content: block.content,
      sourcePage: block.sourcePage,
      pageEnd: block.sourcePage,
      headingLevel: block.headingLevel,
      contentType: block.contentType,
      sourceSection: sourceSection ?? null,
      searchText: block.searchText,
      keywords: block.keywords,
      aliasTerms: block.aliasTerms,
      citationAnchor: block.sourceAnchor,
      metadata: block.metadata
    });
  }
  return output;
}
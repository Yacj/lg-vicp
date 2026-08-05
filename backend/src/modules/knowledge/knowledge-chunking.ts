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

interface Accumulator {
  lines: string[];
  section: string | null;
  headingLevel: number;
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

function flushAccumulator(
  acc: Accumulator,
  page: ParsedPageInput,
  aliases: ReadonlyArray<AliasDictEntry>,
  output: ExtractedChunk[]
): void {
  const buffer = acc.lines.join("\n").trim();
  if (!buffer) return;
  const pieces = splitText(buffer);
  for (const piece of pieces) {
    if (!piece) continue;
    const { keywords, aliasTerms } = extractKeywords(piece, aliases);
    const anchors = extractAnchors(piece);
    output.push({
      content: piece,
      sourcePage: page.page,
      pageEnd: page.page,
      headingLevel: acc.headingLevel,
      contentType: acc.section ? "SECTION" : "PARAGRAPH",
      sourceSection: acc.section,
      searchText: normalizeSearchText(piece),
      keywords,
      aliasTerms,
      citationAnchor: anchors[0] ?? null
    });
  }
}

/**
 * 按页构建分块：检测章节标题行（生成 TITLE/SECTION 块并切换当前章节），
 * 表格区域（"表X-X"起始的连续表格行）整体独立成 TABLE 块不与条文混块，
 * 其余文本累积后按 splitText 切块。条款/图片仅打标记与锚点，不抽取结构。
 */
export function buildChunksFromPages(
  pages: ReadonlyArray<ParsedPageInput>,
  aliases: ReadonlyArray<AliasDictEntry> = []
): ExtractedChunk[] {
  const output: ExtractedChunk[] = [];
  for (const page of pages) {
    const lines = page.text.split("\n");
    const regions = detectTableRegions(lines);
    const regionByLine = new Map<number, TableRegion>();
    for (const region of regions) {
      for (let index = region.startLine; index <= region.endLine; index++) regionByLine.set(index, region);
    }

    const acc: Accumulator = { lines: [], section: null, headingLevel: 0 };
    const pushAccumulator = () => {
      flushAccumulator(acc, page, aliases, output);
      acc.lines = [];
    };

    let index = 0;
    while (index < lines.length) {
      const region = regionByLine.get(index);
      if (region) {
        pushAccumulator();
        const tableLines = lines.slice(region.startLine, region.endLine + 1);
        const content = tableLines.join("\n").trim();
        if (content) {
          const { keywords, aliasTerms } = extractKeywords(content, aliases);
          output.push({
            content,
            sourcePage: page.page,
            pageEnd: page.page,
            headingLevel: 0,
            contentType: "TABLE",
            sourceSection: acc.section,
            searchText: normalizeSearchText(content),
            keywords,
            aliasTerms,
            citationAnchor: region.anchor,
            metadata: { tableRegion: { startLine: region.startLine, endLine: region.endLine } }
          });
        }
        index = region.endLine + 1;
        continue;
      }

      const line = lines[index]!;
      const heading = detectHeading(line);
      if (heading) {
        pushAccumulator();
        const { keywords, aliasTerms } = extractKeywords(heading.title, aliases);
        // 条款行整行保留作为 CLAUSE 块；其余标题行作为 TITLE/SECTION 块
        const clauseContent = heading.isClause ? line.trim() : heading.title;
        output.push({
          content: clauseContent,
          sourcePage: page.page,
          pageEnd: page.page,
          headingLevel: heading.level,
          contentType: heading.isClause ? "CLAUSE" : heading.level <= 2 ? "TITLE" : "SECTION",
          sourceSection: heading.title,
          searchText: normalizeSearchText(clauseContent),
          keywords,
          aliasTerms,
          citationAnchor: heading.anchor
        });
        acc.section = heading.title;
        acc.headingLevel = heading.level;
      } else {
        acc.lines.push(line);
      }
      index += 1;
    }
    pushAccumulator();
  }
  return output;
}
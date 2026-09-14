/**
 * 从图集目录页解析正式 TOC。CAD Outline 被拒绝后走这一路。
 * 支持「标题 + 点线/¨ + 页码标签」以及 A/B/C… 分章父节点。
 */

export type ParsedTocSource = "PDF_BOOKMARK" | "TOC_PAGE" | "MANUAL" | "COMPANION_FILE";

export interface ParsedTocItem {
  title: string;
  level: number;
  pageLabel?: string | null;
  physicalPageNumber?: number | null;
  parentTempId?: string | null;
  source: ParsedTocSource;
  confidence: number;
}

const LEADER_CHARS = /[¨.·•…．。⋯﹣－—–_-]/g;
const PAGE_LABEL_TOKEN = /([A-Z]{1,3}\d{1,4}|\d{1,4})$/i;
const SECTION_HEADER = /^([A-H])\s+(VICP.+)$/i;
const SKIP_TITLE_RE = /(?:目录|目次|contents|主编单位|参编单位|编制单位|批准部门|蓝格利通新材)/i;
const TOC_HEADING = /目\s*录/;
const SKIP_TITLES = new Set(["目录", "目次", "contents", "toc"]);
const NOISE_LINE = /^(?:设\s*计|审\s*核|校\s*对|图\s*名|图集号|页\s*次|批准部门|批准文号|编制单位|主编单位|统一编号|施行日期|技术审定人|设计负责人|编制单位负责人|编制单位技术负责人)/;

function compactSpacedGlyphs(value: string): string {
  return value
    .replace(/(?:[\u4e00-\u9fff]\s+)+[\u4e00-\u9fff]/g, (match) => match.replace(/\s+/g, ""))
    .replace(/(?:[A-Za-z]\s+){3,}[A-Za-z]/g, (match) => match.replace(/\s+/g, ""));
}

function normalizeTitle(value: string): string {
  return compactSpacedGlyphs(value)
    .replace(LEADER_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePageLabel(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function parseTocLeaderLine(line: string): { title: string; pageLabel: string } | null {
  const compactLeaders = line.replace(/[¨.·•…．。⋯]{2,}/g, "¨¨¨").trim();
  if (!compactLeaders) return null;
  const leaderMatch = compactLeaders.match(/^(.*?)¨¨¨+\s*([A-Z]{1,3}\s*\d{1,4}|\d{1,4})\s*$/i);
  if (leaderMatch) {
    const title = normalizeTitle(leaderMatch[1] ?? "");
    const pageLabel = normalizePageLabel(leaderMatch[2] ?? "");
    if (title.length >= 2 && pageLabel) return { title, pageLabel };
  }
  const collapsed = compactLeaders.replace(LEADER_CHARS, " ").replace(/\s+/g, " ").trim();
  const token = PAGE_LABEL_TOKEN.exec(collapsed.replace(/\s+/g, ""));
  if (!token) return null;
  const rawLabel = token[1]!;
  const withoutLabel = collapsed.replace(new RegExp(`${rawLabel}\\s*$`, "i"), "").trim();
  const title = normalizeTitle(withoutLabel);
  if (title.length < 2) return null;
  if (!/[¨.·•…．。⋯]{2,}/.test(line) && withoutLabel.length > 0 && !/\s{2,}|[.]{2,}/.test(line)) {
    // 正文里偶然出现「标题 4」不应当成目录行
    return null;
  }
  return { title, pageLabel: normalizePageLabel(rawLabel) };
}

export function parseSectionHeaderLine(line: string): { title: string } | null {
  const trimmed = compactSpacedGlyphs(line.replace(LEADER_CHARS, " ").replace(/\s+/g, " ").trim());
  const match = SECTION_HEADER.exec(trimmed);
  if (!match) return null;
  if (PAGE_LABEL_TOKEN.test(trimmed.replace(/\s+/g, ""))) return null;
  const letter = match[1]!.toUpperCase();
  const rest = normalizeTitle(match[2] ?? "");
  if (rest.length < 6 || !/^VICP/i.test(rest)) return null;
  return { title: `${letter} ${rest}` };
}

export function isLikelyTocHeading(line: string): boolean {
  const compact = line.replace(/\s+/g, "");
  return compact === "目录" || compact === "目次" || /^目录$/.test(line.trim());
}

function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (NOISE_LINE.test(trimmed)) return true;
  if (/^J\/CABEE/i.test(trimmed.replace(/\s+/g, ""))) return true;
  return false;
}

export interface TocPageScore {
  physical: number;
  score: number;
  leaderCount: number;
  hasHeading: boolean;
}

/** 目录页：必须有「目录」标题，且有足够点线+页码结构，避免正文里偶然出现「目录」。 */
export function scoreTocPage(physical: number, text: string): TocPageScore {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const hasHeading = lines.slice(0, 30).some((line) => TOC_HEADING.test(line) && line.replace(/\s+/g, "").length <= 8);
  let leaderCount = 0;
  for (const line of lines) {
    if (parseTocLeaderLine(line)) leaderCount += 1;
  }
  let score = 0;
  if (hasHeading) score += 0.45;
  if (leaderCount >= 8) score += 0.4;
  else if (leaderCount >= 4) score += 0.25;
  else if (leaderCount >= 2) score += 0.1;
  const leaderRatio = lines.length === 0 ? 0 : leaderCount / lines.length;
  if (leaderRatio >= 0.25) score += 0.15;
  if (!hasHeading && leaderCount < 6) score = Math.min(score, 0.3);
  return { physical, score: Math.min(1, score), leaderCount, hasHeading };
}

export function detectTocPages(
  pages: ReadonlyArray<{ physical: number; text: string }>,
  options?: { maxScanPages?: number }
): number[] {
  const maxScan = Math.min(pages.length, options?.maxScanPages ?? 20);
  const scored = pages.slice(0, maxScan).map((page) => scoreTocPage(page.physical, page.text));
  const seeds = scored.filter((item) => item.hasHeading && item.leaderCount >= 4 && item.score >= 0.6);
  if (seeds.length === 0) {
    const fallback = scored.filter((item) => item.leaderCount >= 8 && item.score >= 0.55);
    if (fallback.length === 0) return [];
    seeds.push(fallback[0]!);
  }
  seeds.sort((a, b) => a.physical - b.physical);
  const first = seeds[0]!.physical;
  const consecutive: number[] = [first];
  const byPhysical = new Map(scored.map((item) => [item.physical, item]));
  for (let physical = first + 1; physical <= first + 8; physical++) {
    const item = byPhysical.get(physical);
    if (!item || item.leaderCount < 4) break;
    consecutive.push(physical);
  }
  return consecutive;
}

function skipTitle(title: string): boolean {
  const compact = title.replace(/\s+/g, "").toLowerCase();
  if (SKIP_TITLES.has(compact)) return true;
  if (SKIP_TITLE_RE.test(title) || SKIP_TITLE_RE.test(compact)) return true;
  return false;
}

/**
 * 从已重建阅读顺序的目录页文本解析层级 TOC。
 * 父节点：A VICP…；子节点：带 pageLabel 的条目。
 */
export function parseTocFromPageTexts(pageTexts: readonly string[]): ParsedTocItem[] {
  const rawLines = pageTexts.flatMap((text) => text.split("\n").map((line) => line.trim()).filter(Boolean));
  const merged: string[] = [];
  let pending = "";
  for (const line of rawLines) {
    if (isNoiseLine(line) || isLikelyTocHeading(line)) {
      pending = "";
      continue;
    }
    const header = parseSectionHeaderLine(line);
    const leader = parseTocLeaderLine(line);
    if (header || leader) {
      if (pending && leader && leader.title.length <= 4 && !skipTitle(leader.title)) {
        merged.push(`${pending}${leader.title}¨¨¨${leader.pageLabel}`);
      } else if (leader && !skipTitle(leader.title)) {
        merged.push(line);
      } else if (header) {
        merged.push(line);
      }
      pending = "";
      continue;
    }
    if (line.replace(LEADER_CHARS, "").trim().length >= 4 && !PAGE_LABEL_TOKEN.test(line.replace(/\s+/g, ""))) {
      pending = `${pending}${pending ? "" : ""}${normalizeTitle(line)}`;
      continue;
    }
    const onlyLeaderAndLabel = parseTocLeaderLine(`${pending}¨¨¨${line}`);
    if (pending && onlyLeaderAndLabel) {
      merged.push(`${pending}¨¨¨${onlyLeaderAndLabel.pageLabel}`);
      pending = "";
    }
  }

  const items: ParsedTocItem[] = [];
  let currentParentTempId: string | null = null;
  for (const line of merged) {
    const header = parseSectionHeaderLine(line);
    if (header && !skipTitle(header.title)) {
      items.push({
        title: header.title.slice(0, 255),
        level: 1,
        pageLabel: null,
        physicalPageNumber: null,
        parentTempId: null,
        source: "TOC_PAGE",
        confidence: 0.78
      });
      currentParentTempId = String(items.length - 1);
      continue;
    }
    const leader = parseTocLeaderLine(line);
    if (!leader || skipTitle(leader.title)) continue;
    const underSection = currentParentTempId != null;
    items.push({
      title: leader.title.slice(0, 255),
      level: underSection ? 2 : 1,
      pageLabel: leader.pageLabel,
      physicalPageNumber: null,
      parentTempId: underSection ? currentParentTempId : null,
      source: "TOC_PAGE",
      confidence: 0.88
    });
  }
  return items;
}

export function parseTocFromPages(
  pages: ReadonlyArray<{ physical: number; text: string }>
): ParsedTocItem[] {
  const tocPageNumbers = detectTocPages(pages);
  if (tocPageNumbers.length === 0) return [];
  const selected = pages.filter((page) => tocPageNumbers.includes(page.physical));
  return parseTocFromPageTexts(selected.map((page) => page.text));
}

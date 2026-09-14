import type { PdfTextItemForLabel } from "./knowledge-page-label.js";

export interface PdfLayoutTextItem extends PdfTextItemForLabel {
  fontSize?: number;
  hasEOL?: boolean;
}

export interface ReconstructedPageText {
  text: string;
  columnCount: number;
  lineCount: number;
}

const TEMPLATE_LINE = /^(?:设\s*计|审\s*核|校\s*对|图\s*名|图集号|页\s*次|审\s*定|制\s*图|校\s*核|批\s*准|J\/CABEE|统一编号|施行日期|编制单位|批准部门|批准文号|主编单位|参编单位)$/i;

function itemCenterX(item: PdfLayoutTextItem): number {
  return item.x + (Number.isFinite(item.width) ? item.width / 2 : 0);
}

function isTemplateNoise(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (!compact) return true;
  if (TEMPLATE_LINE.test(compact) || TEMPLATE_LINE.test(text.trim())) return true;
  if (/^J\/CABEE\s*\d+/i.test(compact)) return true;
  return false;
}

/**
 * 在页面中部寻找最宽水平间隙作为栏缝。间隙不够大则视为单栏。
 */
export function detectColumnGutter(
  items: ReadonlyArray<PdfLayoutTextItem>,
  pageWidth: number
): number | null {
  if (!Number.isFinite(pageWidth) || pageWidth <= 0 || items.length < 12) return null;
  const centers = items
    .map(itemCenterX)
    .filter((x) => Number.isFinite(x) && x >= pageWidth * 0.08 && x <= pageWidth * 0.92)
    .sort((a, b) => a - b);
  if (centers.length < 12) return null;

  let bestGap = 0;
  let bestMid = 0;
  for (let index = 1; index < centers.length; index++) {
    const gap = centers[index]! - centers[index - 1]!;
    const mid = (centers[index]! + centers[index - 1]!) / 2;
    if (mid < pageWidth * 0.32 || mid > pageWidth * 0.68) continue;
    if (gap > bestGap) {
      bestGap = gap;
      bestMid = mid;
    }
  }
  const minGap = Math.max(28, pageWidth * 0.06);
  if (bestGap < minGap) return null;

  const left = items.filter((item) => itemCenterX(item) < bestMid).length;
  const right = items.length - left;
  if (left < 6 || right < 6) return null;
  if (left / items.length < 0.18 || right / items.length < 0.18) return null;
  return bestMid;
}

function joinLineItems(items: ReadonlyArray<PdfLayoutTextItem>): string {
  const sorted = [...items].sort((a, b) => a.x - b.x || b.y - a.y);
  let output = "";
  let prevRight = Number.NEGATIVE_INFINITY;
  for (const item of sorted) {
    const raw = item.text ?? "";
    if (!raw.trim()) continue;
    const gap = item.x - prevRight;
    if (output && gap > 4) {
      output += gap > 36 ? "¨" : "";
    }
    output += raw;
    prevRight = item.x + (Number.isFinite(item.width) ? item.width : 0);
  }
  return output.replace(/[ \t]+/g, " ").replace(/¨{2,}/g, "¨¨¨").trim();
}

function groupLines(
  items: ReadonlyArray<PdfLayoutTextItem>,
  yTolerance: number
): Array<{ y: number; items: PdfLayoutTextItem[] }> {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ y: number; items: PdfLayoutTextItem[] }> = [];
  for (const item of sorted) {
    const line = lines.find((entry) => Math.abs(entry.y - item.y) <= yTolerance);
    if (line) {
      line.items.push(item);
      line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length;
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }
  return lines;
}

/**
 * 按几何重建人类阅读顺序：先分栏，栏内从上到下、行内从左到右。
 * 页眉页脚模板在进入正文前剔除；pageLabel 提取应在调用本函数之前完成。
 */
export function reconstructPageText(
  items: ReadonlyArray<PdfLayoutTextItem>,
  pageWidth: number,
  pageHeight: number,
  options?: { headerRatio?: number; footerRatio?: number }
): ReconstructedPageText {
  if (items.length === 0) return { text: "", columnCount: 1, lineCount: 0 };
  const headerRatio = options?.headerRatio ?? 0.07;
  const footerRatio = options?.footerRatio ?? 0.15;
  const headerY = pageHeight * (1 - Math.min(0.12, Math.max(0.04, headerRatio)));
  const footerY = pageHeight * Math.min(0.2, Math.max(0.1, footerRatio));
  const body = items.filter((item) => {
    if (!Number.isFinite(item.y) || !item.text?.trim()) return false;
    if (item.y <= footerY || item.y >= headerY) return false;
    return !isTemplateNoise(item.text);
  });
  if (body.length === 0) {
    const fallback = items.map((item) => item.text).join("").trim();
    return { text: fallback, columnCount: 1, lineCount: fallback ? 1 : 0 };
  }

  const heights = body.map((item) => item.height).filter((height) => height > 0).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 10;
  const yTolerance = Math.max(4, Math.min(12, medianHeight * 0.7));
  const gutter = detectColumnGutter(body, pageWidth);
  const columnCount = gutter == null ? 1 : 2;
  const columns: PdfLayoutTextItem[][] = gutter == null ? [body] : [[], []];
  if (gutter != null) {
    for (const item of body) {
      columns[itemCenterX(item) < gutter ? 0 : 1]!.push(item);
    }
  }

  const lines: string[] = [];
  for (const column of columns) {
    if (column.length === 0) continue;
    const grouped = groupLines(column, yTolerance);
    for (const line of grouped) {
      const text = joinLineItems(line.items);
      if (text && !isTemplateNoise(text)) lines.push(text);
    }
  }
  return { text: lines.join("\n"), columnCount, lineCount: lines.length };
}

/** 跨页高频模板行（图框标题栏残留）从正文中降低权重。 */
export function collectRepeatedTemplateLines(
  pageTexts: readonly string[],
  minRatio = 0.35
): Set<string> {
  const counts = new Map<string, number>();
  for (const text of pageTexts) {
    const seen = new Set<string>();
    for (const line of text.split("\n")) {
      const compact = line.replace(/\s+/g, "").trim();
      if (compact.length < 2 || compact.length > 40) continue;
      if (seen.has(compact)) continue;
      seen.add(compact);
      counts.set(compact, (counts.get(compact) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(pageTexts.length * minRatio));
  const repeated = new Set<string>();
  for (const [line, count] of counts) {
    if (count >= threshold) repeated.add(line);
  }
  return repeated;
}

export function stripRepeatedTemplateLines(text: string, repeated: ReadonlySet<string>): string {
  if (repeated.size === 0) return text;
  return text
    .split("\n")
    .filter((line) => !repeated.has(line.replace(/\s+/g, "").trim()))
    .join("\n");
}

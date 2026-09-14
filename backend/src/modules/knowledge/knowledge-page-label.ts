export type PageLabelSource =
  | "PDF_PAGE_LABEL"
  | "FOOTER_TEXT"
  | "TOC_MAPPING"
  | "COMPANION_FILE"
  | "VISUAL_MATCH"
  | "MANUAL"
  | "FALLBACK";

export interface PdfTextItemForLabel {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
}

export interface PageLabelCandidate {
  pageLabel: string;
  confidence: number;
}

const PRINTED_PAGE_LABEL = /^(?:[A-Z]{1,3}\s*[-—]?\s*\d{1,4}|\d{1,4})$/i;
const NOISE_TEXT = /(图集号|比例|审核|校对|设计|审定|制图|校核|批准)/i;

function normalizeCandidate(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\s·•:：|]+/g, "")
    .replace(/[—–-]/g, "")
    .trim()
    .toUpperCase();
}

function isPrintedPageLabel(value: string): boolean {
  return PRINTED_PAGE_LABEL.test(value) && !NOISE_TEXT.test(value);
}

/** 图框「页次」右侧的印刷页码，优先于泛页脚最低点候选。 */
export function detectTitleBlockPageLabel(
  items: ReadonlyArray<PdfTextItemForLabel>
): PageLabelCandidate | null {
  const markers = items.filter((item) => {
    const compact = item.text.replace(/\s+/g, "");
    return compact === "页次" || /^页次$/.test(item.text.trim());
  });
  const candidates: Array<{ value: string; distance: number }> = [];
  for (const marker of markers) {
    for (const item of items) {
      if (item === marker) continue;
      const value = normalizeCandidate(item.text);
      if (!isPrintedPageLabel(value)) continue;
      const dy = Math.abs(item.y - marker.y);
      if (dy > 16) continue;
      if (item.x < marker.x - 8) continue;
      candidates.push({ value, distance: Math.abs(item.x - marker.x) + dy });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.distance - b.distance);
  return { pageLabel: candidates[0]!.value, confidence: 0.9 };
}

/** 印刷页码识别：页次标题栏 → 页脚区域。 */
export function detectPrintedPageLabel(
  items: ReadonlyArray<PdfTextItemForLabel>,
  pageHeight: number,
  footerRatio = 0.15
): PageLabelCandidate | null {
  return detectTitleBlockPageLabel(items) ?? detectFooterPageLabel(items, pageHeight, footerRatio);
}

export type PageLabelMappingStatus = "VERIFIED" | "HIGH_CONFIDENCE" | "LOW_CONFIDENCE" | "UNMAPPED";

export function pageLabelMappingStatus(input: {
  source: PageLabelSource;
  confidence: number | null;
  verified?: boolean;
}): PageLabelMappingStatus {
  if (input.verified || input.source === "MANUAL") return "VERIFIED";
  if (input.source === "FALLBACK" || input.confidence == null) return "UNMAPPED";
  if (input.confidence >= 0.8) return "HIGH_CONFIDENCE";
  if (input.confidence >= 0.5) return "LOW_CONFIDENCE";
  return "UNMAPPED";
}

export interface PrintedPageLabelEntry {
  physical: number;
  label: string;
  source: PageLabelSource;
  confidence: number | null;
}

/**
 * 仅收非 FALLBACK 的印刷页码。同标签多页时保持未映射，避免把 TOC 的 A5 指到错误物理页。
 */
export function buildPrintedPageLabelMap(
  pages: ReadonlyArray<PrintedPageLabelEntry>
): Map<string, number> {
  const grouped = new Map<string, PrintedPageLabelEntry[]>();
  for (const page of pages) {
    if (!page.label || page.source === "FALLBACK") continue;
    const key = page.label.replace(/\s+/g, "").toUpperCase();
    if (!key) continue;
    const list = grouped.get(key) ?? [];
    list.push(page);
    grouped.set(key, list);
  }
  const map = new Map<string, number>();
  for (const [label, list] of grouped) {
    const uniquePhysical = [...new Set(list.map((item) => item.physical))];
    if (uniquePhysical.length !== 1) continue;
    map.set(label, uniquePhysical[0]!);
  }
  return map;
}

export function resolveTocPhysicalPage(
  pageLabel: string | null | undefined,
  pageLabelMap: ReadonlyMap<string, number>
): number | null {
  if (!pageLabel) return null;
  return pageLabelMap.get(pageLabel.replace(/\s+/g, "").toUpperCase()) ?? null;
}

/** 仅从 PDF 页面底部区域识别印刷页码，不使用整页字符串。 */
export function detectFooterPageLabel(
  items: ReadonlyArray<PdfTextItemForLabel>,
  pageHeight: number,
  footerRatio = 0.15
): PageLabelCandidate | null {
  if (!Number.isFinite(pageHeight) || pageHeight <= 0) return null;
  const bottom = pageHeight * Math.min(0.2, Math.max(0.1, footerRatio));
  const footerItems = items
    .filter((item) => Number.isFinite(item.y) && item.y <= bottom && item.text.trim())
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const candidates: Array<{ value: string; y: number; width: number }> = [];
  for (const item of footerItems) {
    const value = normalizeCandidate(item.text);
    if (isPrintedPageLabel(value)) candidates.push({ value, y: item.y, width: item.width });
  }
  if (candidates.length === 0) return null;

  // 页脚常见左右页码只取最底部候选；同一位置重复时优先数字/字母数字完整标签。
  const lowestY = Math.max(...candidates.map((candidate) => candidate.y));
  const atBottom = candidates.filter((candidate) => lowestY - candidate.y <= 12);
  const selected = atBottom.sort((a, b) => b.width - a.width)[0]!;
  return { pageLabel: selected.value, confidence: 0.82 };
}

export function fallbackPageLabel(physicalPageNumber: number): {
  pageLabel: string;
  pageLabelSource: "FALLBACK";
  pageLabelConfidence: null;
  pageLabelVerified: false;
} {
  return {
    pageLabel: String(physicalPageNumber),
    pageLabelSource: "FALLBACK",
    pageLabelConfidence: null,
    pageLabelVerified: false
  };
}

export function isReliablePageLabel(source: PageLabelSource, confidence: number | null, verified: boolean, minimumConfidence: number): boolean {
  return verified || (source !== "FALLBACK" && confidence != null && confidence >= minimumConfidence);
}

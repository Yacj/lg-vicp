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

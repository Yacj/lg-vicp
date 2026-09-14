import {
  buildPrintedPageLabelMap,
  resolveTocPhysicalPage,
  type PageLabelSource,
  type PrintedPageLabelEntry
} from "./knowledge-page-label.js";
import { validatePdfOutline, type PdfOutlineQuality } from "./pdf-outline-quality.js";
import {
  parseTocFromPages,
  type ParsedTocItem
} from "./pdf-toc-page.js";

export interface KnowledgeTocOutlineItem {
  title: string;
  level: number;
  pageNumber: number | null;
}

export interface KnowledgeTocDraftPage {
  physical: number;
  text: string;
  label: string | null;
  labelSource: PageLabelSource | null;
  labelConfidence: number | null;
}

export interface KnowledgeTocDraftResult {
  items: ParsedTocItem[];
  source: "PDF_BOOKMARK" | "TOC_PAGE" | null;
  outlineQuality: PdfOutlineQuality;
  pageLabelMap: Map<string, number>;
}

function outlineToTocItems(
  outline: ReadonlyArray<KnowledgeTocOutlineItem>,
  pageLabelMap: ReadonlyMap<string, number>,
  maxPage: number
): ParsedTocItem[] {
  const reverseLabel = new Map<number, string>();
  for (const [label, physical] of pageLabelMap) {
    if (!reverseLabel.has(physical)) reverseLabel.set(physical, label);
  }
  return outline
    .filter((item) => item.title.trim())
    .map((item) => {
      const physical = item.pageNumber != null && item.pageNumber >= 1 && item.pageNumber <= maxPage
        ? item.pageNumber
        : null;
      const pageLabel = physical != null ? reverseLabel.get(physical) ?? null : null;
      return {
        title: item.title.trim().slice(0, 255),
        level: Math.max(1, item.level),
        pageLabel,
        physicalPageNumber: physical,
        parentTempId: null,
        source: "PDF_BOOKMARK" as const,
        confidence: physical != null ? 0.9 : 0.5
      };
    });
}

function applyPageLabelMap(items: ParsedTocItem[], pageLabelMap: ReadonlyMap<string, number>): ParsedTocItem[] {
  return items.map((item) => {
    if (item.physicalPageNumber != null) return item;
    const physical = resolveTocPhysicalPage(item.pageLabel, pageLabelMap);
    return {
      ...item,
      physicalPageNumber: physical,
      confidence: physical != null ? Math.max(item.confidence, 0.9) : Math.min(item.confidence, 0.7)
    };
  });
}

export function buildKnowledgeTocDraft(input: {
  outline: ReadonlyArray<KnowledgeTocOutlineItem>;
  pages: ReadonlyArray<KnowledgeTocDraftPage>;
}): KnowledgeTocDraftResult {
  const pageCount = input.pages.length;
  const outlineQuality = validatePdfOutline(input.outline, pageCount);
  const pageLabelMap = buildPrintedPageLabelMap(input.pages.map((page): PrintedPageLabelEntry => ({
    physical: page.physical,
    label: page.label ?? "",
    source: page.labelSource ?? "FALLBACK",
    confidence: page.labelConfidence
  })));

  if (outlineQuality.valid) {
    return {
      items: applyPageLabelMap(outlineToTocItems(input.outline, pageLabelMap, pageCount), pageLabelMap),
      source: "PDF_BOOKMARK",
      outlineQuality,
      pageLabelMap
    };
  }

  const fromPages = applyPageLabelMap(parseTocFromPages(input.pages), pageLabelMap);
  return {
    items: fromPages,
    source: fromPages.length > 0 ? "TOC_PAGE" : null,
    outlineQuality,
    pageLabelMap
  };
}

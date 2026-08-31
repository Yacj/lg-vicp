import { normalizeSearchText } from "./knowledge.normalize.js";

/**
 * 检索页 → 原文页映射构造（纯函数，无 IO）：
 * 禁止假设 Original PDF 与 Search Source 物理页一一对应；映射优先级：
 * 1. TOC 标题对齐（检索源书签标题 ↔ 原文 TOC 条目标题，高置信）；
 * 2. 锚点之间线性插值补齐（低置信草稿，等 B 端人工核验）；
 * 3. 无锚点且页数相等时才允许恒等映射兜底（低置信草稿）；
 * 4. 人工指定（MANUAL）由 B 端 remap/核验接口写入，不在此生成。
 * 输出保证覆盖检索源每一页（内容必须有归属页），未人工核验的映射 verified=false。
 */

export interface PageMappingDraft {
  searchPhysicalPageNumber: number;
  originalPhysicalPageNumber: number;
  pageLabel: string | null;
  mappingMethod: "PAGE_LABEL" | "TOC_TITLE" | "MANUAL";
  confidence: number;
}

export interface MappingTocItem {
  title: string;
  pageLabel: string | null;
  physicalPageNumber: number | null;
}

export interface MappingOutlineItem {
  title: string;
  pageNumber: number | null;
}

export interface MappingOriginalPage {
  physical: number;
  label: string | null;
}

/** 目录标题归一化：全角/大小写折叠并去除全部空白（图集标题中英文混排空格差异常见） */
export function normalizeMappingTitle(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

const TOC_TITLE_CONFIDENCE = 0.9;
const INTERPOLATED_CONFIDENCE = 0.25;
const IDENTITY_FALLBACK_CONFIDENCE = 0.3;
const EDGE_FILL_CONFIDENCE = 0.15;

export function buildPageMappings(input: {
  originalPages: ReadonlyArray<MappingOriginalPage>;
  searchTotalPages: number;
  tocItems: ReadonlyArray<MappingTocItem>;
  searchOutline: ReadonlyArray<MappingOutlineItem>;
}): PageMappingDraft[] {
  const originalByPhysical = new Map(input.originalPages.map((page) => [page.physical, page]));
  const lastOriginalPhysical = input.originalPages.length > 0
    ? input.originalPages[input.originalPages.length - 1]!.physical
    : 0;

  // 1) TOC 标题对齐：检索源书签（有页码）→ 原文 TOC 同名条目 → 原文物理页
  const anchorPairs: Array<{ searchPage: number; originalPage: number; label: string | null }> = [];
  const usedTocIndexes = new Set<number>();
  for (const outlineItem of input.searchOutline) {
    if (outlineItem.pageNumber == null || outlineItem.pageNumber < 1) continue;
    const normalizedTitle = normalizeMappingTitle(outlineItem.title);
    if (!normalizedTitle) continue;
    const tocIndex = input.tocItems.findIndex((item, index) => {
      if (usedTocIndexes.has(index)) return false;
      const candidate = normalizeMappingTitle(item.title);
      if (!candidate) return false;
      return candidate === normalizedTitle || candidate.includes(normalizedTitle) || normalizedTitle.includes(candidate);
    });
    if (tocIndex < 0) continue;
    const tocItem = input.tocItems[tocIndex]!;
    usedTocIndexes.add(tocIndex);
    let originalPage = tocItem.physicalPageNumber;
    if (originalPage == null && tocItem.pageLabel) {
      const byLabel = input.originalPages.find((page) => page.label === tocItem.pageLabel);
      originalPage = byLabel?.physical ?? null;
    }
    if (originalPage == null || !originalByPhysical.has(originalPage)) continue;
    anchorPairs.push({
      searchPage: outlineItem.pageNumber,
      originalPage,
      label: tocItem.pageLabel
    });
  }
  anchorPairs.sort((a, b) => a.searchPage - b.searchPage);
  // 同一检索页多个锚点保留首个；同一原文页多个锚点保留首个（避免映射漂移）
  const seenSearch = new Set<number>();
  const seenOriginal = new Set<number>();
  const anchors = anchorPairs.filter((pair) => {
    if (seenSearch.has(pair.searchPage) || seenOriginal.has(pair.originalPage)) return false;
    seenSearch.add(pair.searchPage);
    seenOriginal.add(pair.originalPage);
    return true;
  });

  const mappings = new Map<number, PageMappingDraft>();
  for (const anchor of anchors) {
    mappings.set(anchor.searchPage, {
      searchPhysicalPageNumber: anchor.searchPage,
      originalPhysicalPageNumber: anchor.originalPage,
      pageLabel: anchor.label,
      mappingMethod: "TOC_TITLE",
      confidence: TOC_TITLE_CONFIDENCE
    });
  }

  const clampOriginal = (physical: number): number =>
    Math.min(Math.max(1, Math.round(physical)), Math.max(1, lastOriginalPhysical));

  // 2) 锚点之间线性插值（低置信草稿）
  for (let i = 0; i < anchors.length - 1; i++) {
    const left = anchors[i]!;
    const right = anchors[i + 1]!;
    const searchSpan = right.searchPage - left.searchPage;
    const originalSpan = right.originalPage - left.originalPage;
    for (let searchPage = left.searchPage + 1; searchPage < right.searchPage; searchPage++) {
      if (searchSpan <= 0) continue;
      const ratio = (searchPage - left.searchPage) / searchSpan;
      const originalPage = clampOriginal(left.originalPage + originalSpan * ratio);
      mappings.set(searchPage, {
        searchPhysicalPageNumber: searchPage,
        originalPhysicalPageNumber: originalPage,
        pageLabel: null,
        mappingMethod: "PAGE_LABEL",
        confidence: INTERPOLATED_CONFIDENCE
      });
    }
  }
  // 3) 首锚点之前的页 → 首锚点原文页；末锚点之后的页 → 末锚点原文页
  if (anchors.length > 0) {
    const first = anchors[0]!;
    const last = anchors[anchors.length - 1]!;
    for (let searchPage = 1; searchPage < first.searchPage; searchPage++) {
      mappings.set(searchPage, {
        searchPhysicalPageNumber: searchPage,
        originalPhysicalPageNumber: first.originalPage,
        pageLabel: null,
        mappingMethod: "PAGE_LABEL",
        confidence: EDGE_FILL_CONFIDENCE
      });
    }
    for (let searchPage = last.searchPage + 1; searchPage <= input.searchTotalPages; searchPage++) {
      mappings.set(searchPage, {
        searchPhysicalPageNumber: searchPage,
        originalPhysicalPageNumber: last.originalPage,
        pageLabel: null,
        mappingMethod: "PAGE_LABEL",
        confidence: EDGE_FILL_CONFIDENCE
      });
    }
  }

  // 4) 无任何锚点且页数相等 → 恒等映射兜底（低置信草稿；页数不等时不做任何假设，留人工）
  if (anchors.length === 0 && input.originalPages.length === input.searchTotalPages && input.searchTotalPages > 0) {
    for (let searchPage = 1; searchPage <= input.searchTotalPages; searchPage++) {
      mappings.set(searchPage, {
        searchPhysicalPageNumber: searchPage,
        originalPhysicalPageNumber: searchPage,
        pageLabel: originalByPhysical.get(searchPage)?.label ?? null,
        mappingMethod: "PAGE_LABEL",
        confidence: IDENTITY_FALLBACK_CONFIDENCE
      });
    }
  }

  return [...mappings.values()].sort((a, b) => a.searchPhysicalPageNumber - b.searchPhysicalPageNumber);
}

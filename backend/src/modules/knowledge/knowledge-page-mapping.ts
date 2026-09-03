import { normalizeSearchText } from "./knowledge.normalize.js";

/** 检索页 → 原文页映射候选。没有证据时不生成映射，不做物理页恒等或线性插值。 */
export interface PageMappingDraft {
  searchPhysicalPageNumber: number;
  originalPhysicalPageNumber: number;
  pageLabel: string | null;
  mappingMethod: "PAGE_LABEL" | "TOC_TITLE" | "COMPANION_FILE" | "VISUAL_MATCH" | "MANUAL";
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
  title?: string | null;
}

export interface MappingSearchPage {
  physical: number;
  label: string | null;
  title?: string | null;
}

export interface VisualPageMatch {
  searchPhysicalPageNumber: number;
  originalPhysicalPageNumber: number;
  confidence: number;
}

/** 目录标题归一化：全角/大小写折叠并去除全部空白。 */
export function normalizeMappingTitle(value: string): string {
  return normalizeSearchText(value).replace(/\s+/g, "");
}

const PAGE_LABEL_CONFIDENCE = 0.98;
const TOC_TITLE_CONFIDENCE = 0.9;
const COMPANION_FILE_CONFIDENCE = 0.86;
const VISUAL_MATCH_MIN_CONFIDENCE = 0.7;
const TITLE_MATCH_CONFIDENCE = 0.78;

function titleMatches(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  const a = normalizeMappingTitle(left);
  const b = normalizeMappingTitle(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function setMapping(
  mappings: Map<number, PageMappingDraft>,
  candidate: PageMappingDraft
): void {
  if (!mappings.has(candidate.searchPhysicalPageNumber)) mappings.set(candidate.searchPhysicalPageNumber, candidate);
}

/**
 * 生成双源映射候选，优先级为：页码标签精确、TOC 标题+页码、视觉匹配、页面标题。
 * 邻页顺序只作为调用方提供视觉候选时的外部排序依据；这里绝不使用线性插值、边缘填充或等页数恒等回退。
 */
export function buildPageMappings(input: {
  originalPages: ReadonlyArray<MappingOriginalPage>;
  searchPages?: ReadonlyArray<MappingSearchPage>;
  searchTotalPages: number;
  tocItems: ReadonlyArray<MappingTocItem>;
  searchOutline: ReadonlyArray<MappingOutlineItem>;
  visualMatches?: ReadonlyArray<VisualPageMatch>;
}): PageMappingDraft[] {
  const mappings = new Map<number, PageMappingDraft>();
  const originalByPhysical = new Map(input.originalPages.map((page) => [page.physical, page]));
  const originalByLabel = new Map<string, MappingOriginalPage[]>();
  for (const page of input.originalPages) {
    if (!page.label) continue;
    const list = originalByLabel.get(page.label) ?? [];
    list.push(page);
    originalByLabel.set(page.label, list);
  }
  const searchPages: ReadonlyArray<MappingSearchPage> = input.searchPages ?? Array.from({ length: input.searchTotalPages }, (_, index): MappingSearchPage => ({
    physical: index + 1,
    label: null
  }));

  // 1) Search Source 与 Original 的印刷页码标签精确匹配。
  for (const searchPage of searchPages) {
    if (!searchPage.label) continue;
    const candidates = originalByLabel.get(searchPage.label) ?? [];
    if (candidates.length !== 1) continue;
    const original = candidates[0]!;
    setMapping(mappings, {
      searchPhysicalPageNumber: searchPage.physical,
      originalPhysicalPageNumber: original.physical,
      pageLabel: original.label,
      mappingMethod: "PAGE_LABEL",
      confidence: PAGE_LABEL_CONFIDENCE
    });
  }

  // 2) Search Source 书签标题 + 页码与 Original TOC/书签条目匹配。
  for (const outline of input.searchOutline) {
    if (outline.pageNumber == null || outline.pageNumber < 1) continue;
    const toc = input.tocItems.find((item) => titleMatches(item.title, outline.title));
    if (!toc) continue;
    const originalPhysical = toc.physicalPageNumber
      ?? (toc.pageLabel ? originalByLabel.get(toc.pageLabel)?.[0]?.physical ?? null : null);
    if (originalPhysical == null || !originalByPhysical.has(originalPhysical)) continue;
    setMapping(mappings, {
      searchPhysicalPageNumber: outline.pageNumber,
      originalPhysicalPageNumber: originalPhysical,
      pageLabel: toc.pageLabel ?? originalByPhysical.get(originalPhysical)?.label ?? null,
      mappingMethod: "TOC_TITLE",
      confidence: TOC_TITLE_CONFIDENCE
    });
  }

  // 3) 配套 Search Source 页签存在但来源被明确标记为配套文件时，保留为较低的自动候选。
  // 该候选必须经过 AI 置信度门槛或人工核验后才可正式引用。
  for (const searchPage of searchPages) {
    if (mappings.has(searchPage.physical) || !searchPage.label) continue;
    const candidates = originalByLabel.get(searchPage.label) ?? [];
    if (candidates.length !== 1) continue;
    const original = candidates[0]!;
    setMapping(mappings, {
      searchPhysicalPageNumber: searchPage.physical,
      originalPhysicalPageNumber: original.physical,
      pageLabel: original.label,
      mappingMethod: "COMPANION_FILE",
      confidence: COMPANION_FILE_CONFIDENCE
    });
  }

  // 4) 视觉候选只接受轻量 hash 模块给出的明确候选，不自行扩大搜索范围。
  for (const match of input.visualMatches ?? []) {
    if (match.confidence < VISUAL_MATCH_MIN_CONFIDENCE || !originalByPhysical.has(match.originalPhysicalPageNumber)) continue;
    setMapping(mappings, {
      searchPhysicalPageNumber: match.searchPhysicalPageNumber,
      originalPhysicalPageNumber: match.originalPhysicalPageNumber,
      pageLabel: originalByPhysical.get(match.originalPhysicalPageNumber)?.label ?? null,
      mappingMethod: "VISUAL_MATCH",
      confidence: match.confidence
    });
  }

  // 5) 页面标题相似仅作为最后自动候选；没有标题或有歧义时保持未映射。
  for (const searchPage of searchPages) {
    if (mappings.has(searchPage.physical) || !searchPage.title) continue;
    const candidates = input.originalPages.filter((page) => titleMatches(searchPage.title, page.title));
    if (candidates.length !== 1) continue;
    setMapping(mappings, {
      searchPhysicalPageNumber: searchPage.physical,
      originalPhysicalPageNumber: candidates[0]!.physical,
      pageLabel: candidates[0]!.label,
      mappingMethod: "VISUAL_MATCH",
      confidence: TITLE_MATCH_CONFIDENCE
    });
  }

  return [...mappings.values()].sort((a, b) => a.searchPhysicalPageNumber - b.searchPhysicalPageNumber);
}

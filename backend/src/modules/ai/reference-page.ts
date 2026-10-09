/**
 * REFERENCE_PAGE：查表命中后由后端组装。模型不输出 HTML，也不重画原表。
 * 没有来源页或没有页图时不伪造该结构。
 */
export const REFERENCE_PAGE_MISSING_NOTE = "当前参考方案尚未关联原始页面。";
export const REFERENCE_PAGE_LIMIT = 3;

export interface ReferencePageHighlight {
  field: string;
  label: string;
  value: string;
}

export interface ReferencePageMatch {
  candidateId?: string;
  summary: ReferencePageBlock["summary"];
  highlights: ReferencePageHighlight[];
}

export interface ReferencePageBlock {
  type: "REFERENCE_PAGE";
  summary: {
    systemType?: string;
    constructionCode?: string;
    productName?: string;
    productSpecName?: string;
    thicknessMm?: number;
    lambda?: number;
    alpha?: number;
    productThermalResistance?: number;
    totalThermalResistance?: number;
    /** @deprecated 兼容旧客户端，值等于 totalThermalResistance。 */
    rValue?: number;
    kValue?: number;
  };
  page: {
    documentId: string;
    pageId: string;
    documentTitle: string;
    pageNumber: number;
    physicalPageNumber?: number;
    pageLabel?: string;
    imageUrl: string;
  };
  /** 同一原始页上的多个候选，页面图片只出现一次。 */
  matches: ReferencePageMatch[];
  /** 兼容现有客户端：仅主候选的参数条，全部候选分别在 matches 中。 */
  highlights: ReferencePageHighlight[];
}

export interface ReferencePageCandidate {
  id: string;
  systemName?: string;
  schemeCode?: string;
  productName?: string;
  specCode?: string;
  thicknessMm?: number;
  lambda?: number;
  alpha?: number;
  productThermalResistance?: number;
  totalThermalResistance?: number;
  kValue?: number;
  sourceDocumentId?: string | null;
  sourcePageId?: string | null;
  sourcePageLabel?: string | null;
}

export interface ReferencePageSource {
  pageId: string;
  documentId: string;
  documentTitle: string;
  /** 兼容旧调用方；现在该值必须来自 knowledge_pages.physicalPageNumber。 */
  pageNumber?: number;
  physicalPageNumber?: number;
  pageLabel?: string | null;
  pageImageObjectKey?: string | null;
  imageUrl?: string | null;
}

export interface StoredReferencePage {
  documentId: string;
  pageId: string;
  documentTitle?: string;
  pageNumber?: number | null;
  physicalPageNumber?: number | null;
  pageLabel?: string | null;
  pageImageObjectKey?: string | null;
  summary: ReferencePageBlock["summary"];
  highlights: ReferencePageHighlight[];
  matches?: ReferencePageMatch[];
}

function formatNumber(value: number): string {
  const text = String(value);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

export function buildHighlights(candidate: ReferencePageCandidate): ReferencePageHighlight[] {
  const highlights: ReferencePageHighlight[] = [];
  if (candidate.thicknessMm != null) {
    highlights.push({ field: "thicknessMm", label: "厚度", value: `${formatNumber(candidate.thicknessMm)} mm` });
  }
  if (candidate.productThermalResistance != null) {
    highlights.push({ field: "productR", label: "产品层热阻 R", value: formatNumber(candidate.productThermalResistance) });
  }
  if (candidate.totalThermalResistance != null) {
    highlights.push({ field: "rValue", label: "外墙主断面总热阻 R₀", value: formatNumber(candidate.totalThermalResistance) });
  }
  if (candidate.kValue != null) {
    highlights.push({ field: "kValue", label: "传热系数 K", value: formatNumber(candidate.kValue) });
  }
  return highlights;
}

function buildSummary(candidate: ReferencePageCandidate): ReferencePageBlock["summary"] {
  return {
    systemType: candidate.systemName,
    constructionCode: candidate.schemeCode,
    productName: candidate.productName,
    productSpecName: candidate.specCode,
    thicknessMm: candidate.thicknessMm,
    lambda: candidate.lambda,
    alpha: candidate.alpha,
    productThermalResistance: candidate.productThermalResistance,
    totalThermalResistance: candidate.totalThermalResistance,
    rValue: candidate.totalThermalResistance,
    kValue: candidate.kValue
  };
}

export function buildReferencePageBlocks(
  candidates: ReferencePageCandidate[],
  pages: ReferencePageSource[]
): { blocks: ReferencePageBlock[]; stored: StoredReferencePage[]; missingPage: boolean } {
  const pageById = new Map(pages.map((page) => [page.pageId, page]));
  const groups = new Map<string, {
    page: ReferencePageSource;
    highlights: ReferencePageHighlight[];
    summary: ReferencePageBlock["summary"];
    matches: ReferencePageMatch[];
  }>();
  let missingPage = false;
  for (const candidate of candidates) {
    const page = candidate.sourcePageId ? pageById.get(candidate.sourcePageId) : undefined;
    if (!page?.pageImageObjectKey || !page.imageUrl || candidate.sourceDocumentId && candidate.sourceDocumentId !== page.documentId) {
      missingPage = true;
      continue;
    }
    const highlights = buildHighlights(candidate);
    const summary = buildSummary(candidate);
    const match: ReferencePageMatch = { candidateId: candidate.id, summary, highlights };
    const existing = groups.get(page.pageId);
    if (existing) {
      existing.matches.push(match);
      continue;
    }
    if (groups.size >= REFERENCE_PAGE_LIMIT) continue;
    groups.set(page.pageId, { page, highlights: [...highlights], summary, matches: [match] });
  }
  const blocks: ReferencePageBlock[] = [];
  const stored: StoredReferencePage[] = [];
  for (const group of groups.values()) {
    const physicalPageNumber = group.page.physicalPageNumber ?? group.page.pageNumber;
    const block: ReferencePageBlock = {
      type: "REFERENCE_PAGE",
      summary: group.summary,
      page: {
        documentId: group.page.documentId,
        pageId: group.page.pageId,
        documentTitle: group.page.documentTitle,
        pageNumber: physicalPageNumber ?? 0,
        ...(physicalPageNumber != null ? { physicalPageNumber } : {}),
        ...(group.page.pageLabel?.trim() ? { pageLabel: group.page.pageLabel.trim() } : {}),
        imageUrl: group.page.imageUrl!
      },
      matches: group.matches,
      highlights: group.highlights
    };
    blocks.push(block);
    stored.push({
      documentId: group.page.documentId,
      pageId: group.page.pageId,
      documentTitle: group.page.documentTitle,
      pageNumber: physicalPageNumber ?? null,
      physicalPageNumber: physicalPageNumber ?? null,
      pageLabel: group.page.pageLabel ?? null,
      pageImageObjectKey: group.page.pageImageObjectKey ?? null,
      summary: { ...group.summary },
      highlights: group.highlights.map((highlight) => ({ ...highlight })),
      matches: group.matches.map((match) => ({
        candidateId: match.candidateId,
        summary: { ...match.summary },
        highlights: match.highlights.map((highlight) => ({ ...highlight }))
      }))
    });
  }
  return { blocks, stored, missingPage: missingPage && blocks.length === 0 };
}

import { normalizeSubstrateMaterial } from "./thermal-substrate-facts.js";
/**
 * REFERENCE_PAGE：查表命中后由后端组装。模型不输出 HTML，也不重画原表。
 * 没有来源页或没有页图时不伪造该结构。
 */
export const REFERENCE_PAGE_MISSING_NOTE = "当前参考方案尚未关联原始页面。";
export const REFERENCE_PAGE_LIMIT = 3;

import { THERMAL_PAGE_FIELDS, type KnowledgePageRenderModel, type PageReferenceHighlight } from "../../shared/knowledge-page-render.js";

export interface ReferencePageHighlight {
  field: string;
  label: string;
  value: string;
}

export interface ReferencePageMatch extends Partial<PageReferenceHighlight> {
  /** 旧报告快照的兼容读取字段，新确认引用使用 optionId/fieldKeys。 */
  semanticHighlights?: unknown[];
  candidateId?: string;
  summary: ReferencePageBlock["summary"];
  highlights: ReferencePageHighlight[];
}

export interface ReferencePageBlock {
  type: "REFERENCE_PAGE";
  /** 仅确定性查表摘要允许客户端以正式方案卡替换关联段落。 */
  answerStyle?: "THERMAL_SOLUTIONS";
  primaryFieldKeys?: PageReferenceHighlight["fieldKeys"];
  renderModel?: KnowledgePageRenderModel | null;
  summary: {
    systemType?: string;
    constructionCode?: string;
    productName?: string;
    productSpecName?: string;
    thicknessMm?: number;
    substrateMaterial?: string;
    substrateThickness?: number | null;
    lambda?: number;
    alpha?: number;
    productThermalResistance?: number;
    totalThermalResistance?: number;
    /** @deprecated 兼容旧客户端，值等于 totalThermalResistance。 */
    rValue?: number;
    kValue?: number;
  };
  page: {
    versionId?: string;
    pageLabelSource?: string | null;
    pageLabelVerified?: boolean | null;
    documentId: string;
    pageId: string;
    documentTitle: string;
    docNumber?: string | null;
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
  optionId?: string | null;
  specClass?: string;
  substrateMaterial?: string;
  substrateThickness?: number | null;
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
  renderModel?: KnowledgePageRenderModel | null;
  pageId: string;
  documentId: string;
  documentTitle: string;
  docNumber?: string | null;
  /** 兼容旧调用方；现在该值必须来自 knowledge_pages.physicalPageNumber。 */
  pageNumber?: number;
  physicalPageNumber?: number;
  pageLabel?: string | null;
  pageImageObjectKey?: string | null;
  imageUrl?: string | null;
}

export interface StoredReferencePage {
  versionId?: string;
  answerStyle?: "THERMAL_SOLUTIONS";
  primaryFieldKeys?: PageReferenceHighlight["fieldKeys"];
  renderModel?: KnowledgePageRenderModel | null;
  documentId: string;
  pageId: string;
  documentTitle?: string;
  docNumber?: string | null;
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

export function buildHighlights(candidate: ReferencePageCandidate, sourceColumns?: KnowledgePageRenderModel["constructions"][number]["sourceColumns"]): ReferencePageHighlight[] {
  const label = (field: typeof THERMAL_PAGE_FIELDS[number], fallback: string) => {
    const own = sourceColumns?.filter(column => column.fieldKey === field);
    const column = own?.length === 1 ? own[0] : undefined;
    return column ? `${column.groupLabel ? `${column.groupLabel} · ` : ""}${column.label}${column.symbol && !column.label.includes(column.symbol) ? ` ${column.symbol}` : ""}${column.unit ? ` (${column.unit})` : ""}` : fallback;
  };
  const highlights: ReferencePageHighlight[] = [];
  if (candidate.thicknessMm != null) {
    highlights.push({ field: "thicknessMm", label: "厚度", value: `${formatNumber(candidate.thicknessMm)} mm` });
  }
  if (candidate.productThermalResistance != null) {
    highlights.push({ field: "productR", label: label("productThermalResistance", "产品整体热阻（源文待核）"), value: formatNumber(candidate.productThermalResistance) });
  }
  if (candidate.totalThermalResistance != null) {
    highlights.push({ field: "rValue", label: label("totalThermalResistance", "整构造传热阻（源文符号待核）"), value: formatNumber(candidate.totalThermalResistance) });
  }
  if (candidate.kValue != null) {
    highlights.push({ field: "kValue", label: label("kValue", "传热系数 K"), value: formatNumber(candidate.kValue) });
  }
  return highlights;
}

function buildSummary(candidate: ReferencePageCandidate): ReferencePageBlock["summary"] {
  return {
    systemType: candidate.systemName,
    substrateMaterial: candidate.substrateMaterial,
    substrateThickness: candidate.substrateThickness,
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

/** 候选须唯一对应同页同构造且四项数值全部一致的确认档位，冲突时不制造高亮。 */
export function bindReferencePageMatch(candidate: ReferencePageCandidate, page: ReferencePageSource): ReferencePageMatch | null {
  if (candidate.sourcePageId !== page.pageId || candidate.sourceDocumentId && candidate.sourceDocumentId !== page.documentId) return null;
  const records = page.renderModel?.constructions.flatMap(construction => {
    const code = (value: string | null | undefined) => value?.normalize("NFKC").replace(/\s/g, "").replace(/^外墙/, "").toUpperCase();
    if (!candidate.schemeCode || code(construction.constructionCode) !== code(candidate.schemeCode)) return [];
    if (candidate.specClass && construction.specClass && candidate.specClass !== construction.specClass
      || candidate.substrateMaterial && (!construction.baseMaterial || normalizeSubstrateMaterial(candidate.substrateMaterial) !== normalizeSubstrateMaterial(construction.baseMaterial))
      || candidate.substrateThickness != null && candidate.substrateThickness !== construction.baseThicknessMm) return [];
    return construction.options.filter(option => (!candidate.optionId || candidate.optionId === option.optionId) && THERMAL_PAGE_FIELDS.every(key =>
      candidate[key] != null && option[key] != null && Math.abs(candidate[key]! - option[key]!) < 0.00005
    )).map(option => ({ construction, option }));
  }) ?? [];
  if (records.length !== 1) return null;
  const { construction, option } = records[0]!;
  return { pageId: page.pageId, constructionId: construction.constructionId, optionId: option.optionId,
    fieldKeys: [...THERMAL_PAGE_FIELDS], candidateId: candidate.id, summary: buildSummary(candidate), highlights: buildHighlights(candidate, construction.sourceColumns) };
}

/** 正式消息只保存来源标识/快照，不保存会过期的签名 URL。 */
export function storeReferencePageBlocks(blocks: readonly ReferencePageBlock[]): StoredReferencePage[] {
  return blocks.map(block => ({ documentId: block.page.documentId, pageId: block.page.pageId,
    ...(block.page.versionId ? { versionId: block.page.versionId } : {}),
    documentTitle: block.page.documentTitle, docNumber: block.page.docNumber, physicalPageNumber: block.page.physicalPageNumber,
    pageLabel: block.page.pageLabel, summary: block.summary, highlights: block.highlights,
    matches: block.matches, renderModel: block.renderModel, answerStyle: block.answerStyle, primaryFieldKeys: block.primaryFieldKeys }));
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
    if (!page || (!page.renderModel && (!page.pageImageObjectKey || !page.imageUrl)) || candidate.sourceDocumentId && candidate.sourceDocumentId !== page.documentId) {
      missingPage = true;
      continue;
    }
    const highlights = buildHighlights(candidate);
    const summary = buildSummary(candidate);
    const match: ReferencePageMatch = bindReferencePageMatch(candidate, page) ?? { candidateId: candidate.id, summary, highlights };
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
      renderModel: group.page.renderModel,
      summary: group.summary,
      page: {
        documentId: group.page.documentId,
        pageId: group.page.pageId,
        documentTitle: group.page.documentTitle,
        docNumber: group.page.docNumber,
        pageNumber: physicalPageNumber ?? 0,
        ...(physicalPageNumber != null ? { physicalPageNumber } : {}),
        ...(group.page.pageLabel?.trim() ? { pageLabel: group.page.pageLabel.trim() } : {}),
        imageUrl: group.page.imageUrl ?? ""
      },
      matches: group.matches,
      highlights: group.highlights
    };
    blocks.push(block);
    stored.push({
      documentId: group.page.documentId,
      pageId: group.page.pageId,
      documentTitle: group.page.documentTitle,
      docNumber: group.page.docNumber,
      pageNumber: physicalPageNumber ?? null,
      physicalPageNumber: physicalPageNumber ?? null,
      pageLabel: group.page.pageLabel ?? null,
      pageImageObjectKey: group.page.pageImageObjectKey ?? null,
      renderModel: group.page.renderModel,
      summary: { ...group.summary },
      highlights: group.highlights.map((highlight) => ({ ...highlight })),
      matches: group.matches.map((match) => ({
        ...match,
        summary: { ...match.summary },
        highlights: match.highlights.map((highlight) => ({ ...highlight }))
      }))
    });
  }
  return { blocks, stored, missingPage: missingPage && blocks.length === 0 };
}

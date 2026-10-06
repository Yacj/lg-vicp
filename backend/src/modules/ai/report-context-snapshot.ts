/**
 * 报告上下文快照：用户确认多选后立即固化。
 * 报告生成只消费 Snapshot，不再让模型决定选哪些产品或重读整段聊天。
 */
import type { ComparisonContext, ComparisonSourceRef, ProductComparisonResult } from "./compare-product.js";
import type { ReferencePageHighlight, ReferencePageMatch } from "./reference-page.js";
import { normalizeReportTypeCode } from "./report-type-inference.js";

export const REPORT_CONTEXT_REPORT_TYPE = "PRODUCT_COMPARISON" as const;

export type ReportContextReferencePage = {
  documentId: string;
  pageId: string;
  documentTitle?: string | null;
  pageLabel?: string | null;
  pageNumber?: number | null;
  physicalPageNumber?: number | null;
  pageImageObjectKey?: string | null;
  summary?: Record<string, unknown>;
  highlights?: ReferencePageHighlight[];
  matches?: ReferencePageMatch[];
};

export type ReportContextSnapshot = {
  id: string;
  conversationId: string;
  projectId?: string | null;
  reportType: string;
  selectedProductIds: string[];
  selectedKnowledgeSourceIds?: string[];
  userGoal?: string;
  confirmedRequirements: string[];
  comparisonContext?: ComparisonContext | unknown;
  comparisonResult?: ProductComparisonResult | unknown;
  sourceRefs: ComparisonSourceRef[] | unknown[];
  thermalResults?: unknown[];
  referencePages?: ReportContextReferencePage[];
  createdAt: string;
};

function cloneHighlight(highlight: ReferencePageHighlight): ReferencePageHighlight {
  return { field: highlight.field, label: highlight.label, value: highlight.value };
}

function cloneMatch(match: ReferencePageMatch): ReferencePageMatch {
  return {
    ...(match.candidateId ? { candidateId: match.candidateId } : {}),
    summary: { ...(match.summary ?? {}) },
    highlights: (match.highlights ?? []).map(cloneHighlight)
  };
}

function cloneReferencePage(page: ReportContextReferencePage): ReportContextReferencePage {
  return {
    documentId: page.documentId,
    pageId: page.pageId,
    documentTitle: page.documentTitle ?? null,
    pageLabel: page.pageLabel ?? null,
    pageNumber: page.pageNumber ?? null,
    physicalPageNumber: page.physicalPageNumber ?? null,
    pageImageObjectKey: page.pageImageObjectKey ?? null,
    summary: page.summary ? { ...page.summary } : undefined,
    highlights: (page.highlights ?? []).map(cloneHighlight),
    matches: (page.matches ?? []).map(cloneMatch)
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function asHighlights(value: unknown): ReferencePageHighlight[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = asRecord(item);
    if (!row) return [];
    const field = typeof row.field === "string" ? row.field : "";
    const label = typeof row.label === "string" ? row.label : field;
    const highlightValue = row.value == null ? "" : String(row.value);
    if (!field && !label && !highlightValue) return [];
    return [{ field: field || label || "value", label: label || field || "参数", value: highlightValue }];
  });
}

function asMatches(value: unknown, fallback?: { summary?: Record<string, unknown>; highlights?: ReferencePageHighlight[] }): ReferencePageMatch[] {
  if (Array.isArray(value) && value.length > 0) {
    return value.flatMap((item) => {
      const row = asRecord(item);
      if (!row) return [];
      const summary = asRecord(row.summary) ?? {};
      const highlights = asHighlights(row.highlights);
      return [{
        ...(typeof row.candidateId === "string" ? { candidateId: row.candidateId } : {}),
        summary,
        highlights
      }];
    });
  }
  if (fallback?.highlights?.length || fallback?.summary) {
    return [{
      summary: { ...(fallback.summary ?? {}) },
      highlights: [...(fallback.highlights ?? [])]
    }];
  }
  return [];
}

function highlightKey(highlight: ReferencePageHighlight): string {
  return `${highlight.field}\0${highlight.label}\0${highlight.value}`;
}

function matchKey(match: ReferencePageMatch): string {
  return [
    match.candidateId ?? "",
    JSON.stringify(match.summary ?? {}),
    (match.highlights ?? []).map(highlightKey).join("|")
  ].join("\0");
}

/** 规范化单条参考页：只保留 objectKey，丢弃短期签名 URL；兼容 REFERENCE_PAGE 块与 stored 形态。 */
export function normalizeStoredReferencePage(input: unknown): ReportContextReferencePage | null {
  const root = asRecord(input);
  if (!root) return null;

  const nestedPage = asRecord(root.page);
  const documentId = typeof root.documentId === "string"
    ? root.documentId
    : typeof nestedPage?.documentId === "string"
      ? nestedPage.documentId
      : "";
  const pageId = typeof root.pageId === "string"
    ? root.pageId
    : typeof nestedPage?.pageId === "string"
      ? nestedPage.pageId
      : "";
  if (!documentId || !pageId) return null;

  const summary = asRecord(root.summary) ?? undefined;
  const highlights = asHighlights(root.highlights);
  const matches = asMatches(root.matches, { summary, highlights });
  const pageNumber = typeof root.pageNumber === "number"
    ? root.pageNumber
    : typeof nestedPage?.pageNumber === "number"
      ? nestedPage.pageNumber
      : typeof root.physicalPageNumber === "number"
        ? root.physicalPageNumber
        : typeof nestedPage?.physicalPageNumber === "number"
          ? nestedPage.physicalPageNumber
          : null;
  const physicalPageNumber = typeof root.physicalPageNumber === "number"
    ? root.physicalPageNumber
    : typeof nestedPage?.physicalPageNumber === "number"
      ? nestedPage.physicalPageNumber
      : pageNumber;
  const pageLabel = typeof root.pageLabel === "string"
    ? root.pageLabel
    : typeof nestedPage?.pageLabel === "string"
      ? nestedPage.pageLabel
      : null;
  const documentTitle = typeof root.documentTitle === "string"
    ? root.documentTitle
    : typeof nestedPage?.documentTitle === "string"
      ? nestedPage.documentTitle
      : null;
  const pageImageObjectKey = typeof root.pageImageObjectKey === "string"
    ? root.pageImageObjectKey
    : typeof nestedPage?.pageImageObjectKey === "string"
      ? nestedPage.pageImageObjectKey
      : null;

  return {
    documentId,
    pageId,
    documentTitle,
    pageLabel,
    pageNumber,
    physicalPageNumber,
    pageImageObjectKey,
    summary: summary ? { ...summary } : matches[0]?.summary ? { ...matches[0].summary } : undefined,
    highlights: highlights.length > 0
      ? highlights.map(cloneHighlight)
      : matches.flatMap((match) => match.highlights.map(cloneHighlight)),
    matches: matches.map(cloneMatch)
  };
}

/** 按 pageId 去重；同页合并 matches/highlights；不保留签名 URL。 */
export function mergeReferencePages(input: unknown[]): ReportContextReferencePage[] {
  const byPageId = new Map<string, ReportContextReferencePage>();
  for (const item of input) {
    const page = normalizeStoredReferencePage(item);
    if (!page) continue;
    const existing = byPageId.get(page.pageId);
    if (!existing) {
      byPageId.set(page.pageId, cloneReferencePage(page));
      continue;
    }
    existing.documentTitle = existing.documentTitle || page.documentTitle || null;
    existing.pageLabel = existing.pageLabel || page.pageLabel || null;
    existing.pageNumber = existing.pageNumber ?? page.pageNumber ?? null;
    existing.physicalPageNumber = existing.physicalPageNumber ?? page.physicalPageNumber ?? null;
    existing.pageImageObjectKey = existing.pageImageObjectKey || page.pageImageObjectKey || null;
    if (!existing.summary && page.summary) existing.summary = { ...page.summary };

    const highlightSeen = new Set((existing.highlights ?? []).map(highlightKey));
    for (const highlight of page.highlights ?? []) {
      const key = highlightKey(highlight);
      if (highlightSeen.has(key)) continue;
      highlightSeen.add(key);
      existing.highlights = [...(existing.highlights ?? []), cloneHighlight(highlight)];
    }

    const matchSeen = new Set((existing.matches ?? []).map(matchKey));
    for (const match of page.matches ?? []) {
      const key = matchKey(match);
      if (matchSeen.has(key)) continue;
      matchSeen.add(key);
      existing.matches = [...(existing.matches ?? []), cloneMatch(match)];
    }
  }
  return [...byPageId.values()].map(cloneReferencePage);
}

export function freezeReportContextSnapshot(snapshot: ReportContextSnapshot): ReportContextSnapshot {
  const comparisonResult = snapshot.comparisonResult && typeof snapshot.comparisonResult === "object"
    ? snapshot.comparisonResult as ProductComparisonResult
    : null;
  return {
    ...snapshot,
    reportType: normalizeReportTypeCode(snapshot.reportType) ?? snapshot.reportType,
    selectedProductIds: [...(snapshot.selectedProductIds ?? [])],
    selectedKnowledgeSourceIds: [...(snapshot.selectedKnowledgeSourceIds ?? [])],
    confirmedRequirements: [...(snapshot.confirmedRequirements ?? [])],
    sourceRefs: Array.isArray(snapshot.sourceRefs) ? snapshot.sourceRefs.map((ref) => ({ ...ref as object })) as ReportContextSnapshot["sourceRefs"] : [],
    thermalResults: [...(snapshot.thermalResults ?? [])],
    referencePages: mergeReferencePages(snapshot.referencePages ?? []),
    comparisonResult: comparisonResult
      ? {
        ...comparisonResult,
        ranking: null,
        scores: null,
        missingNotes: [...(comparisonResult.missingNotes ?? [])],
        products: (comparisonResult.products ?? []).map((item) => ({ ...item })),
        dimensions: (comparisonResult.dimensions ?? []).map((dimension) => ({
          ...dimension,
          items: dimension.items.map((row) => ({ ...row }))
        })),
        evidenceRefs: (comparisonResult.evidenceRefs ?? []).map((ref) => ({ ...ref })),
        thermal: {
          status: comparisonResult.thermal?.status ?? "NOT_AVAILABLE",
          results: [...(comparisonResult.thermal?.results ?? [])]
        }
      }
      : snapshot.comparisonResult,
    comparisonContext: snapshot.comparisonContext && typeof snapshot.comparisonContext === "object"
      ? {
        ...(snapshot.comparisonContext as ComparisonContext),
        productIds: [...((snapshot.comparisonContext as ComparisonContext).productIds ?? [])],
        confirmedRequirements: [...((snapshot.comparisonContext as ComparisonContext).confirmedRequirements ?? [])],
        dimensions: ((snapshot.comparisonContext as ComparisonContext).dimensions ?? []).map((dimension) => ({
          ...dimension,
          items: dimension.items.map((row) => ({ ...row }))
        })),
        evidenceRefs: [...((snapshot.comparisonContext as ComparisonContext).evidenceRefs ?? [])]
      }
      : snapshot.comparisonContext
  };
}

export function buildDeterministicReportDraft(snapshot: ReportContextSnapshot) {
  const comparisonResult = snapshot.comparisonResult && typeof snapshot.comparisonResult === "object"
    ? snapshot.comparisonResult as ProductComparisonResult
    : null;
  const selected = new Set(snapshot.selectedProductIds);
  const products = (comparisonResult?.products ?? []).filter((item) => selected.has(item.id));
  const thermalAvailable = (snapshot.thermalResults?.length ?? 0) > 0
    || comparisonResult?.thermal.status === "AVAILABLE";
  const sections = [
    {
      heading: "对话与项目背景",
      content: [
        snapshot.userGoal ? `用户目标：${snapshot.userGoal}` : "用户目标未单独声明。",
        snapshot.confirmedRequirements.length > 0
          ? `已确认关注点：${snapshot.confirmedRequirements.join("；")}`
          : "无额外已确认关注点。"
      ].join("\n")
    },
    {
      heading: "纳入报告的产品",
      content: products.map((item) => `- ${item.name}${item.summary ? `：${item.summary}` : ""}`).join("\n") || "未选中产品。"
    },
    {
      heading: "对比维度",
      content: (comparisonResult?.dimensions ?? []).map((dimension) => {
        const rows = dimension.items
          .filter((item) => selected.has(item.productId))
          .map((item) => {
            const product = comparisonResult?.products.find((row) => row.id === item.productId);
            const value = item.insufficient || item.value == null || item.value === ""
              ? (item.note ?? "资料不足")
              : String(item.value);
            return `  - ${product?.name ?? item.productId}：${value}`;
          })
          .join("\n");
        return `${dimension.label}${dimension.insufficient ? "（资料不足）" : ""}\n${rows}`;
      }).join("\n\n") || "当前没有结构化对比维度。"
    },
    {
      heading: "差异说明与适用条件",
      content: [
        "以下说明仅基于系统已固化的产品字段、知识证据和用户已确认关注点。",
        ...(comparisonResult?.missingNotes ?? []),
        "系统未做固定评分或唯一最优结论，最终选用需由专业人员复核。"
      ].filter(Boolean).join("\n")
    },
    {
      heading: "来源",
      content: snapshot.sourceRefs.length > 0
        ? snapshot.sourceRefs.map((ref) => {
          const row = ref as { type?: string; label?: string };
          return `- [${row.type ?? "source"}] ${row.label ?? ""}`;
        }).join("\n")
        : "无额外来源。"
    }
  ];
  if (thermalAvailable) {
    sections.push({
      heading: "热工结果",
      content: JSON.stringify(snapshot.thermalResults ?? comparisonResult?.thermal.results ?? [], null, 2)
    });
  }
  return {
    title: "产品对比报告",
    summary: `已纳入 ${products.map((item) => item.name).join("、") || "未选产品"}。热工结果${thermalAvailable ? "已展示" : "当前不可用，报告仍可生成"}。`,
    sections,
    risks: comparisonResult?.missingNotes ?? [],
    disclaimer: "本报告基于用户确认时固化的对比快照生成，不构成唯一最优结论，正式工程结论须由专业人员复核。"
  };
}

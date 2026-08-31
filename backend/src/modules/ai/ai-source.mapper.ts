import type { WikiHit } from "../knowledge/knowledge.service.js";

/**
 * AI 原文溯源统一 Source 契约。
 * 正常生成与重新生成（regenerate）必须复用本 mapper，禁止两套 sources 格式：
 * - 同一来源的 documentId/section/page 不因 regenerate 变化；chunkId 缺失不影响来源稳定性；
 * - page 为兼容字段（等价 pageNumber），APP/PC 端逐步切换到 pageNumber/sectionPath；
 * - 无知识检索/标准/热工证据时 sources 为空数组，不伪造来源。
 */
export type AiSourceType = "KNOWLEDGE" | "STANDARD" | "ATLAS" | "THERMAL" | "OTHER";

export type AiRetrievalUnit = "DOCUMENT" | "SECTION" | "PAGE" | "BLOCK" | "CHUNK";

export interface AiSourceHighlight {
  pageId?: string;
  pageNumber?: number | null;
  pageLabel?: string | null;
  blockId?: string;
  charStart?: number | null;
  charEnd?: number | null;
  text?: string;
}

export interface AiSourceRef {
  sourceType: AiSourceType;
  retrievalUnit?: AiRetrievalUnit;
  documentId?: string;
  versionId?: string;
  sectionId?: string;
  pageId?: string;
  blockId?: string;
  /** 仅 Chunk 辅助索引场景存在，不再是定位必需项 */
  chunkId?: string;
  title: string;
  /** 原文目录路径（done.sources 恒为 null；完整路径由 GET /api/v1/ai/knowledge/source-detail 返回） */
  tocPath?: string[] | null;
  chapter?: string | null;
  section?: string | null;
  sectionPath?: string[] | null;
  citationAnchor?: string | null;
  pageNumber?: number | null;
  /** PDF 物理页序号（程序打开正确页面用；禁止展示给用户） */
  physicalPageNumber?: number | null;
  /** 印刷页码标签（用户展示用：4 / 21 / A1 / A5 / D16 / G10） */
  pageLabel?: string | null;
  pageTitle?: string | null;
  /** ORIGINAL 展示原文件 id（原文载体；预览地址由 source-detail 返回） */
  originalFileId?: string | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  /** 兼容一期字段：等价 pageNumber */
  page?: number | null;
  /** 本次实际命中的原文区域（章节/页面/块/切片内容），不会是整份文档 */
  matchedText?: string | null;
  snippet?: string | null;
  highlightRanges?: AiSourceHighlight[];
  evidenceLevel?: string | null;
  score?: number | null;
}

/** 知识检索命中 → 统一来源引用（正常生成与 regenerate 共用） */
export function toAiSources(hits: readonly WikiHit[]): AiSourceRef[] {
  return hits.map((hit) => {
    const highlight: AiSourceHighlight = {
      pageId: hit.pageId ?? undefined,
      pageNumber: hit.sourcePage,
      pageLabel: hit.pageLabel ?? undefined,
      blockId: hit.pageBlockId ?? undefined,
      text: hit.content
    };
    return {
      sourceType: "KNOWLEDGE" as const,
      retrievalUnit: hit.retrievalUnit,
      documentId: hit.documentId,
      versionId: hit.versionId,
      sectionId: hit.sectionId ?? undefined,
      pageId: hit.pageId ?? undefined,
      blockId: hit.pageBlockId ?? undefined,
      ...(hit.chunkId ? { chunkId: hit.chunkId } : {}),
      title: hit.sourceTitle,
      tocPath: null,
      chapter: hit.headingPath && hit.headingPath.length > 0 ? hit.headingPath[0]! : null,
      section: hit.sourceSection ?? (hit.headingPath && hit.headingPath.length > 0
        ? hit.headingPath[hit.headingPath.length - 1]!
        : null),
      sectionPath: hit.headingPath && hit.headingPath.length > 0 ? [...hit.headingPath] : null,
      citationAnchor: hit.citationAnchor ?? null,
      pageNumber: hit.sourcePage,
      physicalPageNumber: hit.physicalPageNumber ?? hit.sourcePage,
      pageLabel: hit.pageLabel ?? null,
      pageTitle: hit.pageTitle ?? null,
      originalFileId: hit.originalFileId ?? null,
      pageStart: hit.sourcePage,
      pageEnd: hit.pageEnd ?? hit.sourcePage,
      page: hit.sourcePage,
      matchedText: hit.content,
      snippet: hit.snippet ?? null,
      highlightRanges: [highlight],
      evidenceLevel: hit.evidenceLevel ?? null,
      score: hit.score
    };
  });
}

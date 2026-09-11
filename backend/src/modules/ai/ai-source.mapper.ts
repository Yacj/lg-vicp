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
  /** 原文目录/章节路径（C 端展示；与 headingPath 同源） */
  tocPath?: string[] | null;
  /** C 端主要展示用章节标题 */
  sectionTitle?: string | null;
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
  /** C 端引用摘录，与 matchedText 同源 */
  quote?: string | null;
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
    const headingPath = Array.isArray(hit.headingPath) && hit.headingPath.length > 0 ? [...hit.headingPath] : null;
    const sectionTitle = hit.sourceSection ?? (headingPath ? headingPath[headingPath.length - 1]! : null);
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
      tocPath: headingPath,
      sectionTitle,
      chapter: headingPath ? headingPath[0]! : null,
      section: sectionTitle,
      sectionPath: headingPath,
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
      quote: hit.content,
      snippet: hit.snippet ?? null,
      highlightRanges: [highlight],
      evidenceLevel: hit.evidenceLevel ?? null,
      score: hit.score
    };
  });
}

/** B 端当前版本 AI 测试普通视图：只保留章节/页码/引用文字，不含 chunk/score/retrievalUnit。 */
export interface UserTestSource {
  documentId?: string;
  versionId?: string;
  title: string;
  tocPath?: string[] | null;
  sectionTitle?: string | null;
  pageLabel?: string | null;
  physicalPageNumber?: number | null;
  matchedText?: string | null;
  quote?: string | null;
}

export function toUserTestSources(hits: readonly WikiHit[]): UserTestSource[] {
  return hits.map((hit) => ({
    documentId: hit.documentId,
    versionId: hit.versionId,
    title: hit.sourceTitle,
    tocPath: Array.isArray(hit.headingPath) && hit.headingPath.length > 0 ? [...hit.headingPath] : null,
    sectionTitle: hit.sourceSection ?? (Array.isArray(hit.headingPath) && hit.headingPath.length > 0
      ? hit.headingPath[hit.headingPath.length - 1]!
      : null),
    pageLabel: hit.pageLabel ?? null,
    physicalPageNumber: hit.physicalPageNumber ?? hit.sourcePage,
    matchedText: hit.content,
    quote: hit.content
  }));
}

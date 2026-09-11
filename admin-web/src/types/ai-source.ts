/**
 * AI 原文溯源统一 Source 契约（与后端 src/modules/ai/ai-source.mapper.ts 一一对齐）。
 * 所有 AI 会话来源、检索命中、来源详情查看统一复用本类型，禁止各页面自定义 source 结构。
 * 定位优先级：blockId > pageId > sectionId > chunkId > documentId，最终都回到完整页面。
 */

export type AiSourceType = 'KNOWLEDGE' | 'STANDARD' | 'ATLAS' | 'THERMAL' | 'OTHER'

export type AiRetrievalUnit = 'DOCUMENT' | 'SECTION' | 'PAGE' | 'BLOCK' | 'CHUNK'

export interface AiSourceHighlight {
  pageId?: string
  pageNumber?: number | null
  blockId?: string
  charStart?: number | null
  charEnd?: number | null
  text?: string
}

export interface AiSourceRef {
  sourceType: AiSourceType
  retrievalUnit?: AiRetrievalUnit
  documentId?: string
  versionId?: string
  sectionId?: string
  pageId?: string
  blockId?: string
  /** 仅 Chunk 辅助索引场景存在，不再是定位必需项 */
  chunkId?: string
  title: string
  chapter?: string | null
  section?: string | null
  sectionPath?: string[] | null
  citationAnchor?: string | null
  pageNumber?: number | null
  /** PDF 物理页序号（程序定位用） */
  physicalPageNumber?: number | null
  /** 印刷页码标签（用户展示用） */
  pageLabel?: string | null
  pageTitle?: string | null
  originalFileId?: string | null
  pageStart?: number | null
  pageEnd?: number | null
  /** 一期兼容字段：等价 pageNumber */
  page?: number | null
  /** 本次实际命中的原文区域（章节/页面/块/切片内容），不会是整份文档 */
  matchedText?: string | null
  snippet?: string | null
  highlightRanges?: AiSourceHighlight[]
  evidenceLevel?: string | null
  score?: number | null
}

/** 来源定位查询（GET /api/v1/ai/knowledge/source-detail），与后端 querystring 校验一致 */
export interface AiSourceLocatorQuery {
  documentId?: string
  sectionId?: string
  pageId?: string
  blockId?: string
  chunkId?: string
  matchedText?: string
}

// ===== 来源详情（后端 knowledge-wiki-read.service.ts SourceDetail） =====

export interface AiSourceDocumentSummary {
  id: string
  title: string
  versionId: string
  version: number
  docNumber: string | null
  docType: string
  visibility: string
  projectId: string | null
}

export interface AiSourceDetailLocation {
  sectionId: string | null
  chapter: string | null
  section: string | null
  sectionPath: string[] | null
  citationAnchor: string | null
  pageNumber: number | null
  physicalPageNumber: number | null
  pageLabel: string | null
  pageTitle: string | null
}

export interface AiSourcePageBlock {
  id: string
  blockIndex: number
  content: string
  contentType: string
  sourceAnchor: string | null
  metadata: Record<string, unknown> | null
}

export interface AiSourcePage {
  id: string
  pageNumber: number
  physicalPageNumber: number
  pageLabel: string | null
  pageTitle: string | null
  fullText: string
  extractedText: string
  blocks: AiSourcePageBlock[]
  /** P0 阶段后端不渲染 PDF 原页图片；为空时阅读器只展示解析文本，不显示空图 */
  pageImageUrl: string | null
}

export interface AiSourceDetailHighlight {
  pageId: string
  pageNumber: number
  physicalPageNumber: number
  pageLabel: string | null
  blockId: string | null
  text: string
  charStart: number | null
  charEnd: number | null
}

export interface AiSourceDetail {
  document: AiSourceDocumentSummary
  toc: { path: string[] | null }
  location: AiSourceDetailLocation
  original: {
    fileId: string | null
    pageImageUrl: string | null
    previewUrl: string | null
  }
  extracted: {
    text: string | null
    blocks: AiSourcePageBlock[]
  }
  page: AiSourcePage | null
  highlights: AiSourceDetailHighlight[]
}

// ===== 公开文库（C 端公开文库契约，B 端复用同一 Wiki 读取口径） =====

/**
 * 从统一来源引用中挑出最优定位入口（blockId > pageId > sectionId > chunkId > documentId）。
 * 无任何定位信息时返回 null（调用方应禁用"查看原文"入口，而不是猜测）。
 */
export function resolveAiSourceLocator(source: Partial<AiSourceRef>): AiSourceLocatorQuery | null {
  const matchedText = source.matchedText?.slice(0, 2000)
  if (source.blockId) {
    return { blockId: source.blockId, ...(matchedText ? { matchedText } : {}) }
  }
  if (source.pageId) {
    return { pageId: source.pageId, ...(matchedText ? { matchedText } : {}) }
  }
  if (source.sectionId) {
    return { sectionId: source.sectionId, ...(matchedText ? { matchedText } : {}) }
  }
  if (source.chunkId) {
    return { chunkId: source.chunkId, ...(matchedText ? { matchedText } : {}) }
  }
  if (source.documentId) {
    return { documentId: source.documentId, ...(matchedText ? { matchedText } : {}) }
  }
  return null
}

/** 检索命中（平台 /search，Wiki 级字段）→ 统一来源引用 */
export function aiSourceRefFromSearchHit(hit: {
  chunkId?: string
  documentId: string
  versionId?: string
  sectionId?: string | null
  pageId?: string | null
  pageBlockId?: string | null
  sourceTitle: string
  sourcePage: number | null
  physicalPageNumber?: number | null
  pageLabel?: string | null
  pageTitle?: string | null
  originalFileId?: string | null
  pageEnd?: number | null
  sourceSection: string | null
  content?: string
  snippet: string
  citationAnchor?: string | null
  score?: number | null
  evidenceLevel?: string | null
}): AiSourceRef {
  return {
    sourceType: 'KNOWLEDGE',
    retrievalUnit: 'CHUNK',
    documentId: hit.documentId,
    ...(hit.versionId ? { versionId: hit.versionId } : {}),
    ...(hit.sectionId ? { sectionId: hit.sectionId } : {}),
    ...(hit.pageId ? { pageId: hit.pageId } : {}),
    ...(hit.pageBlockId ? { blockId: hit.pageBlockId } : {}),
    ...(hit.chunkId ? { chunkId: hit.chunkId } : {}),
    title: hit.sourceTitle,
    section: hit.sourceSection,
    pageNumber: hit.sourcePage,
    physicalPageNumber: hit.physicalPageNumber ?? hit.sourcePage,
    pageLabel: hit.pageLabel ?? null,
    pageTitle: hit.pageTitle ?? null,
    originalFileId: hit.originalFileId ?? null,
    pageStart: hit.sourcePage,
    pageEnd: hit.pageEnd ?? hit.sourcePage,
    citationAnchor: hit.citationAnchor ?? null,
    matchedText: hit.content ?? hit.snippet,
    snippet: hit.snippet,
    ...(hit.score != null ? { score: hit.score } : {}),
    ...(hit.evidenceLevel ? { evidenceLevel: hit.evidenceLevel } : {}),
  }
}

/** 兼容归一化：老格式（KnowledgeQaSource / AiRetrievalLog 等扁平来源）→ 统一 AiSourceRef */
export function normalizeAiSource(value: unknown): AiSourceRef | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const raw = value as Record<string, unknown>
  const title = typeof raw.title === 'string' && raw.title ? raw.title : typeof raw.sourceTitle === 'string' ? raw.sourceTitle : null
  if (!title) {
    return null
  }
  const documentId = typeof raw.documentId === 'string' ? raw.documentId : undefined
  const chunkId = typeof raw.chunkId === 'string' ? raw.chunkId : undefined
  const pageId = typeof raw.pageId === 'string' ? raw.pageId : undefined
  const sectionId = typeof raw.sectionId === 'string' ? raw.sectionId : undefined
  const blockId = typeof raw.blockId === 'string' ? raw.blockId : undefined
  const pageBlockId = typeof raw.pageBlockId === 'string' ? raw.pageBlockId : undefined
  const pageNumber = typeof raw.pageNumber === 'number'
    ? raw.pageNumber
    : typeof raw.page === 'number'
      ? raw.page
      : typeof raw.sourcePage === 'number'
        ? raw.sourcePage
        : null
  const section = typeof raw.section === 'string'
    ? raw.section
    : typeof raw.sourceSection === 'string'
      ? raw.sourceSection
      : null
  const matchedText = typeof raw.matchedText === 'string'
    ? raw.matchedText
    : typeof raw.content === 'string'
      ? raw.content
      : null
  const snippet = typeof raw.snippet === 'string' ? raw.snippet : null
  const score = typeof raw.score === 'number' ? raw.score : null
  const evidenceLevel = typeof raw.evidenceLevel === 'string' ? raw.evidenceLevel : null

  return {
    sourceType: 'KNOWLEDGE',
    retrievalUnit: blockId ?? pageBlockId ? 'BLOCK' : 'CHUNK',
    ...(documentId ? { documentId } : {}),
    ...(pageId ? { pageId } : {}),
    ...(sectionId ? { sectionId } : {}),
    ...(blockId ?? pageBlockId ? { blockId: blockId ?? pageBlockId } : {}),
    ...(chunkId ? { chunkId } : {}),
    title,
    section,
    pageNumber,
    physicalPageNumber: typeof raw.physicalPageNumber === 'number' ? raw.physicalPageNumber : pageNumber,
    pageLabel: typeof raw.pageLabel === 'string' ? raw.pageLabel : null,
    pageTitle: typeof raw.pageTitle === 'string' ? raw.pageTitle : null,
    originalFileId: typeof raw.originalFileId === 'string' ? raw.originalFileId : null,
    pageStart: pageNumber,
    pageEnd: pageNumber,
    matchedText,
    snippet,
    ...(score !== null ? { score } : {}),
    ...(evidenceLevel ? { evidenceLevel } : {}),
  }
}

export const AI_RETRIEVAL_UNIT_LABELS: Record<AiRetrievalUnit, string> = {
  DOCUMENT: '整份资料',
  SECTION: '章节',
  PAGE: '页面',
  BLOCK: '内容',
  CHUNK: '内容',
}

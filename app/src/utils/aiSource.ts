import type { AiRetrievalRecord, AiSourceLocatorQuery, AiSourceRef } from '@/api/types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return null
  }
  const items = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map(item => item.trim())
  return items.length ? items : null
}

function asUuid(value: unknown) {
  const text = asString(value)
  return text && UUID_PATTERN.test(text) ? text : undefined
}

/** 兼容 SSE / 历史检索日志的扁平来源 → 统一 AiSourceRef。无标题则丢弃，避免空卡片。 */
export function normalizeAiSource(value: unknown): AiSourceRef | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const raw = value as Record<string, unknown>
  const title = asString(raw.title) || asString(raw.sourceTitle)
  if (!title) {
    return null
  }

  const pageNumber = asNumber(raw.pageNumber) ?? asNumber(raw.page) ?? asNumber(raw.sourcePage)
  const physicalPageNumber = asNumber(raw.physicalPageNumber) ?? pageNumber
  const quote = asString(raw.quote) || asString(raw.matchedText) || asString(raw.snippet)

  return {
    sourceType: 'KNOWLEDGE',
    title,
    documentId: asUuid(raw.documentId),
    versionId: asUuid(raw.versionId),
    sectionId: asUuid(raw.sectionId),
    pageId: asUuid(raw.pageId),
    blockId: asUuid(raw.blockId) ?? asUuid(raw.pageBlockId),
    chunkId: asUuid(raw.chunkId),
    tocPath: asStringArray(raw.tocPath) ?? asStringArray(raw.sectionPath),
    sectionTitle: asString(raw.sectionTitle) || asString(raw.section) || asString(raw.sourceSection),
    chapter: asString(raw.chapter),
    section: asString(raw.section) || asString(raw.sourceSection),
    sectionPath: asStringArray(raw.sectionPath) ?? asStringArray(raw.tocPath),
    pageNumber,
    physicalPageNumber,
    pageLabel: asString(raw.pageLabel),
    pageTitle: asString(raw.pageTitle),
    originalFileId: asUuid(raw.originalFileId) ?? null,
    page: pageNumber,
    matchedText: asString(raw.matchedText) || quote,
    quote,
    snippet: asString(raw.snippet),
  }
}

export function normalizeAiSources(value: unknown): AiSourceRef[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map(normalizeAiSource).filter((item): item is AiSourceRef => Boolean(item))
}

export function sourceFromRetrieval(record: AiRetrievalRecord): AiSourceRef | null {
  const title = record.sourceTitle?.trim()
  if (!title && !record.documentId && !record.chunkId) {
    return null
  }
  return {
    title: title || '知识资料',
    documentId: record.documentId ?? undefined,
    chunkId: record.chunkId ?? undefined,
    physicalPageNumber: record.sourcePage,
    page: record.sourcePage,
  }
}

export function resolveAiSourceLocator(source: Partial<AiSourceRef>): AiSourceLocatorQuery | null {
  const matchedText = source.matchedText?.slice(0, 2000) || source.quote?.slice(0, 2000)
  const extra = matchedText ? { matchedText } : {}
  if (source.blockId) {
    return { blockId: source.blockId, ...extra }
  }
  if (source.pageId) {
    return { pageId: source.pageId, ...extra }
  }
  if (source.sectionId) {
    return { sectionId: source.sectionId, ...extra }
  }
  if (source.chunkId) {
    return { chunkId: source.chunkId, ...extra }
  }
  if (source.documentId) {
    return { documentId: source.documentId, ...extra }
  }
  return null
}

export function sourceChapterPath(source: AiSourceRef) {
  if (source.tocPath?.length) {
    return source.tocPath
  }
  if (source.sectionPath?.length) {
    return source.sectionPath
  }
  return [source.chapter, source.sectionTitle || source.section].filter((item): item is string => Boolean(item))
}

/** 用户主页码：只展示 pageLabel，不回退到物理页。 */
export function sourcePageLabel(source: AiSourceRef) {
  return source.pageLabel?.trim() || null
}

export function sourceQuote(source: AiSourceRef) {
  const text = (source.quote || source.matchedText || source.snippet || '').replace(/\s+/g, ' ').trim()
  if (!text) {
    return null
  }
  return text.length > 72 ? `${text.slice(0, 72)}…` : text
}

export function canOpenOriginal(source: AiSourceRef) {
  return Boolean(resolveAiSourceLocator(source) || source.originalFileId)
}

export function compactQuery(query: Record<string, string | number | null | undefined>) {
  const params: Record<string, string> = {}
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') {
      continue
    }
    params[key] = String(value)
  }
  return params
}

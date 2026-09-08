import type { PageResult } from '@/types/api'
import type {
  KnowledgeAlias,
  KnowledgeAliasInput,
  KnowledgeAliasQuery,
  KnowledgeCategory,
  KnowledgeCategoryInput,
  KnowledgeChunk,
  KnowledgeChunkEditInput,
  KnowledgeChunkTerm,
  KnowledgeCrawlerSource,
  KnowledgeCrawlerSourceInput,
  KnowledgeDocument,
  KnowledgeDocumentDetail,
  KnowledgeDocumentInput,
  KnowledgeDocumentQuery,
  KnowledgeDocumentAsset,
  KnowledgeParsingJob,
  KnowledgeParsingJobQuery,
  KnowledgeDocumentVersion,
  KnowledgePage,
  KnowledgePageMappingsResult,
  KnowledgePageWindow,
  KnowledgeTocItem,
  KnowledgeVersionAssetsResult,
  KnowledgeVersionTocResult,
  KnowledgeAssetRole,
  KnowledgeUsageMode,
  KnowledgeTocSource,
  KnowledgeTocStatus,
  KnowledgeEvaluation,
  KnowledgeEvaluationInput,
  KnowledgeEvaluationQuery,
  KnowledgeQaRequest,
  KnowledgeQaSseEvent,
  KnowledgeRankingRule,
  KnowledgeSearchLog,
  KnowledgeSearchLogQuery,
  KnowledgeSearchQuery,
  KnowledgeSearchResult,
  KnowledgeUploadIntent,
  KnowledgeUploadIntentInput,
  KnowledgeVersionInput,
  KnowledgeVersionSection,
  MutationMessageResponse,
  PublicLibraryDocumentDetail,
  PublicLibraryDocumentItem,
  PublicLibraryDocumentQuery,
  PublicLibraryPageDetail,
  PublicLibraryPageListItem,
  PublicLibraryTocResult,
} from '@/types/knowledge'
import { api, getHttpAccessToken, httpBaseURL } from '@/api/http/client'
import { B_ADMIN_CLIENT } from '@/types/auth'
import { HttpRequestError } from '@/types/error'

const KNOWLEDGE_PREFIX = '/api/v1/platform/knowledge'
const AI_PREFIX = '/api/v1/ai'

function resourcePath(resource: string, id: string): string {
  return `${KNOWLEDGE_PREFIX}/${resource}/${encodeURIComponent(id)}`
}

// ===== 分类 =====

export function fetchKnowledgeCategories(signal?: AbortSignal): Promise<{ items: KnowledgeCategory[] }> {
  return api.get<{ items: KnowledgeCategory[] }>(`${KNOWLEDGE_PREFIX}/categories`, { signal })
}

export function createKnowledgeCategory(input: KnowledgeCategoryInput): Promise<{ category: KnowledgeCategory }> {
  return api.post<{ category: KnowledgeCategory }>(`${KNOWLEDGE_PREFIX}/categories`, input)
}

export function updateKnowledgeCategory(
  id: string,
  input: Partial<KnowledgeCategoryInput>,
): Promise<{ category: KnowledgeCategory }> {
  return api.patch<{ category: KnowledgeCategory }>(resourcePath('categories', id), input)
}

export function deleteKnowledgeCategory(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('categories', id))
}

// ===== 文档 =====

export function fetchKnowledgeDocuments(
  query: KnowledgeDocumentQuery,
  signal?: AbortSignal,
): Promise<PageResult<KnowledgeDocument>> {
  return api.get<PageResult<KnowledgeDocument>>(`${KNOWLEDGE_PREFIX}/documents`, { params: query, signal })
}

export function createKnowledgeDocument(input: KnowledgeDocumentInput): Promise<{ document: KnowledgeDocument }> {
  return api.post<{ document: KnowledgeDocument }>(`${KNOWLEDGE_PREFIX}/documents`, input)
}

export function updateKnowledgeDocument(
  id: string,
  input: Partial<KnowledgeDocumentInput>,
): Promise<{ document: KnowledgeDocument }> {
  return api.patch<{ document: KnowledgeDocument }>(resourcePath('documents', id), input)
}

export function deleteKnowledgeDocument(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('documents', id))
}

export function fetchKnowledgeDocumentDetail(id: string, signal?: AbortSignal): Promise<KnowledgeDocumentDetail> {
  return api.get<KnowledgeDocumentDetail>(resourcePath('documents', id), { signal })
}

// ===== 文档版本 =====

export function createKnowledgeVersion(
  documentId: string,
  input: KnowledgeVersionInput,
): Promise<{ version: KnowledgeDocumentVersion }> {
  return api.post<{ version: KnowledgeDocumentVersion }>(`${KNOWLEDGE_PREFIX}/documents/${encodeURIComponent(documentId)}/versions`, input)
}

export function createKnowledgeUploadIntent(
  versionId: string,
  input: KnowledgeUploadIntentInput,
): Promise<KnowledgeUploadIntent> {
  return api.post<KnowledgeUploadIntent>(`${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/upload-intent`, input)
}

export function completeKnowledgeUpload(
  versionId: string,
  fileId: string,
  assetRole?: KnowledgeAssetRole,
): Promise<MutationMessageResponse> {
  return api.post<MutationMessageResponse>(
    `${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/upload-complete`,
    { fileId, ...(assetRole ? { assetRole } : {}) },
  )
}

export function fetchVersionAssets(versionId: string, signal?: AbortSignal): Promise<KnowledgeVersionAssetsResult> {
  return api.get<KnowledgeVersionAssetsResult>(`${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/assets`, { signal })
}

export function updateVersionAsset(
  versionId: string,
  assetId: string,
  input: { isPrimary?: boolean },
): Promise<{ asset: KnowledgeDocumentAsset }> {
  return api.patch<{ asset: KnowledgeDocumentAsset }>(
    `${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/assets/${encodeURIComponent(assetId)}`,
    input,
  )
}

export function deleteVersionAsset(versionId: string, assetId: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(
    `${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/assets/${encodeURIComponent(assetId)}`,
  )
}

export function fetchVersionToc(versionId: string, signal?: AbortSignal): Promise<KnowledgeVersionTocResult> {
  return api.get<KnowledgeVersionTocResult>(`${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/toc`, { signal })
}

export interface KnowledgeTocItemInput {
  title: string
  pageLabel?: string | null
  physicalPageNumber?: number | null
  parentId?: string | null
  level?: number
  source?: KnowledgeTocSource
  sectionId?: string | null
}

export function replaceVersionToc(
  versionId: string,
  items: KnowledgeTocItemInput[],
  confirm = false,
): Promise<{ message: string, itemCount: number }> {
  return api.post<{ message: string, itemCount: number }>(
    `${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/toc`,
    { confirm, items },
  )
}

export function updateKnowledgeTocItem(
  tocId: string,
  input: Partial<KnowledgeTocItemInput> & { status?: KnowledgeTocStatus },
): Promise<{ item: KnowledgeTocItem }> {
  return api.patch<{ item: KnowledgeTocItem }>(`${KNOWLEDGE_PREFIX}/toc/${encodeURIComponent(tocId)}`, input)
}

export function deleteKnowledgeTocItem(tocId: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(`${KNOWLEDGE_PREFIX}/toc/${encodeURIComponent(tocId)}`)
}

export function reorderVersionToc(
  versionId: string,
  items: Array<{ id: string, sortOrder: number, parentId?: string | null, level?: number }>,
): Promise<MutationMessageResponse> {
  return api.post<MutationMessageResponse>(
    `${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/toc/reorder`,
    { items },
  )
}

export function remapVersionToc(versionId: string): Promise<MutationMessageResponse> {
  return api.post<MutationMessageResponse>(`${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/toc/remap`)
}

export function fetchVersionPageMappings(versionId: string, signal?: AbortSignal): Promise<KnowledgePageMappingsResult> {
  return api.get<KnowledgePageMappingsResult>(`${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/page-mappings`, { signal })
}

export function verifyVersionPageMappings(
  versionId: string,
  mappings: Array<{ searchPhysicalPageNumber: number, originalPhysicalPageNumber: number, pageLabel?: string | null }>,
): Promise<MutationMessageResponse & { count: number }> {
  return api.put<MutationMessageResponse & { count: number }>(
    `${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/page-mappings/verify`,
    { mappings },
  )
}

export function updateVersionPage(
  versionId: string,
  physicalPageNumber: number,
  input: { pageLabel?: string | null, pageTitle?: string | null },
): Promise<{ page: KnowledgePage }> {
  return api.patch<{ page: KnowledgePage }>(
    `${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/pages/${physicalPageNumber}`,
    input,
  )
}

export function updateVersionUsageMode(
  versionId: string,
  usageMode: KnowledgeUsageMode,
): Promise<{ version: KnowledgeDocumentVersion }> {
  return api.patch<{ version: KnowledgeDocumentVersion }>(
    `${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/usage-mode`,
    { usageMode },
  )
}

export function upgradeKnowledgeParse(versionId: string): Promise<MutationMessageResponse & { jobId: string }> {
  return api.post<MutationMessageResponse & { jobId: string }>(
    `${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/upgrade-parse`,
  )
}


export function startKnowledgeParse(versionId: string): Promise<MutationMessageResponse & { jobId: string }> {
  return api.post<MutationMessageResponse & { jobId: string }>(`${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/parse`)
}

export function restartKnowledgeParse(versionId: string): Promise<MutationMessageResponse & { jobId: string }> {
  return api.post<MutationMessageResponse & { jobId: string }>(`${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/reparse`)
}

export function rebuildKnowledgeChunks(versionId: string): Promise<MutationMessageResponse & { jobId: string }> {
  return api.post<MutationMessageResponse & { jobId: string }>(`${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/chunks/rebuild`)
}

export function approveKnowledgeVersion(versionId: string, approvalNote?: string): Promise<{ version: KnowledgeDocumentVersion }> {
  return api.post<{ version: KnowledgeDocumentVersion }>(`${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/approve`, { approvalNote })
}

export function publishKnowledgeVersion(versionId: string): Promise<{ version: KnowledgeDocumentVersion }> {
  return api.post<{ version: KnowledgeDocumentVersion }>(`${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/publish`)
}

export function disableKnowledgeVersion(versionId: string): Promise<{ version: KnowledgeDocumentVersion }> {
  return api.post<{ version: KnowledgeDocumentVersion }>(`${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/disable`)
}

export function rollbackKnowledgeVersion(documentId: string, versionId: string): Promise<{ version: KnowledgeDocumentVersion }> {
  return api.post<{ version: KnowledgeDocumentVersion }>(
    `${KNOWLEDGE_PREFIX}/documents/${encodeURIComponent(documentId)}/rollback-to/${encodeURIComponent(versionId)}`,
  )
}

export function deleteKnowledgeDocumentVersion(versionId: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(`${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}`)
}

// ===== 页面与分块 =====

export function fetchVersionPageWindow(
  versionId: string,
  center: number,
  before = 2,
  after = 2,
  signal?: AbortSignal,
): Promise<KnowledgePageWindow> {
  return api.get<KnowledgePageWindow>(`${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/pages/window`, {
    params: { center, before, after },
    signal,
  })
}

export function fetchVersionPages(
  versionId: string,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<PageResult<KnowledgePage>> {
  return api.get<PageResult<KnowledgePage>>(`${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/pages`, {
    params: { page, pageSize },
    signal,
  })
}

export function fetchVersionChunks(
  versionId: string,
  page: number,
  pageSize: number,
  contentType?: string,
  signal?: AbortSignal,
): Promise<PageResult<KnowledgeChunk>> {
  return api.get<PageResult<KnowledgeChunk>>(`${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/chunks`, {
    params: { page, pageSize, ...(contentType ? { contentType } : {}) },
    signal,
  })
}

export function fetchChunkTerms(chunkId: string, signal?: AbortSignal): Promise<{ items: KnowledgeChunkTerm[] }> {
  return api.get<{ items: KnowledgeChunkTerm[] }>(`${KNOWLEDGE_PREFIX}/chunks/${encodeURIComponent(chunkId)}/terms`, { signal })
}

export function updateKnowledgeChunk(chunkId: string, input: KnowledgeChunkEditInput): Promise<{ chunk: KnowledgeChunk }> {
  return api.patch<{ chunk: KnowledgeChunk }>(`${KNOWLEDGE_PREFIX}/chunks/${encodeURIComponent(chunkId)}`, input)
}

export function splitKnowledgeChunk(chunkId: string, at: number, heading?: string): Promise<MutationMessageResponse> {
  return api.post<MutationMessageResponse>(`${KNOWLEDGE_PREFIX}/chunks/${encodeURIComponent(chunkId)}/split`, { at, heading })
}

export function mergeKnowledgeChunk(chunkId: string, intoChunkId: string): Promise<{ chunk: KnowledgeChunk }> {
  return api.post<{ chunk: KnowledgeChunk }>(`${KNOWLEDGE_PREFIX}/chunks/${encodeURIComponent(chunkId)}/merge`, { intoChunkId })
}

// ===== 检索 =====

export function searchKnowledge(
  query: KnowledgeSearchQuery,
  signal?: AbortSignal,
): Promise<KnowledgeSearchResult> {
  return api.get<KnowledgeSearchResult>(`${KNOWLEDGE_PREFIX}/search`, { params: query, signal })
}

// ===== 检索评测 =====

export function createKnowledgeEvaluation(input: KnowledgeEvaluationInput): Promise<{ evaluation: KnowledgeEvaluation }> {
  return api.post<{ evaluation: KnowledgeEvaluation }>(`${KNOWLEDGE_PREFIX}/evaluations`, input)
}

export function fetchKnowledgeEvaluations(
  query: KnowledgeEvaluationQuery,
  signal?: AbortSignal,
): Promise<PageResult<KnowledgeEvaluation>> {
  return api.get<PageResult<KnowledgeEvaluation>>(`${KNOWLEDGE_PREFIX}/evaluations`, { params: query, signal })
}

export function judgeKnowledgeEvaluation(
  id: string,
  input: { judgement: 'APPROVED' | 'REJECTED' | 'PARTIAL', note?: string },
): Promise<{ evaluation: KnowledgeEvaluation }> {
  return api.post<{ evaluation: KnowledgeEvaluation }>(`${KNOWLEDGE_PREFIX}/evaluations/${encodeURIComponent(id)}/judge`, input)
}

// ===== 检索 + AI 回答（SSE） =====

const KNOWLEDGE_QA_URL = `${AI_PREFIX}/knowledge-qa`
const KNOWN_QA_SSE_EVENTS = new Set(['message', 'progress', 'delta', 'done', 'stopped', 'error'])
const TERMINAL_QA_SSE_EVENTS = new Set(['done', 'stopped', 'error'])

function joinApiUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

export interface KnowledgeQaStreamOptions {
  signal?: AbortSignal
  onEvent: (event: KnowledgeQaSseEvent) => void
}

/**
 * 发起知识检索问答（SSE 流式）：后端先执行真实检索，再流式返回 AI 回答。
 * 非 200 响应（含敏感词拦截等前置校验失败）统一抛 HttpRequestError。
 */
export async function postKnowledgeQa(body: KnowledgeQaRequest, options: KnowledgeQaStreamOptions): Promise<void> {
  const token = getHttpAccessToken()
  const response = await fetch(joinApiUrl(httpBaseURL, KNOWLEDGE_QA_URL), {
    method: 'POST',
    headers: {
      'Accept': 'text/event-stream',
      'Content-Type': 'application/json',
      'X-Client-Type': B_ADMIN_CLIENT,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: options.signal,
  })

  if (!response.ok) {
    let payload: { error?: { message?: string } } | null = null
    try {
      payload = await response.json() as { error?: { message?: string } }
    }
    catch {
      // 非 JSON 错误体时仅保留状态码
    }
    throw new HttpRequestError(payload?.error?.message ?? `知识问答请求失败（HTTP ${response.status}）`, { status: response.status })
  }

  if (!response.body) {
    throw new HttpRequestError('当前浏览器不支持流式响应')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      buffer += decoder.decode(value, { stream: true })
      let separatorIndex = buffer.indexOf('\n\n')
      while (separatorIndex !== -1) {
        const frameText = buffer.slice(0, separatorIndex)
        buffer = buffer.slice(separatorIndex + 2)
        separatorIndex = buffer.indexOf('\n\n')
        const event = parseKnowledgeQaFrame(frameText)
        if (!event) {
          continue
        }
        options.onEvent(event)
        if (TERMINAL_QA_SSE_EVENTS.has(event.type)) {
          await reader.cancel().catch(() => {})
          return
        }
      }
    }
  }
  finally {
    try {
      reader.releaseLock()
    }
    catch {
      // cancel 后 reader 锁已释放，无需再次释放
    }
  }
}

function parseKnowledgeQaFrame(frameText: string): KnowledgeQaSseEvent | null {
  let event = ''
  const dataLines: string[] = []
  for (const line of frameText.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
    }
    else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
  }
  if (dataLines.length === 0 || !KNOWN_QA_SSE_EVENTS.has(event)) {
    return null
  }
  try {
    return { type: event as KnowledgeQaSseEvent['type'], data: JSON.parse(dataLines.join('\n')) } as KnowledgeQaSseEvent
  }
  catch {
    return null
  }
}

// ===== 别名 =====

export function fetchKnowledgeAliases(
  query: KnowledgeAliasQuery,
  signal?: AbortSignal,
): Promise<PageResult<KnowledgeAlias>> {
  return api.get<PageResult<KnowledgeAlias>>(`${KNOWLEDGE_PREFIX}/aliases`, { params: query, signal })
}

export function createKnowledgeAlias(input: KnowledgeAliasInput): Promise<{ alias: KnowledgeAlias }> {
  return api.post<{ alias: KnowledgeAlias }>(`${KNOWLEDGE_PREFIX}/aliases`, input)
}

export function updateKnowledgeAlias(
  id: string,
  input: Partial<KnowledgeAliasInput>,
): Promise<{ alias: KnowledgeAlias }> {
  return api.patch<{ alias: KnowledgeAlias }>(resourcePath('aliases', id), input)
}

export function deleteKnowledgeAlias(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('aliases', id))
}

// ===== 抓取源 =====

export function fetchKnowledgeCrawlerSources(
  query: { enabled?: boolean },
  signal?: AbortSignal,
): Promise<{ items: KnowledgeCrawlerSource[] }> {
  return api.get<{ items: KnowledgeCrawlerSource[] }>(`${KNOWLEDGE_PREFIX}/crawler-sources`, { params: query, signal })
}

export function createKnowledgeCrawlerSource(input: KnowledgeCrawlerSourceInput): Promise<{ source: KnowledgeCrawlerSource }> {
  return api.post<{ source: KnowledgeCrawlerSource }>(`${KNOWLEDGE_PREFIX}/crawler-sources`, input)
}

export function updateKnowledgeCrawlerSource(
  id: string,
  input: Partial<KnowledgeCrawlerSourceInput>,
): Promise<{ source: KnowledgeCrawlerSource }> {
  return api.patch<{ source: KnowledgeCrawlerSource }>(`${KNOWLEDGE_PREFIX}/crawler-sources/${encodeURIComponent(id)}`, input)
}

export function deleteKnowledgeCrawlerSource(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(`${KNOWLEDGE_PREFIX}/crawler-sources/${encodeURIComponent(id)}`)
}

export function runKnowledgeCrawlerSource(id: string): Promise<{ sourceName: string, ingested: boolean, fileId: string, message: string }> {
  return api.post<{ sourceName: string, ingested: boolean, fileId: string, message: string }>(
    `${KNOWLEDGE_PREFIX}/crawler-sources/${encodeURIComponent(id)}/run`,
  )
}

// ===== 检索日志 =====

export function fetchKnowledgeSearchLogs(
  query: KnowledgeSearchLogQuery,
  signal?: AbortSignal,
): Promise<PageResult<KnowledgeSearchLog>> {
  return api.get<PageResult<KnowledgeSearchLog>>(`${KNOWLEDGE_PREFIX}/search-logs`, { params: query, signal })
}

// ===== 解析任务 =====

export function fetchKnowledgeParsingJobs(
  query: KnowledgeParsingJobQuery,
  signal?: AbortSignal,
): Promise<PageResult<KnowledgeParsingJob>> {
  return api.get<PageResult<KnowledgeParsingJob>>(`${KNOWLEDGE_PREFIX}/parsing-jobs`, { params: query, signal })
}

// ===== 排序规则 =====

export function fetchKnowledgeRankingRules(signal?: AbortSignal): Promise<{ items: KnowledgeRankingRule[] }> {
  return api.get<{ items: KnowledgeRankingRule[] }>(`${KNOWLEDGE_PREFIX}/ranking-rules`, { signal })
}

export function updateKnowledgeRankingRule(
  key: string,
  input: { weight?: number, enabled?: boolean, description?: string },
): Promise<{ rule: KnowledgeRankingRule }> {
  return api.patch<{ rule: KnowledgeRankingRule }>(`${KNOWLEDGE_PREFIX}/ranking-rules/${encodeURIComponent(key)}`, input)
}

// ===== 公开文库 =====
// 复用 C 端公开文库 Wiki 读取契约（visibility=PUBLIC + PUBLISHED + 生效中，服务端强制过滤），
// 与知识文档详情、AI 来源详情共用同一套文档/章节/页面数据。
// B 端走平台路由 `/platform/knowledge/public/documents`（后端与 C 端 `/client/knowledge/documents` 同一读取口径）。

export function fetchPublicLibraryDocuments(
  query: PublicLibraryDocumentQuery,
  signal?: AbortSignal,
): Promise<{ items: PublicLibraryDocumentItem[], total: number, page: number, pageSize: number }> {
  return api.get(`${KNOWLEDGE_PREFIX}/public/documents`, { params: query, signal })
}

export function fetchPublicLibraryDocumentDetail(
  documentId: string,
  signal?: AbortSignal,
): Promise<PublicLibraryDocumentDetail> {
  return api.get<PublicLibraryDocumentDetail>(`${KNOWLEDGE_PREFIX}/public/documents/${encodeURIComponent(documentId)}`, { signal })
}

export function fetchPublicLibraryDocumentPages(
  documentId: string,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<{ items: PublicLibraryPageListItem[], total: number }> {
  return api.get<{ items: PublicLibraryPageListItem[], total: number }>(`${KNOWLEDGE_PREFIX}/public/documents/${encodeURIComponent(documentId)}/pages`, {
    params: { page, pageSize },
    signal,
  })
}

export function fetchPublicLibraryDocumentToc(
  documentId: string,
  signal?: AbortSignal,
): Promise<PublicLibraryTocResult> {
  return api.get<PublicLibraryTocResult>(`${KNOWLEDGE_PREFIX}/public/documents/${encodeURIComponent(documentId)}/toc`, { signal })
}

export function fetchPublicLibraryDocumentPageByLabel(
  documentId: string,
  pageLabel: string,
  signal?: AbortSignal,
): Promise<{ page: PublicLibraryPageDetail }> {
  return api.get<{ page: PublicLibraryPageDetail }>(
    `${KNOWLEDGE_PREFIX}/public/documents/${encodeURIComponent(documentId)}/pages/by-label/${encodeURIComponent(pageLabel)}`,
    { signal },
  )
}

export function fetchPublicLibraryDocumentPage(
  documentId: string,
  physicalPageNumber: number,
  signal?: AbortSignal,
): Promise<{ page: PublicLibraryPageDetail }> {
  return api.get<{ page: PublicLibraryPageDetail }>(
    `${KNOWLEDGE_PREFIX}/public/documents/${encodeURIComponent(documentId)}/pages/${physicalPageNumber}`,
    { signal },
  )
}

// ===== 检索页到正式原文页映射 =====

export function fetchVersionSections(
  versionId: string,
  signal?: AbortSignal,
): Promise<{ sections: KnowledgeVersionSection[] }> {
  return api.get(`${KNOWLEDGE_PREFIX}/versions/${encodeURIComponent(versionId)}/sections`, { signal })
}

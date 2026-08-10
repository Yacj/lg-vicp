import { api } from '@/api/http/client'
import type { PageResult } from '@/types/api'
import type {
  KnowledgeAlias,
  KnowledgeAliasInput,
  KnowledgeAliasQuery,
  KnowledgeCategory,
  KnowledgeCategoryInput,
  KnowledgeCrawlerSource,
  KnowledgeCrawlerSourceInput,
  KnowledgeDocument,
  KnowledgeDocumentInput,
  KnowledgeDocumentQuery,
  KnowledgeParsingJob,
  KnowledgeParsingJobQuery,
  KnowledgeRankingRule,
  KnowledgeSearchLog,
  KnowledgeSearchLogQuery,
  MutationMessageResponse,
} from '@/types/knowledge'

const KNOWLEDGE_PREFIX = '/api/v1/platform/knowledge'

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

export function runKnowledgeCrawlerSource(id: string): Promise<{ sourceName: string; ingested: boolean; fileId: string; message: string }> {
  return api.post<{ sourceName: string; ingested: boolean; fileId: string; message: string }>(
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
  input: { weight?: number; enabled?: boolean; description?: string },
): Promise<{ rule: KnowledgeRankingRule }> {
  return api.patch<{ rule: KnowledgeRankingRule }>(`${KNOWLEDGE_PREFIX}/ranking-rules/${encodeURIComponent(key)}`, input)
}
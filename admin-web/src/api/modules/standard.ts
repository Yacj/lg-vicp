import { api } from '@/api/http/client'
import type { StandardCrawlJob, StandardDocument, StandardIndicator, StandardReplacement, StandardSource } from '@/types/standard'

const STANDARD_PREFIX = '/api/v1/platform/standard'

function resourcePath(resource: string, id: string): string {
  return `${STANDARD_PREFIX}/${resource}/${encodeURIComponent(id)}`
}

// ===== 采集来源 =====

export function fetchStandardSources(query: { enabled?: boolean }, signal?: AbortSignal): Promise<StandardSource[]> {
  return api.get<StandardSource[]>(`${STANDARD_PREFIX}/sources`, { params: query, signal })
}

export function createStandardSource(input: import('@/types/standard').StandardSourceInput): Promise<StandardSource> {
  return api.post<StandardSource>(`${STANDARD_PREFIX}/sources`, input)
}

export function updateStandardSource(
  id: string,
  input: Partial<import('@/types/standard').StandardSourceInput>,
): Promise<StandardSource> {
  return api.patch<StandardSource>(resourcePath('sources', id), input)
}

export function deleteStandardSource(id: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(resourcePath('sources', id))
}

export function runStandardSourceCrawl(id: string, scope?: 'today' | 'all'): Promise<StandardCrawlJob> {
  return api.post<StandardCrawlJob>(`${resourcePath('sources', id)}/crawl`, scope ? { scope } : undefined)
}

// ===== 抓取作业 =====

export function fetchStandardCrawlJobs(
  query: { sourceId?: string; status?: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' },
  signal?: AbortSignal,
): Promise<StandardCrawlJob[]> {
  return api.get<StandardCrawlJob[]>(`${STANDARD_PREFIX}/crawl-jobs`, { params: query, signal })
}

// ===== 标准文档 =====

export function fetchStandardDocuments(
  query: {
    provinceCode?: string
    documentNo?: string
    standardStatus?: string
    reviewStatus?: string
    ingestType?: string
    sourceId?: string
  },
  signal?: AbortSignal,
): Promise<StandardDocument[]> {
  return api.get<StandardDocument[]>(`${STANDARD_PREFIX}/documents`, { params: query, signal })
}

export function createStandardDocument(
  input: import('@/types/standard').StandardDocumentInput,
): Promise<StandardDocument> {
  return api.post<StandardDocument>(`${STANDARD_PREFIX}/documents`, input)
}

export function updateStandardDocument(
  id: string,
  input: Partial<import('@/types/standard').StandardDocumentUpdateInput>,
): Promise<StandardDocument> {
  return api.patch<StandardDocument>(resourcePath('documents', id), input)
}

export function deleteStandardDocument(id: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(resourcePath('documents', id))
}

export function runStandardDocumentWorkflow(
  id: string,
  action: 'submit' | 'approve' | 'reject' | 'publish',
  body?: { approvalNote?: string; rejectReason?: string },
): Promise<StandardDocument> {
  return api.post<StandardDocument>(`${resourcePath('documents', id)}/${action}`, body)
}

// ===== 指标 =====

export function fetchStandardIndicators(
  query: { documentId?: string; reviewStatus?: string; indicatorType?: string },
  signal?: AbortSignal,
): Promise<StandardIndicator[]> {
  return api.get<StandardIndicator[]>(`${STANDARD_PREFIX}/indicators`, { params: query, signal })
}

export function runStandardIndicatorWorkflow(
  id: string,
  action: 'approve' | 'reject' | 'publish',
  body?: { approvalNote?: string; rejectReason?: string },
): Promise<StandardIndicator> {
  return api.post<StandardIndicator>(`${resourcePath('indicators', id)}/${action}`, body)
}

// ===== 替代关系 =====

export function fetchStandardReplacements(
  query: { status?: 'PENDING' | 'CONFIRMED' | 'REJECTED' },
  signal?: AbortSignal,
): Promise<StandardReplacement[]> {
  return api.get<StandardReplacement[]>(`${STANDARD_PREFIX}/replacements`, { params: query, signal })
}

export function createStandardReplacement(
  input: import('@/types/standard').StandardReplacementInput,
): Promise<StandardReplacement> {
  return api.post<StandardReplacement>(`${STANDARD_PREFIX}/replacements`, input)
}

export function deleteStandardReplacement(id: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(resourcePath('replacements', id))
}

export function confirmStandardReplacement(id: string): Promise<StandardReplacement> {
  return api.post<StandardReplacement>(`${resourcePath('replacements', id)}/confirm`)
}

export function rejectStandardReplacement(id: string, reason?: string): Promise<StandardReplacement> {
  return api.post<StandardReplacement>(`${resourcePath('replacements', id)}/reject`, reason ? { reason } : undefined)
}
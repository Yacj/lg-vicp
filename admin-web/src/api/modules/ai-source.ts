import type { AiSourceDetail, AiSourceLocatorQuery } from '@/types/ai-source'
import type { PageResult } from '@/types/api'
import type { KnowledgePage } from '@/types/knowledge'
import { api } from '@/api/http/client'

const AI_SOURCE_DETAIL_URL = '/api/v1/ai/knowledge/source-detail'

/**
 * AI 来源详情：任一定位入口（sectionId/pageId/blockId/chunkId/documentId）→
 * 文档 + 章节路径 + 完整页（全文 + 内容块）+ 本次命中高亮。
 * 后端只返回 PUBLISHED 且生效中的版本；高亮定位失败时仍返回完整页。
 */
export function fetchAiSourceDetail(
  query: AiSourceLocatorQuery,
  signal?: AbortSignal,
): Promise<AiSourceDetail> {
  return api.get<AiSourceDetail>(AI_SOURCE_DETAIL_URL, { params: query, signal })
}

/** 从版本维度读取文档全量页码索引（B 端平台接口，用于阅读器上一页/下一页定位） */
export async function fetchSourcePageIdIndex(
  versionId: string,
  signal?: AbortSignal,
): Promise<Array<{ id: string, pageNumber: number }>> {
  const prefix = `/api/v1/platform/knowledge/versions/${encodeURIComponent(versionId)}/pages`
  const first = await api.get<PageResult<Pick<KnowledgePage, 'id' | 'pageNumber'>>>(
    prefix,
    { params: { page: 1, pageSize: 100 }, signal },
  )
  const items: Array<{ id: string, pageNumber: number }> = first.items.map(item => ({ id: item.id, pageNumber: item.pageNumber }))
  const totalPages = Math.ceil(first.total / 100)
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await api.get<PageResult<Pick<KnowledgePage, 'id' | 'pageNumber'>>>(
      prefix,
      { params: { page, pageSize: 100 }, signal },
    )
    items.push(...next.items.map(item => ({ id: item.id, pageNumber: item.pageNumber })))
  }
  return items.sort((a, b) => a.pageNumber - b.pageNumber)
}

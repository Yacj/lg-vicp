import type { KnowledgePage } from '@/types/knowledge'
import { shallowRef } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useKnowledgeReviewNavigation } from './useKnowledgeReviewNavigation'

function page(id: string, status: KnowledgePage['recognitionStatus']): KnowledgePage {
  return {
    id, documentId: 'document', versionId: 'version', pageNumber: Number(id), physicalPageNumber: Number(id),
    pageLabel: null, pageTitle: null, parsedText: null, pageImageObjectKey: null, sectionPath: null,
    hasTables: false, hasImages: false, parseStatus: 'PARSED', createdAt: '', recognitionStatus: status,
  }
}

describe('知识页核对导航', () => {
  it('切换待核对时选择筛选结果的第一页，空结果清空旧详情', async () => {
    const pages = shallowRef([page('1', 'CONFIRMED'), page('2', 'REVIEW_REQUIRED'), page('3', 'REVIEW_REQUIRED')])
    const select = vi.fn(async () => {})
    const navigation = useKnowledgeReviewNavigation(pages, select)
    navigation.statusFilter.value = 'REVIEW_REQUIRED'
    await navigation.selectFirstFilteredPage()
    expect(select).toHaveBeenLastCalledWith(pages.value[1])
    navigation.statusFilter.value = 'FAILED'
    await navigation.selectFirstFilteredPage()
    expect(select).toHaveBeenLastCalledWith(null)
  })

  it('刷新后移除已确认页面，未处理筛选包含排队与处理中', () => {
    const pages = shallowRef([page('1', 'REVIEW_REQUIRED'), page('2', null), page('3', 'PENDING'), page('4', 'PROCESSING')])
    const navigation = useKnowledgeReviewNavigation(pages, vi.fn(async () => {}))
    navigation.statusFilter.value = 'REVIEW_REQUIRED'
    pages.value = pages.value.map(item => item.id === '1' ? { ...item, recognitionStatus: 'CONFIRMED' } : item)
    expect(navigation.filteredPages.value).toEqual([])
    navigation.statusFilter.value = 'UNPROCESSED'
    expect(navigation.filteredPages.value.map(item => item.id)).toEqual(['2', '3', '4'])
  })
})

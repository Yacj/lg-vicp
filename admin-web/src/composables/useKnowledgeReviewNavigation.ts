import type { Ref } from 'vue'
import type { KnowledgePage } from '@/types/knowledge'
import { computed, ref } from 'vue'

export type KnowledgeReviewFilter = 'ALL' | 'REVIEW_REQUIRED' | 'CONFIRMED' | 'FAILED' | 'UNPROCESSED'

export function useKnowledgeReviewNavigation(pages: Ref<KnowledgePage[]>, selectPage: (page: KnowledgePage | null) => Promise<void>) {
  const statusFilter = ref<KnowledgeReviewFilter>('ALL')
  const filteredPages = computed(() => {
    const filter = statusFilter.value
    if (filter === 'ALL') return pages.value
    if (filter === 'UNPROCESSED') {
      return pages.value.filter(page => !page.recognitionStatus || page.recognitionStatus === 'PENDING' || page.recognitionStatus === 'PROCESSING')
    }
    return pages.value.filter(page => page.recognitionStatus === filter)
  })
  // 用户切换筛选时选第一页，定向跳转和确认下一页仍保留自己的目标。
  async function selectFirstFilteredPage(): Promise<void> {
    await selectPage(filteredPages.value[0] ?? null)
  }
  return { statusFilter, filteredPages, selectFirstFilteredPage }
}

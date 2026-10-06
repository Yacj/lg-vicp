import type { Ref } from 'vue'
import type { DashboardAttentionItem } from '@/types/dashboard'
import { computed } from 'vue'
import { projectAttentionItems } from './dashboard'
import type { DashboardAttentionInput } from './dashboard'

export interface DashboardAttentionCounts {
  knowledgePendingCount: Ref<number | null>
  reviewPendingCount: Ref<number | null>
  parsingFailedCount: Ref<number | null>
}

/**
 * 待处理事项投影：只展示有真实计数且大于 0 的事项，
 * 路由不可达（未授权）的分类自动隐藏，不输出空占位。
 */
export function useDashboardTodos(
  counts: DashboardAttentionCounts,
  canNavigate: (path: string) => boolean,
) {
  const attentionItems = computed<DashboardAttentionItem[]>(() => {
    const inputs: DashboardAttentionInput[] = [
      {
        id: 'review',
        title: '统一审核待办',
        description: '产品数据、标准指标与报告的审核决议',
        priority: 'high',
        paths: ['/review-center/queue'],
        count: counts.reviewPendingCount.value,
      },
      {
        id: 'knowledge',
        title: '知识库资料待处理',
        description: '需要补充或重新解析的知识库文档',
        priority: 'high',
        paths: ['/knowledge/documents'],
        count: counts.knowledgePendingCount.value,
      },
      {
        id: 'parsing',
        title: '知识解析失败',
        description: '解析任务失败，需要重试或调整文件',
        priority: 'medium',
        paths: ['/knowledge/parsing-jobs'],
        count: counts.parsingFailedCount.value,
      },
    ]
    return projectAttentionItems(inputs, canNavigate)
  })

  return { attentionItems }
}

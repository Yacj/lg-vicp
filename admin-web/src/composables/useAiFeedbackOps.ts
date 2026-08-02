import type { TableRowData } from 'tdesign-vue-next'
import type { AiFeedbackHandleInput, AiFeedbackItem, AiFeedbackReaction, AiScene } from '@/types/ai'
import { fetchPlatformFeedbacks, handleAiFeedback } from '@/api/modules/ai'
import { useAppFeedback } from './useAppFeedback'
import { useCrudList } from './useCrudList'

export type AiFeedbackTableRow = AiFeedbackItem & TableRowData

export interface FeedbackOpsSearchQuery extends Record<string, unknown> {
  reaction: 'all' | AiFeedbackReaction
  scene: 'all' | AiScene
}

/** 反馈列表：服务端分页 + 服务端筛选。 */
export function useAiFeedbackOps() {
  const feedback = useAppFeedback()

  const feedbackList = useCrudList<AiFeedbackTableRow, FeedbackOpsSearchQuery>({
    createQuery: () => ({ reaction: 'all', scene: 'all' }),
    fetcher: async ({ query, page, pageSize, signal }) => {
      const params: Record<string, unknown> = {
        page,
        pageSize,
      }
      if (query.reaction !== 'all') {
        params.reaction = query.reaction
      }
      if (query.scene !== 'all') {
        params.scene = query.scene
      }
      return fetchPlatformFeedbacks(params, signal)
    },
    immediate: true,
    rowKey: item => String(item.feedback.id),
  })

  /** 标记已处理：写入处理备注（≤1000 字符）与处理人/时间；无"处理中"中间态。 */
  async function markHandled(item: AiFeedbackItem, input: AiFeedbackHandleInput): Promise<void> {
    try {
      const result = await handleAiFeedback(item.feedback.id, input)
      await feedback.message('success', result.message)
      await feedbackList.refresh()
    }
    catch (error) {
      await feedback.messageError(error)
    }
  }

  return { feedbackList, markHandled }
}
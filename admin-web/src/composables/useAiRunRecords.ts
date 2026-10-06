import type { TableRowData } from 'tdesign-vue-next'
import type { AiConversationStatus, PlatformConversationItem } from '@/types/ai'
import { fetchPlatformConversations } from '@/api/modules/ai'
import { isConversationInDateRange } from '@/utils/ai-agent'
import { useCrudList } from './useCrudList'

export type AgentRunTableRow = PlatformConversationItem & TableRowData

export interface AgentRunSearchQuery extends Record<string, unknown> {
  status: 'all' | AiConversationStatus
  projectId: string
  userId: string
  dateRange: string[]
}

/** AI 运行记录：会话运营列表投影，详情再展开 Tool Calls。 */
export function useAiRunRecords() {
  const runList = useCrudList<AgentRunTableRow, AgentRunSearchQuery>({
    createQuery: () => ({
      dateRange: [],
      projectId: '',
      status: 'all',
      userId: '',
    }),
    fetcher: async ({ query, page, pageSize, signal }) => {
      const params: Record<string, unknown> = { page, pageSize }
      if (query.status !== 'all') {
        params.status = query.status
      }
      if (query.projectId) {
        params.projectId = query.projectId
      }
      if (query.userId) {
        params.userId = query.userId
      }
      const result = await fetchPlatformConversations(params, signal)
      const items = result.items.filter(item =>
        isConversationInDateRange(item.conversation.updatedAt, query.dateRange))
      return {
        items,
        page: result.page,
        pageSize: result.pageSize,
        total: query.dateRange.length === 2 ? items.length : result.total,
      }
    },
    immediate: true,
    rowKey: item => item.conversation.id,
  })

  return { runList }
}

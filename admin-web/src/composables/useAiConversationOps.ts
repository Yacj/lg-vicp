import type { TableRowData } from 'tdesign-vue-next'
import type {
  AiConversationStatus,
  AiScene,
  PlatformConversationItem,
} from '@/types/ai'
import { fetchPlatformConversations } from '@/api/modules/ai'
import { useCrudList } from './useCrudList'

export type PlatformConversationTableRow = PlatformConversationItem & TableRowData

export interface ConversationOpsSearchQuery extends Record<string, unknown> {
  keyword: string
  scene: 'all' | AiScene
  clientApp: 'all' | 'pc_ai' | 'b_admin' | 'c_app'
  status: 'all' | AiConversationStatus
}

/** 运营会话列表：服务端分页 + 服务端筛选（keyword 匹配标题/用户/项目名）。 */
export function useAiConversationOps() {
  const conversationList = useCrudList<PlatformConversationTableRow, ConversationOpsSearchQuery>({
    createQuery: () => ({ keyword: '', scene: 'all', clientApp: 'all', status: 'all' }),
    fetcher: async ({ query, page, pageSize, signal }) => {
      const params: Record<string, unknown> = {
        page,
        pageSize,
      }
      const keyword = String(query.keyword ?? '').trim()
      if (keyword) {
        params.keyword = keyword
      }
      if (query.scene !== 'all') {
        params.scene = query.scene
      }
      if (query.clientApp !== 'all') {
        params.clientApp = query.clientApp
      }
      if (query.status !== 'all') {
        params.status = query.status
      }
      return fetchPlatformConversations(params, signal)
    },
    immediate: true,
    rowKey: item => item.conversation.id,
  })

  return { conversationList }
}

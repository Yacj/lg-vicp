import type { TableRowData } from 'tdesign-vue-next'
import type {
  AiContentFilter,
  AiContentFilterInput,
  AiContentFilterMatchType,
  AiContentFilterMutationResult,
} from '@/types/ai'
import {
  createAiContentFilter,
  deleteAiContentFilter,
  fetchAiContentFilters,
  updateAiContentFilter,
  updateAiContentFilterStatus,
} from '@/api/modules/ai'
import { useAppFeedback } from './useAppFeedback'
import { useCrudDrawer } from './useCrudDrawer'
import { useCrudList } from './useCrudList'

export type AiContentFilterTableRow = AiContentFilter & TableRowData

export interface AiContentFilterForm extends Record<string, unknown> {
  keyword: string
  matchType: AiContentFilterMatchType
  sceneCodes: string[]
  hitMessage: string
  enabled: boolean
}

export interface AiContentFilterSearchQuery extends Record<string, unknown> {
  keyword: string
  matchType: 'all' | AiContentFilterMatchType
  enabled: 'all' | 'true' | 'false'
}

function toForm(filter: AiContentFilter | null): AiContentFilterForm {
  return {
    keyword: filter?.keyword ?? '',
    matchType: filter?.matchType ?? 'CONTAINS',
    sceneCodes: filter?.sceneCodes ?? [],
    hitMessage: filter?.hitMessage ?? '',
    enabled: filter?.enabled ?? true,
  }
}

/** 围栏词条：服务端分页 + 筛选；新增/编辑走弹窗，删除与启停用带确认。 */
export function useAiContentFilters() {
  const feedback = useAppFeedback()

  const filterList = useCrudList<AiContentFilterTableRow, AiContentFilterSearchQuery>({
    createQuery: () => ({ keyword: '', matchType: 'all', enabled: 'all' }),
    fetcher: async ({ query, page, pageSize, signal }) => {
      const params: Record<string, unknown> = { page, pageSize }
      if (query.keyword.trim()) {
        params.keyword = query.keyword.trim()
      }
      if (query.matchType !== 'all') {
        params.matchType = query.matchType
      }
      if (query.enabled !== 'all') {
        params.enabled = query.enabled === 'true'
      }
      return fetchAiContentFilters(params, signal)
    },
    immediate: true,
    rowKey: 'id',
  })

  const filterDrawer = useCrudDrawer<AiContentFilterForm, AiContentFilterTableRow, AiContentFilterMutationResult>({
    createForm: () => toForm(null),
    editForm: row => toForm(row),
    onError: cause => void feedback.messageError(cause),
    onSuccess: async (result) => {
      await feedback.message('success', result.message)
      await filterList.refresh()
    },
    submit: async ({ data, entity }) => {
      const input: AiContentFilterInput = {
        keyword: data.keyword.trim(),
        matchType: data.matchType,
        sceneCodes: data.sceneCodes.length > 0 ? data.sceneCodes : undefined,
        hitMessage: data.hitMessage.trim() || undefined,
        enabled: data.enabled,
      }
      if (entity) {
        return updateAiContentFilter(entity.id, input)
      }
      return createAiContentFilter(input)
    },
  })

  /** 启用/停用切换（PATCH 仅携带 enabled）。 */
  async function toggleEnabled(row: AiContentFilterTableRow): Promise<void> {
    try {
      const result = await updateAiContentFilterStatus(row.id, !row.enabled)
      await feedback.message('success', result.message)
      await filterList.refresh()
    }
    catch (cause) {
      await feedback.messageError(cause)
    }
  }

  /** 删除词条（危险操作，确认后执行）。 */
  async function remove(row: AiContentFilterTableRow): Promise<void> {
    try {
      const result = await deleteAiContentFilter(row.id)
      await feedback.message('success', result.message)
      await filterList.refresh()
    }
    catch (cause) {
      await feedback.messageError(cause)
    }
  }

  return {
    filterDrawer,
    filterList,
    remove,
    toggleEnabled,
  }
}

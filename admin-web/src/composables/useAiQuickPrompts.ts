import type { TableRowData } from 'tdesign-vue-next'
import type {
  AiQuickPrompt,
  AiQuickPromptIcon,
  AiQuickPromptInput,
  AiQuickPromptMutationResult,
  AiQuickPromptPosition,
  AiQuickPromptQuery,
} from '@/types/ai'
import { reactive } from 'vue'
import {
  createAiQuickPrompt,
  deleteAiQuickPrompt,
  disableAiQuickPrompt,
  enableAiQuickPrompt,
  fetchAiQuickPrompts,
  updateAiQuickPrompt,
} from '@/api/modules/ai'
import { toUserFacingAiMessage } from '@/utils/ai'
import { normalizeFeedbackError, useAppFeedback } from './useAppFeedback'
import { useConfirmedCrudAction } from './useCrudActions'
import { useCrudDrawer } from './useCrudDrawer'
import { useCrudList } from './useCrudList'

export type AiQuickPromptTableRow = AiQuickPrompt & TableRowData

export interface AiQuickPromptForm extends Record<string, unknown> {
  title: string
  description: string
  content: string
  positions: AiQuickPromptPosition[]
  icon: AiQuickPromptIcon
  sortOrder: number
  enabled: boolean
}

export interface AiQuickPromptSearchQuery extends Record<string, unknown> {
  keyword: string
  position: 'all' | AiQuickPromptPosition
  enabled: 'all' | 'true' | 'false'
}

export interface QuickPromptUsageStats {
  enabledCount: number
  homeCount: number
  projectCount: number
}

function createForm(): AiQuickPromptForm {
  return {
    title: '',
    description: '',
    content: '',
    positions: ['AI_HOME'],
    icon: 'book',
    sortOrder: 10,
    enabled: true,
  }
}

function toForm(row: AiQuickPrompt): AiQuickPromptForm {
  return {
    title: row.title,
    description: row.description ?? '',
    content: row.content,
    positions: [row.position],
    icon: row.icon,
    sortOrder: row.sortOrder,
    enabled: row.enabled,
  }
}

function toWriteInput(form: AiQuickPromptForm, position: AiQuickPromptPosition): AiQuickPromptInput {
  return {
    title: form.title.trim(),
    description: form.description.trim() || null,
    content: form.content.trim(),
    position,
    icon: form.icon,
    sortOrder: form.sortOrder,
    enabled: form.enabled,
    actionType: 'AUTO',
  }
}

/** 快捷提问：独立配置，不复用提示词版本；启停用走专用接口。 */
export function useAiQuickPrompts() {
  const feedback = useAppFeedback()
  const stats = reactive<QuickPromptUsageStats>({
    enabledCount: 0,
    homeCount: 0,
    projectCount: 0,
  })

  function reportError(error: unknown, fallback: string): void {
    void feedback.message('error', toUserFacingAiMessage(normalizeFeedbackError(error).message, fallback))
  }

  async function loadStats(): Promise<void> {
    try {
      const [enabled, home, project] = await Promise.all([
        fetchAiQuickPrompts({ page: 1, pageSize: 1, enabled: true }),
        fetchAiQuickPrompts({ page: 1, pageSize: 1, enabled: true, position: 'AI_HOME' }),
        fetchAiQuickPrompts({ page: 1, pageSize: 1, enabled: true, position: 'PROJECT_AI' }),
      ])
      stats.enabledCount = enabled.total
      stats.homeCount = home.total
      stats.projectCount = project.total
    }
    catch {
      stats.enabledCount = 0
      stats.homeCount = 0
      stats.projectCount = 0
    }
  }

  const promptList = useCrudList<AiQuickPromptTableRow, AiQuickPromptSearchQuery>({
    createQuery: () => ({ keyword: '', position: 'all', enabled: 'all' }),
    fetcher: async ({ query, page, pageSize, signal }) => {
      const params: AiQuickPromptQuery = { page, pageSize }
      if (query.keyword.trim()) {
        params.keyword = query.keyword.trim()
      }
      if (query.position !== 'all') {
        params.position = query.position
      }
      if (query.enabled !== 'all') {
        params.enabled = query.enabled === 'true'
      }
      return fetchAiQuickPrompts(params, signal)
    },
    immediate: true,
    rowKey: 'id',
  })

  async function refreshAll(): Promise<void> {
    await Promise.all([promptList.refresh(), loadStats()])
  }

  const promptDrawer = useCrudDrawer<AiQuickPromptForm, AiQuickPromptTableRow, AiQuickPromptMutationResult>({
    createForm: createForm,
    editForm: toForm,
    onError: cause => reportError(cause, '保存失败，请稍后重试。'),
    onSuccess: async (result) => {
      await feedback.message('success', result.message)
      await refreshAll()
    },
    submit: async ({ data, entity, mode }) => {
      const positions = [...new Set(data.positions)]
      if (positions.length === 0) {
        throw new Error('请选择显示位置')
      }

      if (mode === 'create' || !entity) {
        let lastResult: AiQuickPromptMutationResult | null = null
        for (const position of positions) {
          lastResult = await createAiQuickPrompt(toWriteInput(data, position))
        }
        return lastResult ?? { message: '快捷提问创建成功' }
      }

      const keepCurrent = positions.includes(entity.position)
      const extraPositions = positions.filter(position => position !== entity.position)
      const nextPosition = keepCurrent ? entity.position : extraPositions[0] ?? entity.position
      const updated = await updateAiQuickPrompt(entity.id, toWriteInput(data, nextPosition))
      const siblings = extraPositions.filter(position => position !== nextPosition)
      for (const position of siblings) {
        await createAiQuickPrompt(toWriteInput(data, position))
      }
      return updated
    },
  })

  async function toggleEnabled(row: AiQuickPromptTableRow): Promise<void> {
    try {
      const result = row.enabled
        ? await disableAiQuickPrompt(row.id)
        : await enableAiQuickPrompt(row.id)
      await feedback.message('success', result.message)
      await refreshAll()
    }
    catch (cause) {
      reportError(cause, '操作失败，请稍后重试。')
    }
  }

  const deleteAction = useConfirmedCrudAction<AiQuickPromptTableRow, { message: string }>({
    action: async (row) => {
      const result = await deleteAiQuickPrompt(row.id)
      return result
    },
    confirm: row => ({
      title: '删除快捷提问',
      content: `删除后 C端将不再展示「${row.title}」，但不会影响用户自由输入和历史对话。`,
      confirmText: '删除',
      danger: true,
    }),
    onSuccess: async () => {
      await refreshAll()
    },
    successMessage: (_row, result) => result.message,
  })

  void loadStats()

  return {
    deleteAction,
    loadStats,
    promptDrawer,
    promptList,
    stats,
    toggleEnabled,
  }
}

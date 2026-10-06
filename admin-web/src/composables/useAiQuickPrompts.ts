import type { TableRowData } from 'tdesign-vue-next'
import type {
  AiQuickPrompt,
  AiQuickPromptIcon,
  AiQuickPromptInput,
  AiQuickPromptMutationResult,
  AiQuickPromptPosition,
  AiQuickPromptQuery,
} from '@/types/ai'
import { computed, reactive, ref } from 'vue'
import {
  createAiQuickPrompt,
  deleteAiQuickPrompt,
  disableAiQuickPrompt,
  enableAiQuickPrompt,
  fetchAiQuickPrompts,
  updateAiQuickPrompt,
} from '@/api/modules/ai'
import { toUserFacingAiMessage } from '@/utils/ai'
import {
  DEFAULT_QUICK_PROMPTS,
  applyDragSortedOrders,
  collectLegacySystemWordingQuickPrompts,
  diffQuickPromptSortOrders,
  findDefaultQuickPromptByTitle,
  nextQuickPromptSortOrder,
  type DefaultQuickPromptTemplate,
} from '@/utils/ai-quick-prompt'
import { confirmAndRun } from './useAppConfirm'
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

function createForm(sortOrder = 10): AiQuickPromptForm {
  return {
    title: '',
    description: '',
    content: '',
    positions: ['AI_HOME'],
    icon: 'book',
    sortOrder,
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

function toWriteInputFromRow(row: AiQuickPrompt): AiQuickPromptInput {
  return {
    title: row.title,
    description: row.description,
    content: row.content,
    position: row.position,
    icon: row.icon,
    sortOrder: row.sortOrder,
    enabled: row.enabled,
    actionType: row.actionType,
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
    createForm: () => createForm(nextQuickPromptSortOrder(promptList.data.value)),
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

  const recommendedTemplates = DEFAULT_QUICK_PROMPTS
  const applyingRecommended = ref(false)
  const pageLegacyCount = computed(() => collectLegacySystemWordingQuickPrompts(promptList.data.value).length)

  function applyTemplateToForm(template: DefaultQuickPromptTemplate): void {
    promptDrawer.formData.title = template.title
    promptDrawer.formData.description = template.description
    promptDrawer.formData.content = template.content
    promptDrawer.formData.icon = template.icon
  }

  const reordering = ref(false)

  async function persistDragSort(nextOrder: readonly AiQuickPromptTableRow[]): Promise<void> {
    if (reordering.value) {
      return
    }
    const previous = [...promptList.data.value]
    const next = applyDragSortedOrders(previous, nextOrder)
    const changed = diffQuickPromptSortOrders(previous, next)
    if (changed.length === 0) {
      return
    }
    promptList.replaceItems(next)
    reordering.value = true
    try {
      await Promise.all(changed.map(item => updateAiQuickPrompt(item.id, toWriteInputFromRow(item))))
    }
    catch (cause) {
      promptList.replaceItems(previous)
      reportError(cause, '排序保存失败，请稍后重试。')
    }
    finally {
      reordering.value = false
    }
  }

  async function applyRecommendedWording(): Promise<void> {
    if (applyingRecommended.value) {
      return
    }
    const result = await confirmAndRun({
      title: '按推荐文案更新',
      content: '将把仍像系统指令的 4 条预置提问改成自然用户问题。管理员已改写成其他问题的记录不会被覆盖。',
      confirmText: '更新',
    }, async () => {
      applyingRecommended.value = true
      try {
        const targets: AiQuickPrompt[] = []
        const seen = new Set<string>()
        for (const template of DEFAULT_QUICK_PROMPTS) {
          const listed = await fetchAiQuickPrompts({
            keyword: template.title,
            page: 1,
            pageSize: 100,
          })
          for (const item of collectLegacySystemWordingQuickPrompts(listed.items)) {
            if (seen.has(item.id)) {
              continue
            }
            seen.add(item.id)
            targets.push(item)
          }
        }
        if (targets.length === 0) {
          return { message: '当前没有需要更新的预置提问', updated: 0 }
        }
        for (const item of targets) {
          const template = findDefaultQuickPromptByTitle(item.title)
          if (!template) {
            continue
          }
          await updateAiQuickPrompt(item.id, {
            title: item.title,
            description: template.description,
            content: template.content,
            position: item.position,
            icon: item.icon,
            sortOrder: item.sortOrder,
            enabled: item.enabled,
            actionType: item.actionType,
          })
        }
        await refreshAll()
        return { message: `已更新 ${targets.length} 条预置提问`, updated: targets.length }
      }
      finally {
        applyingRecommended.value = false
      }
    })
    if (result.confirmed) {
      await feedback.message('success', result.value.message)
    }
  }

  void loadStats()

  return {
    applyRecommendedWording,
    applyTemplateToForm,
    applyingRecommended,
    deleteAction,
    loadStats,
    pageLegacyCount,
    persistDragSort,
    promptDrawer,
    promptList,
    recommendedTemplates,
    reordering,
    stats,
    toggleEnabled,
  }
}

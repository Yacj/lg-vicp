import type { TableRowData } from 'tdesign-vue-next'
import type { Ref } from 'vue'
import type { ProjectAiMemory, ProjectAiMemoryView } from '@/types/ai'
import { computed, watch } from 'vue'
import {
  confirmProjectAiMemory,
  fetchProjectAiMemories,
  rejectProjectAiMemory,
  updateProjectAiMemory,
} from '@/api/modules/ai'
import { useAppFeedback } from './useAppFeedback'
import { useConfirmedCrudAction } from './useCrudActions'
import { useCrudList } from './useCrudList'

export type ProjectAiMemoryTableRow = ProjectAiMemory & TableRowData

export interface ProjectAiMemorySearchQuery extends Record<string, unknown> {
  view: ProjectAiMemoryView
}

export function useProjectAiMemory(projectId: Ref<string | null>, enabled: Ref<boolean>) {
  const feedback = useAppFeedback()

  const memoryList = useCrudList<ProjectAiMemoryTableRow, ProjectAiMemorySearchQuery>({
    createQuery: () => ({ view: 'active' }),
    fetcher: async ({ query, signal }) => {
      const id = projectId.value
      if (!id || !enabled.value) {
        return { items: [], page: 1, pageSize: 20, total: 0 }
      }
      const result = await fetchProjectAiMemories(id, query.view, signal)
      return { items: result.items, page: 1, pageSize: result.items.length || 20, total: result.items.length }
    },
    immediate: false,
    rowKey: 'id',
  })

  watch(
    () => [projectId.value, enabled.value, memoryList.query.view] as const,
    ([id, canView]) => {
      if (id && canView) {
        void memoryList.refresh()
      }
    },
    { immediate: true },
  )

  const rejectAction = useConfirmedCrudAction<ProjectAiMemory, { message: string }>({
    action: (memory) => {
      const id = projectId.value
      if (!id) {
        return Promise.reject(new Error('项目不存在'))
      }
      return rejectProjectAiMemory(id, memory.id)
    },
    confirm: memory => ({
      confirmText: '标记无效',
      content: `确认将这条记忆标记为无效吗？标记后不再作为项目事实注入。`,
      danger: true,
      title: memory.title ? `标记“${memory.title}”无效` : '标记记忆无效',
    }),
    onSuccess: async () => {
      await memoryList.refresh()
    },
    successMessage: (_memory, result) => result.message,
  })

  const confirmAction = useConfirmedCrudAction<ProjectAiMemory, { message: string }>({
    action: (memory) => {
      const id = projectId.value
      if (!id) {
        return Promise.reject(new Error('项目不存在'))
      }
      return confirmProjectAiMemory(id, memory.id)
    },
    confirm: memory => ({
      confirmText: '确认',
      content: '确认后，这条记忆可以作为项目事实注入后续对话。',
      title: memory.title ? `确认记忆“${memory.title}”` : '确认项目记忆',
    }),
    onSuccess: async () => {
      await memoryList.refresh()
    },
    successMessage: (_memory, result) => result.message,
  })

  async function saveMemory(memory: ProjectAiMemory, input: { title?: string | null, content?: string }): Promise<void> {
    const id = projectId.value
    if (!id) {
      return
    }
    try {
      const result = await updateProjectAiMemory(id, memory.id, input)
      await feedback.message('success', result.message)
      await memoryList.refresh()
    }
    catch (error) {
      await feedback.messageError(error)
    }
  }

  const currentView = computed(() => memoryList.query.view)

  return {
    confirmAction,
    currentView,
    memoryList,
    rejectAction,
    saveMemory,
  }
}

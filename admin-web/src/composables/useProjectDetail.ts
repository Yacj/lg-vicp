import type { Ref } from 'vue'
import type { TableRowData } from 'tdesign-vue-next'
import { fetchFiles, fetchFileDownloadUrl, deleteFile, downloadUrlToBlob } from '@/api/modules/files'
import { fetchProjectConversations } from '@/api/modules/ai'
import { fetchProjectAuditLogs } from '@/api/modules/audit-logs'
import { fetchProjectDetail } from '@/api/modules/projects'
import type {
  ProjectAuditLog,
  ProjectConversation,
  ProjectItem,
} from '@/types/project'
import type { FileRecord } from '@/types/file'
import { computed, ref, shallowRef, watch } from 'vue'
import { usePermissionAccess } from './usePermissionAccess'
import { useCrudList } from './useCrudList'
import { useCrudDelete } from './useCrudActions'
import { useAppFeedback } from './useAppFeedback'
import { downloadFromUrl, downloadErrorMessage } from '@/utils/download'
import { projectDetailTabs } from '@/utils/project'

export type ProjectDetailStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * 项目详情：基础信息 + 三个真实数据 Tab（资料文件 / AI 会话 / 操作记录）。
 * 文件列表按归属返回（仅 owner 或超级管理员可见），上传/删除按项目管理权限控制。
 */
export function useProjectDetail(projectId: Ref<string | null>) {
  const { canAccess } = usePermissionAccess()
  const feedback = useAppFeedback()

  const detail = shallowRef<ProjectItem | null>(null)
  const detailStatus = ref<ProjectDetailStatus>('idle')
  const detailError = shallowRef<unknown>(null)

  const canViewAuditLogs = computed(() => canAccess({ permissions: ['monitor:audit:list'] }))
  const tabs = computed(() => projectDetailTabs(canViewAuditLogs.value))

  const filesList = useCrudList<FileRecord & TableRowData, Record<string, never>>({
    createQuery: () => ({}),
    fetcher: ({ page, pageSize, signal }) => {
      const id = projectId.value
      if (!id) {
        return Promise.resolve({ items: [], page, pageSize, total: 0 })
      }
      return fetchFiles({ page, pageSize, projectId: id }, signal)
    },
    immediate: false,
    rowKey: 'id',
  })

  const conversationsList = useCrudList<ProjectConversation & TableRowData, Record<string, never>>({
    createQuery: () => ({}),
    fetcher: ({ page, pageSize, signal }) => {
      const id = projectId.value
      if (!id) {
        return Promise.resolve({ items: [], page, pageSize, total: 0 })
      }
      return fetchProjectConversations(id, { page, pageSize }, signal)
    },
    immediate: false,
    rowKey: 'id',
  })

  const auditList = useCrudList<ProjectAuditLog & TableRowData, Record<string, never>>({
    createQuery: () => ({}),
    fetcher: ({ page, pageSize, signal }) => {
      const id = projectId.value
      if (!id) {
        return Promise.resolve({ items: [], page, pageSize, total: 0 })
      }
      return fetchProjectAuditLogs(id, { page, pageSize }, signal)
    },
    immediate: false,
    rowKey: 'id',
  })

  const fileDeleteAction = useCrudDelete<FileRecord, { message: string }>({
    action: (file) => deleteFile(file.id),
    confirm: (file) => ({
      content: `确认删除文件“${file.originalName}”吗？删除后无法恢复。`,
      confirmText: '删除',
      danger: true,
      title: '删除文件',
    }),
    onSuccess: async () => {
      await filesList.refresh()
    },
    successMessage: (_file, result) => result.message,
  })

  const fileDownloadRunning = ref(false)

  async function downloadFile(file: FileRecord): Promise<void> {
    if (fileDownloadRunning.value) {
      return
    }
    fileDownloadRunning.value = true
    try {
      const { url } = await fetchFileDownloadUrl(file.id)
      await downloadFromUrl(url, {
        filename: file.originalName,
        fetchBlob: (downloadUrl, context) => downloadUrlToBlob(downloadUrl, {
          signal: context.signal ?? new AbortController().signal,
          onProgress: context.onProgress,
        }),
      })
      await feedback.message('success', `文件“${file.originalName}”已开始下载`)
    }
    catch (cause) {
      await feedback.message('error', downloadErrorMessage(cause))
    }
    finally {
      fileDownloadRunning.value = false
    }
  }

  async function loadDetail(id: string): Promise<void> {
    detailStatus.value = 'loading'
    detailError.value = null
    try {
      const result = await fetchProjectDetail(id)
      detail.value = result.project
      detailStatus.value = 'ready'
    }
    catch (cause) {
      detail.value = null
      detailError.value = cause
      detailStatus.value = 'error'
    }
  }

  watch(
    () => projectId.value,
    (id) => {
      if (!id) {
        return
      }
      void loadDetail(id)
      void filesList.refresh()
      void conversationsList.refresh()
      if (canViewAuditLogs.value) {
        void auditList.refresh()
      }
    },
    { immediate: true },
  )

  async function reloadDetail(): Promise<void> {
    const id = projectId.value
    if (id) {
      await loadDetail(id)
    }
  }

  return {
    auditList,
    canViewAuditLogs,
    conversationsList,
    detail,
    detailError,
    detailStatus,
    downloadFile,
    fileDeleteAction,
    fileDownloadRunning,
    filesList,
    reloadDetail,
    tabs,
  }
}
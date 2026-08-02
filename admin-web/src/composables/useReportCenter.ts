import type { TableRowData } from 'tdesign-vue-next'
import { computed, getCurrentScope, onScopeDispose, readonly, ref, shallowRef } from 'vue'
import type { ProjectItem } from '@/types/project'
import type { ReportCenterRow } from '@/types/report'
import { fetchConversationAssets } from '@/api/modules/reports'
import { fetchProjectConversations } from '@/api/modules/ai'
import { normalizeFeedbackError, useAppFeedback } from './useAppFeedback'
import { useProjectCenter } from './useProjectCenter'
import { useReportActions } from './useReportActions'
import { isReportInProgress } from '@/utils/report'

export type ReportCenterTableRow = ReportCenterRow & TableRowData
export type ReportCenterStatus = 'idle' | 'loading' | 'ready' | 'error'

/** 并发拉取会话详情时最多同时进行的请求数。 */
const CONCURRENCY_LIMIT = 4
/** 单个项目最多聚合的会话页数（每页 100），超出部分提示用户缩小范围。 */
const MAX_CONVERSATION_PAGES = 10
/** 存在生成中报告时的自动刷新间隔（ms）。 */
const POLL_INTERVAL_MS = 10_000

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/**
 * 报告成果中心列表：项目 → 会话 → 报告聚合。
 * 后端没有 GET /reports 列表接口，报告数据来自会话详情（GET /ai/conversations/:id）的嵌套返回。
 */
export function useReportCenter() {
  const feedback = useAppFeedback()
  const projectCenter = useProjectCenter()

  const selectedProject = ref<ProjectItem | null>(null)
  const rows = shallowRef<ReportCenterRow[]>([])
  const status = ref<ReportCenterStatus>('idle')
  const error = shallowRef<unknown>(null)
  const polling = ref(false)
  const aggregating = ref(false)
  const conversationCount = ref(0)

  let requestSequence = 0
  let activeController: AbortController | null = null
  let pollTimer: number | null = null

  const actions = useReportActions({
    onChanged: () => {
      if (selectedProject.value) {
        void aggregateProject(selectedProject.value)
      }
    },
  })

  const errorDescription = computed(() => error.value
    ? normalizeFeedbackError(error.value).message
    : '请检查网络连接后重试')

  function clearPollTimer(): void {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  async function loadProjectReports(
    project: ProjectItem,
    signal: AbortSignal,
  ): Promise<{ rows: ReportCenterRow[], conversationCount: number, truncated: boolean }> {
    const projectId = project.id
    const conversations = []
    let truncated = false
    for (let page = 1; page <= MAX_CONVERSATION_PAGES; page++) {
      const result = await fetchProjectConversations(projectId, { page, pageSize: 100 }, signal)
      conversations.push(...result.items)
      if (result.items.length === 0 || conversations.length >= result.total) {
        break
      }
      if (page === MAX_CONVERSATION_PAGES) {
        truncated = true
      }
    }

    const assetRows = await mapWithConcurrency(conversations, CONCURRENCY_LIMIT, async (conversation) => {
      const assets = await fetchConversationAssets(conversation.id, signal)
      return { conversation, assets }
    })

    const rows = assetRows.flatMap(({ conversation, assets }) =>
      assets.reports.map((report) => ({
        ...report,
        conversationId: report.conversationId ?? conversation.id,
        conversationTitle: conversation.title,
        conversationUserId: conversation.userId,
        projectName: project.name,
        shareLinks: assets.shareLinks.filter(share =>
          (share.targetType === 'REPORT' && share.targetId === report.id)
          || (share.targetType === 'REPORT_ARTIFACT' && report.artifacts.some(artifact => artifact.id === share.targetId)),
        ),
      })),
    )
    rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    return { conversationCount: conversations.length, rows, truncated }
  }

  async function aggregateProject(project: ProjectItem): Promise<void> {
    activeController?.abort()
    const controller = new AbortController()
    const sequence = ++requestSequence
    activeController = controller
    selectedProject.value = project
    status.value = 'loading'
    error.value = null
    aggregating.value = true
    try {
      const result = await loadProjectReports(project, controller.signal)
      if (sequence !== requestSequence || controller.signal.aborted) {
        return
      }
      rows.value = result.rows
      conversationCount.value = result.conversationCount
      status.value = 'ready'
      schedulePoll()
      if (result.truncated) {
        feedback.message('warning', '项目会话较多，仅聚合了最近部分会话的报告')
      }
    }
    catch (cause) {
      if (sequence !== requestSequence || controller.signal.aborted) {
        return
      }
      error.value = cause
      status.value = 'error'
    }
    finally {
      if (sequence === requestSequence) {
        activeController = null
        aggregating.value = false
      }
    }
  }

  /** 存在生成中报告时定时重新聚合。 */
  function schedulePoll(): void {
    clearPollTimer()
    if (!selectedProject.value || !rows.value.some(row => isReportInProgress(row.status))) {
      polling.value = false
      return
    }
    polling.value = true
    pollTimer = window.setTimeout(() => {
      pollTimer = null
      if (selectedProject.value) {
        void aggregateProject(selectedProject.value)
      }
    }, POLL_INTERVAL_MS)
  }

  function stopPoll(): void {
    clearPollTimer()
    polling.value = false
  }

  /** 取消当前项目选择，回到项目选择区。 */
  function clearSelection(): void {
    requestSequence += 1
    activeController?.abort()
    activeController = null
    stopPoll()
    selectedProject.value = null
    rows.value = []
    conversationCount.value = 0
    status.value = 'idle'
    error.value = null
    aggregating.value = false
  }

  function dispose(): void {
    stopPoll()
    requestSequence += 1
    activeController?.abort()
    activeController = null
  }

  if (getCurrentScope()) {
    onScopeDispose(dispose)
  }

  return {
    actions,
    activeView: projectCenter.activeView,
    aggregating: readonly(aggregating),
    allList: projectCenter.allList,
    applyVisibilityFilter: projectCenter.applyVisibilityFilter,
    clearSelection,
    conversationCount: readonly(conversationCount),
    error,
    errorDescription,
    myList: projectCenter.myList,
    polling: readonly(polling),
    projectCenter,
    publicList: projectCenter.publicList,
    refresh: aggregateProject,
    rows,
    selectProject: aggregateProject,
    selectedProject: readonly(selectedProject),
    setActiveView: projectCenter.setActiveView,
    status: readonly(status),
    stopPoll,
  }
}
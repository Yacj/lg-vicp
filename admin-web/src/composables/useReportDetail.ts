import { computed, getCurrentScope, onScopeDispose, readonly, ref, shallowRef } from 'vue'
import type { ProjectItem } from '@/types/project'
import type { ReportDetailResult, ReportWithAssets, ShareLink } from '@/types/report'
import { fetchConversationAssets, fetchReportDetail } from '@/api/modules/reports'
import { fetchProjectDetail } from '@/api/modules/projects'
import { normalizeFeedbackError } from './useAppFeedback'
import { useReportActions } from './useReportActions'
import { isReportInProgress } from '@/utils/report'

export type ReportDetailStatus = 'idle' | 'loading' | 'ready' | 'error'

/** 报告详情自动刷新间隔（存在生成中报告时，ms）。 */
const POLL_INTERVAL_MS = 10_000

/**
 * 报告详情：GET /reports/:id（状态/来源/可用格式）+
 * 会话详情（文件版本 artifacts 与分享记录 shareLinks，仅报告关联会话时可用）+
 * 项目详情。
 */
export function useReportDetail(reportId: string) {
  const detail = shallowRef<ReportDetailResult | null>(null)
  const assets = shallowRef<ReportWithAssets | null>(null)
  const project = shallowRef<ProjectItem | null>(null)
  const status = ref<ReportDetailStatus>('idle')
  const error = shallowRef<unknown>(null)
  const polling = ref(false)

  let requestSequence = 0
  let activeController: AbortController | null = null
  let pollTimer: number | null = null

  const actions = useReportActions({ onChanged: load })

  const errorDescription = computed(() => error.value
    ? normalizeFeedbackError(error.value).message
    : '请检查网络连接后重试')

  const shareLinks = shallowRef<ShareLink[]>([])

  function clearPollTimer(): void {
    if (pollTimer !== null) {
      window.clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  async function load(): Promise<void> {
    activeController?.abort()
    const controller = new AbortController()
    const sequence = ++requestSequence
    activeController = controller
    status.value = 'loading'
    error.value = null
    try {
      const result = await fetchReportDetail(reportId, controller.signal)
      if (sequence !== requestSequence || controller.signal.aborted) {
        return
      }
      detail.value = result

      const conversationAssets = result.report.conversationId
        ? await fetchConversationAssets(result.report.conversationId, controller.signal)
        : null
      if (sequence !== requestSequence || controller.signal.aborted) {
        return
      }
      assets.value = conversationAssets
        ? conversationAssets.reports.find(report => report.id === reportId)
          ?? {
            ...result.report,
            artifacts: [],
            sources: result.sources,
          }
        : null
      shareLinks.value = conversationAssets
        ? conversationAssets.shareLinks.filter(share =>
          (share.targetType === 'REPORT' && share.targetId === reportId)
          || (share.targetType === 'REPORT_ARTIFACT' && (assets.value?.artifacts ?? []).some(artifact => artifact.id === share.targetId)),
        )
        : []

      const projectResult = await fetchProjectDetail(result.report.projectId, controller.signal)
      if (sequence !== requestSequence || controller.signal.aborted) {
        return
      }
      project.value = projectResult.project
      status.value = 'ready'
      schedulePoll()
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
      }
    }
  }

  function schedulePoll(): void {
    clearPollTimer()
    if (!detail.value || !isReportInProgress(detail.value.report.status)) {
      polling.value = false
      return
    }
    polling.value = true
    pollTimer = window.setTimeout(() => {
      pollTimer = null
      void load()
    }, POLL_INTERVAL_MS)
  }

  function stopPoll(): void {
    clearPollTimer()
    polling.value = false
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
    assets: readonly(assets),
    detail: readonly(detail),
    error,
    errorDescription,
    load,
    polling: readonly(polling),
    project: readonly(project),
    shareLinks: readonly(shareLinks),
    status: readonly(status),
    stopPoll,
  }
}
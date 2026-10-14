import type { SolutionStateDto } from '@/api/solution-types'
import type { CreateReportBody, CreateReportResult, MyReportItem, ReportDetail, ReportTaskStatus } from '@/api/types'
import type { SessionReport } from '@/utils/aiAgentUi'

export const REPORT_TASK_STATUSES = ['QUEUED', 'GENERATING', 'READY', 'FAILED', 'CANCELLED'] as const

export const REPORT_TASK_COPY: Record<ReportTaskStatus, string> = {
  QUEUED: '报告已进入生成队列',
  GENERATING: '正在生成报告…',
  READY: '报告已生成',
  FAILED: '报告生成失败',
  CANCELLED: '报告已取消',
}

export const REPORT_COMPLETED_MESSAGE = '报告已生成。'

export function isTerminalReportStatus(status: ReportTaskStatus | string | null | undefined) {
  return status === 'READY' || status === 'FAILED' || status === 'CANCELLED'
}

export function isInProgressReportStatus(status: ReportTaskStatus | string | null | undefined) {
  return status === 'QUEUED' || status === 'GENERATING'
}

/**
 * 将 Backend 报告状态映射为 C 端任务卡片状态。
 * 内部 retry 仍处于 GENERATING 时不得闪失败。
 */
export function mapReportTaskStatus(raw: string | null | undefined): ReportTaskStatus {
  const status = (raw || '').toUpperCase()
  if (status === 'QUEUED' || status === 'DRAFT') {
    return 'QUEUED'
  }
  if (status === 'GENERATING' || status === 'PROCESSING' || status === 'RUNNING' || status === 'ACTIVE') {
    return 'GENERATING'
  }
  if (status === 'READY' || status === 'PENDING_REVIEW' || status === 'APPROVED' || status === 'REJECTED' || status === 'PUBLISHED') {
    return 'READY'
  }
  if (status === 'FAILED') {
    return 'FAILED'
  }
  if (status === 'CANCELLED') {
    return 'CANCELLED'
  }
  return 'GENERATING'
}

export function reportTaskTitle(status: ReportTaskStatus) {
  return REPORT_TASK_COPY[status]
}

export function shouldPollReportStatus(status: ReportTaskStatus | string | null | undefined) {
  return isInProgressReportStatus(status)
}

/** 只从服务端方案状态取 ID，不代用户 Confirm，也不提交工程值。 */
export function confirmedReportBody(state: SolutionStateDto | null | undefined, conversationId: string | null | undefined): CreateReportBody | null {
  if (!conversationId || state?.conversationId !== conversationId || state.stage !== 'CONFIRMED' || !state.confirmedSnapshotId)
    return null
  return { reportType: 'technical_scheme', conversationId, solutionSnapshotId: state.confirmedSnapshotId }
}

export function createdReportTask(result: CreateReportResult): SessionReport {
  const reportStatus = result.status ?? result.report.status
  const status = mapReportTaskStatus(reportStatus)
  return {
    id: result.report.id,
    projectId: result.report.projectId,
    conversationId: result.report.conversationId ?? undefined,
    solutionSnapshotId: result.solutionSnapshotId,
    taskId: result.taskId,
    reportStatus,
    status,
    title: reportStatus === 'DRAFT' ? '报告草稿，尚未生成' : reportTaskTitle(status),
    errorMessage: result.report.errorMessage,
    publishedAt: result.report.publishedAt,
    reused: result.reused,
    messageId: null,
  }
}

/** 报告状态决定生成/审核；task 仅提供任务信息；产物数组决定文件可用性。 */
export function reportTaskPresentation(report: SessionReport) {
  const status = report.reportStatus ? mapReportTaskStatus(report.reportStatus) : report.status ?? 'GENERATING'
  const reviewLabel = ({ PENDING_REVIEW: '审核中', APPROVED: '审核通过', REJECTED: '审核未通过' } as Record<string, string>)[report.reportStatus ?? ''] ?? ''
  const taskLabel = ({ QUEUED: '任务排队中', ACTIVE: '任务执行中', COMPLETED: '任务已完成', FAILED: '任务失败' } as const)[report.task?.status ?? 'QUEUED']
  return {
    status,
    title: report.reportStatus === 'DRAFT' ? '报告草稿，尚未生成' : reportTaskTitle(status),
    reviewLabel,
    publicationLabel: report.publishedAt === undefined ? '' : report.publishedAt ? '已发布' : '未发布',
    taskLabel: report.task ? taskLabel : '',
    progress: report.task?.progress,
    errorMessage: report.errorMessage || report.task?.errorMessage || '',
    canOpenDetail: Boolean(report.id),
    canPreviewPdf: Boolean(report.id && report.availableFormats?.includes('PDF')),
    canRetry: Boolean(report.id && (report.reportStatus ?? status) === 'FAILED'),
    shouldPoll: report.reportStatus !== 'DRAFT' && shouldPollReportStatus(status),
  }
}

export function reportDetailPresentation(detail: ReportDetail) {
  const presentation = reportTaskPresentation({
    id: detail.report.id,
    projectId: detail.report.projectId,
    title: '',
    reportStatus: detail.report.status,
    task: detail.task,
    availableFormats: detail.availableFormats,
    publishedAt: detail.report.publishedAt,
    errorMessage: detail.report.errorMessage,
  })
  return {
    ...presentation,
    formal: detail.report.reportType === 'technical_scheme' || detail.report.reportType === 'project_brief',
    pdfLabel: presentation.canPreviewPdf
      ? 'PDF 已就绪'
      : presentation.shouldPoll
        ? 'PDF 尚未就绪，正在等待生成'
        : presentation.status === 'FAILED'
          ? 'PDF 生成失败'
          : presentation.status === 'CANCELLED'
            ? '报告已取消'
            : 'PDF 尚未生成或文件已失效',
  }
}

export function reportErrorMessage(error: unknown, fallback = '报告请求失败，请稍后重试') {
  const failure = error as { message?: unknown, data?: { error?: { message?: unknown } } } | null
  const message = failure?.data?.error?.message || failure?.message
  return typeof message === 'string' && message ? message : fallback
}

export function reportAccessDenied(error: unknown) {
  const failure = error as { code?: unknown, data?: { error?: { code?: unknown } } } | null
  return [401, 403, 404].includes(Number(failure?.data?.error?.code ?? failure?.code))
}

/** 列表 API 不含 publishedAt，UI 投影从既有详情 API 补充，不能按状态猜发布。 */
export interface ReportListViewItem extends MyReportItem {
  publishedAt?: string | null
}

export async function readReportListStatus(items: MyReportItem[], request: (id: string) => Promise<ReportDetail>, isCurrent: () => boolean): Promise<ReportListViewItem[]> {
  const result: ReportListViewItem[] = items.map(item => ({ ...item }))
  let next = 0
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (isCurrent() && next < items.length) {
      const index = next++
      const item = items[index]
      try {
        const detail = await request(item.id)
        if (isCurrent() && detail.report.id === item.id)
          result[index] = { ...item, status: detail.report.status, publishedAt: detail.report.publishedAt }
      }
      catch {
        // 读取失败仍保留列表原状态；不把未知的发布状态显示成未发布。
      }
    }
  }))
  return result
}

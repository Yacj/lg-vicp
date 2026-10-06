import type { ReportTaskStatus } from '@/api/types'

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
  if (status === 'READY' || status === 'PENDING_REVIEW' || status === 'APPROVED' || status === 'PUBLISHED') {
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

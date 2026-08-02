import type { AsyncTaskStatus, FileStatus } from '@/types/file'

/**
 * 任务 / 文件状态展示映射。
 * 状态枚举以后端为准，展示文本用于界面可读性，原文通过 title 保留可追溯性。
 */

export type TaskStatusTheme = 'default' | 'primary' | 'success' | 'warning' | 'danger'

export const FILE_STATUS_TEXT: Record<FileStatus, string> = {
  UPLOADING: '上传中',
  UPLOADED: '已上传',
  QUEUED: '排队中',
  PARSING: '解析中',
  OCR_REQUIRED: '需要 OCR',
  INDEXING: '索引中',
  READY: '已完成',
  FAILED: '失败',
  DELETED: '已删除',
}

export const TASK_STATUS_TEXT: Record<AsyncTaskStatus, string> = {
  QUEUED: '排队中',
  ACTIVE: '处理中',
  COMPLETED: '已完成',
  FAILED: '失败',
}

const STATUS_THEME_MAP: Record<string, TaskStatusTheme> = {
  QUEUED: 'primary',
  ACTIVE: 'primary',
  PENDING: 'primary',
  PROCESSING: 'primary',
  UPLOADING: 'primary',
  UPLOADED: 'default',
  PARSING: 'primary',
  INDEXING: 'primary',
  READY: 'success',
  COMPLETED: 'success',
  SUCCESS: 'success',
  FAILED: 'danger',
  ERROR: 'danger',
  OCR_REQUIRED: 'warning',
  CANCELLED: 'default',
  DELETED: 'default',
  DEFAULT: 'default',
}

export function taskStatusTheme(status: string): TaskStatusTheme {
  return STATUS_THEME_MAP[status] ?? 'default'
}

/** 后端状态原文对应的可读文本；未知状态回退为原文。 */
export function fileStatusText(status: FileStatus): string {
  return FILE_STATUS_TEXT[status] ?? status
}

export function taskStatusText(status: AsyncTaskStatus): string {
  return TASK_STATUS_TEXT[status] ?? status
}

/** 通用状态文本解析（兼容文件状态与任务状态）。 */
export function statusText(status: string): string {
  return FILE_STATUS_TEXT[status as FileStatus] ?? TASK_STATUS_TEXT[status as AsyncTaskStatus] ?? status
}
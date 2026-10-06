import type { AppStatus } from '@/components/ui/AppStatusTag.vue'
import type {
  CollectionMode,
  CollectionTask,
  CollectionTaskStatus,
  CollectionUiStatus,
} from '@/types/collection'

const UI_STATUS_META: Record<CollectionUiStatus, { label: string, status: AppStatus }> = {
  COLLECTING: { label: '采集中', status: 'processing' },
  WAITING_CONFIRM: { label: '待确认', status: 'warning' },
  COMPLETED: { label: '已入库', status: 'success' },
  FAILED: { label: '采集失败', status: 'error' },
}

const MODE_LABEL: Record<CollectionMode, string> = {
  MANUAL: '手动采集',
  AUTO: '自动采集',
}

export function toCollectionUiStatus(status: CollectionTaskStatus): CollectionUiStatus {
  if (status === 'PENDING' || status === 'RUNNING') {
    return 'COLLECTING'
  }
  if (status === 'WAITING_CONFIRM' || status === 'COMPLETED' || status === 'FAILED') {
    return status
  }
  return 'FAILED'
}

export const COLLECTION_UI_STATUS_OPTIONS = [
  { label: '采集中', value: 'COLLECTING' },
  { label: '待确认', value: 'WAITING_CONFIRM' },
  { label: '已入库', value: 'COMPLETED' },
  { label: '采集失败', value: 'FAILED' },
] as const

export function collectionUiStatusMeta(status: CollectionTaskStatus | CollectionUiStatus): {
  label: string
  status: AppStatus
} {
  if (status === 'COLLECTING') {
    return UI_STATUS_META.COLLECTING
  }
  return UI_STATUS_META[toCollectionUiStatus(status)]
}

export function collectionModeLabel(mode: CollectionMode): string {
  return MODE_LABEL[mode]
}

export function isCollectionConfirmable(task: Pick<CollectionTask, 'status' | 'importedKnowledgeDocumentId'>): boolean {
  return task.status === 'WAITING_CONFIRM' && !task.importedKnowledgeDocumentId
}

export function isCollectionImported(task: Pick<CollectionTask, 'status' | 'importedKnowledgeDocumentId'>): boolean {
  return Boolean(task.importedKnowledgeDocumentId) || task.status === 'COMPLETED'
}

export function collectionResultFileName(task: Pick<CollectionTask, 'resultFileId' | 'resultMeta'>): string | null {
  const fileName = task.resultMeta?.fileName
  if (typeof fileName === 'string' && fileName.trim()) {
    return fileName.trim()
  }
  return task.resultFileId ? '采集结果' : null
}

export function collectionResultMimeType(task: Pick<CollectionTask, 'resultMeta'>): string {
  const mimeType = task.resultMeta?.mimeType
  return typeof mimeType === 'string' && mimeType.trim()
    ? mimeType.trim()
    : 'application/octet-stream'
}

export function collectionResultCount(task: Pick<CollectionTask, 'resultMeta'>): string {
  const storedCount = task.resultMeta?.storedCount
  if (typeof storedCount === 'number') {
    return String(storedCount)
  }
  const count = task.resultMeta?.count
  return typeof count === 'number' ? String(count) : '—'
}

export function collectionRunDurationMs(task: Pick<CollectionTask, 'startedAt' | 'finishedAt'>): number | null {
  if (!task.startedAt || !task.finishedAt) {
    return null
  }
  const started = Date.parse(task.startedAt)
  const finished = Date.parse(task.finishedAt)
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) {
    return null
  }
  return finished - started
}

export function collectionMetaNumber(meta: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = meta?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

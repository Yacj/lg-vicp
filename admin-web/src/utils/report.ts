import type { ReportArtifactType, ReportItem, ReportStatus, ReportType, ShareLink } from '@/types/report'
import type { AppStatus } from '@/components/ui/AppStatusTag.vue'

/**
 * 报告成果中心展示状态机（纯函数，无副作用）。
 * 六态统一映射：等待生成 / 生成中 / 已完成 / 失败 / 已发布 / 草稿。
 * 后端枚举 DRAFT / QUEUED / GENERATING / READY / FAILED；
 * 「已发布」由 READY + publishedAt 派生；「已作废」后端无对应状态，不虚构。
 */

/** 报告类型标签，对齐后端 createReportBodySchema 枚举。 */
export const REPORT_TYPE_META: Record<ReportType, { label: string, description: string }> = {
  energy_design: { description: '节能设计方案报告', label: '节能设计' },
  design_note: { description: '设计说明文档', label: '设计说明' },
  marketing_copy: { description: '营销推广文案', label: '营销文案' },
}

/** 报告状态展示元数据（六态）。 */
export interface ReportStateMeta {
  label: string
  status: AppStatus
  /** 是否终态（终态不参与自动轮询）。 */
  terminal: boolean
}

export const REPORT_STATE_META: Record<ReportStatus, ReportStateMeta> = {
  DRAFT: { label: '草稿', status: 'default', terminal: true },
  QUEUED: { label: '等待生成', status: 'warning', terminal: false },
  GENERATING: { label: '生成中', status: 'processing', terminal: false },
  READY: { label: '已完成', status: 'success', terminal: true },
  FAILED: { label: '失败', status: 'error', terminal: true },
}

/** 派生出含「已发布」的完整展示状态。 */
export function reportStateMeta(report: Pick<ReportItem, 'status' | 'publishedAt'>): ReportStateMeta {
  if (report.status === 'READY' && report.publishedAt) {
    return { label: '已发布', status: 'success', terminal: true }
  }
  return REPORT_STATE_META[report.status] ?? { label: report.status, status: 'default', terminal: true }
}

/** 报告是否处于生成流程（等待/生成中），供轮询与禁用操作判断。 */
export function isReportInProgress(status: ReportStatus): boolean {
  return status === 'QUEUED' || status === 'GENERATING'
}

/** 报告是否可重新生成（草稿或失败，对齐后端 POST /reports/:id/generate 约束）。 */
export function canRegenerateReport(status: ReportStatus): boolean {
  return status === 'DRAFT' || status === 'FAILED'
}

/** 报告是否可发布（仅已完成且未发布）。 */
export function canPublishReport(report: Pick<ReportItem, 'status' | 'publishedAt'>): boolean {
  return report.status === 'READY' && !report.publishedAt
}

export function getReportTypeLabel(type: string): string {
  return REPORT_TYPE_META[type as ReportType]?.label ?? type
}

/** 文件大小格式化（B/KB/MB/GB，保留一位小数）。 */
export function formatFileSize(sizeBytes: number | null | undefined): string {
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return '-'
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`
  }
  const units = ['KB', 'MB', 'GB']
  let value = sizeBytes / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1024; index++) {
    value /= 1024
    unit = units[index]
  }
  return `${value.toFixed(1)} ${unit}`
}

/** 创建人展示：本人显示「我」，否则显示短 ID（后端未提供批量用户名映射）。 */
export function formatCreatorName(createdById: string, currentUserId: string | null | undefined): string {
  if (!currentUserId) {
    return createdById.slice(0, 8)
  }
  return createdById === currentUserId ? '我' : createdById.slice(0, 8)
}

/** 文件格式展示名。 */
export const REPORT_ARTIFACT_LABELS: Record<ReportArtifactType, string> = {
  HTML: '网页预览',
  IMAGE: '图片',
  PDF: 'PDF',
  WORD: 'Word',
}

export type ShareState = 'enabled' | 'disabled' | 'expired' | 'exhausted'

/** 分享链接有效性判定（对齐后端公开访问校验：enabled、expiresAt、maxViews）。 */
export function shareState(share: Pick<ShareLink, 'enabled' | 'expiresAt' | 'maxViews' | 'viewCount'>): ShareState {
  if (!share.enabled) {
    return 'disabled'
  }
  if (share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now()) {
    return 'expired'
  }
  if (share.maxViews !== null && share.maxViews !== undefined && share.viewCount >= share.maxViews) {
    return 'exhausted'
  }
  return 'enabled'
}

export const SHARE_STATE_META: Record<ShareState, { label: string, status: AppStatus }> = {
  enabled: { label: '有效', status: 'success' },
  disabled: { label: '已禁用', status: 'disabled' },
  expired: { label: '已过期', status: 'warning' },
  exhausted: { label: '次数用完', status: 'warning' },
}

/** 公开访问路径补全为完整链接。 */
export function shareFullUrl(sharePath: string): string {
  const base = window.location.origin
  return `${base}${sharePath}`
}
import type {
  CreateReportInput,
  MyReportItem,
  PublicReportType,
  ReportAffiliationFilter,
  ReportArtifactType,
  ReportExportFormat,
  ReportItem,
  ReportStatus,
  ReportType,
  ShareLink,
} from '@/types/report'
import type { AppStatus } from '@/components/ui/AppStatusTag.vue'

/**
 * 报告成果中心展示状态机（纯函数，无副作用）。
 * 六态统一映射：等待生成 / 生成中 / 已完成 / 失败 / 已发布 / 草稿。
 * 后端枚举 DRAFT / QUEUED / GENERATING / READY / FAILED / PENDING_REVIEW / APPROVED / REJECTED；
 * 「已发布」由终态 + publishedAt 派生；「已作废」后端无对应状态，不虚构。
 */

/** 需审核的报告类型，对齐后端 reportTypeRequiresReview。 */
const REVIEW_REQUIRED_TYPES = new Set([
  'technical_scheme',
  'project_brief',
  'material_compare',
  'TEMPLATE',
])

/** 报告类型标签。普通页面优先用 GET /types 的 name；此处仅作离线回退。 */
export const REPORT_TYPE_META: Record<ReportType, { label: string, description: string }> = {
  technical_scheme: { description: '覆盖封面、项目概况、方案、计算、对比、引用依据与免责声明的完整技术报告', label: '综合技术方案报告' },
  project_brief: { description: '面向项目沟通的精简方案报告，不含完整计算过程', label: '项目方案简报' },
  material_compare: { description: 'VICP 与竞品材料对比结论报告，可不关联项目', label: '材料对比报告' },
  ai_conversation: { description: '将 AI 会话回答整理为可读报告，可不关联项目', label: 'AI对话整理报告' },
  energy_design: { description: '历史 AI 报告类型，兼容已有生成与导出', label: '建筑节能设计报告' },
  design_note: { description: '历史 AI 报告类型，兼容已有生成与导出', label: 'VICP 设计说明' },
  marketing_copy: { description: '历史 AI 报告类型，兼容已有生成与导出', label: 'VICP 项目说明' },
  TEMPLATE: { description: '历史模板报告类型，兼容已有快照与审核', label: '工程报告' },
}

/** 报告状态展示元数据。 */
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
  PENDING_REVIEW: { label: '待审核', status: 'warning', terminal: true },
  APPROVED: { label: '已通过', status: 'success', terminal: true },
  REJECTED: { label: '已驳回', status: 'error', terminal: true },
}

/** 派生出含「已发布」的完整展示状态。 */
export function reportStateMeta(report: Pick<ReportItem, 'status' | 'publishedAt'>): ReportStateMeta {
  if (report.publishedAt && (report.status === 'READY' || report.status === 'APPROVED')) {
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

/** 报告是否可发布：AI 报告 READY；模板类报告需先审核通过（APPROVED）。 */
export function canPublishReport(report: Pick<ReportItem, 'status' | 'publishedAt' | 'reportType'>): boolean {
  if (report.publishedAt) {
    return false
  }
  if (reportTypeRequiresReview(report.reportType)) {
    return report.status === 'APPROVED'
  }
  return report.status === 'READY'
}

export function reportTypeRequiresReview(type: string): boolean {
  return REVIEW_REQUIRED_TYPES.has(type)
}

export function canSubmitReportReview(report: Pick<ReportItem, 'status' | 'reportType'>): boolean {
  return reportTypeRequiresReview(report.reportType) && report.status === 'READY'
}

export function canApproveOrRejectReport(status: ReportStatus): boolean {
  return status === 'PENDING_REVIEW'
}

export function getReportTypeLabel(type: string, catalog: readonly PublicReportType[] = []): string {
  const fromCatalog = catalog.find(item => item.code === type)?.name
  if (fromCatalog) {
    return fromCatalog
  }
  return REPORT_TYPE_META[type as ReportType]?.label ?? type
}

export const REPORT_PROJECT_REQUIRED_MESSAGE = '该报告类型需要关联项目后才能生成。'

export function resolvePublicReportType(
  types: readonly PublicReportType[],
  code: string,
): PublicReportType | undefined {
  return types.find(item => item.code === code && item.enabled)
}

/** 普通生成只提交报告类型与可选项目，不携带模板/版本。 */
export function buildCreateReportInput(options: {
  reportType: string
  projectId?: string
  requiresProject: boolean
}): { ok: true, input: CreateReportInput } | { ok: false, message: string } {
  const reportType = options.reportType.trim()
  if (!reportType) {
    return { ok: false, message: '请选择报告类型' }
  }
  const projectId = options.projectId?.trim() || undefined
  if (options.requiresProject && !projectId) {
    return { ok: false, message: REPORT_PROJECT_REQUIRED_MESSAGE }
  }
  return {
    ok: true,
    input: projectId ? { reportType, projectId } : { reportType },
  }
}

/** 列表项目列：有项目显示名称，无项目显示破折号，不展示「无 / 未关联」。 */
export function formatReportProjectName(project: { name?: string | null } | null | undefined): string {
  const name = project?.name?.trim()
  return name ? name : '—'
}

export function hasReportProject(projectId: string | null | undefined): boolean {
  return Boolean(projectId)
}

export function filterReportsByAffiliation(
  items: readonly MyReportItem[],
  affiliation: ReportAffiliationFilter,
): MyReportItem[] {
  if (affiliation === 'linked') {
    return items.filter(item => item.project !== null)
  }
  if (affiliation === 'standalone') {
    return items.filter(item => item.project === null)
  }
  return [...items]
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

export const REPORT_SETTINGS_COVER_FALLBACK = 'VICP智能技术方案'
export const REPORT_SETTINGS_PREVIEW_NOTICE = '这是按当前设置的版式示意，不是正式报告文件。'
export const REPORT_SETTINGS_SECTION_HIDDEN_HINT = '按设置不输出'

export interface ReportSettingsPreviewInput {
  coverTitle: string
  headerText: string
  footerText: string
  disclaimerText: string
  showCalculationProcess: boolean
  showSourceReferences: boolean
  showDisclaimer: boolean
  defaultExportFormat: ReportExportFormat
  logoUrl?: string
  reportTypeLabel?: string
}

export interface ReportSettingsPreviewSection {
  key: 'calculation' | 'sources'
  title: string
  visible: boolean
  placeholder: string
}

export interface ReportSettingsPreview {
  notice: string
  headerText: string
  footerText: string
  coverTitle: string
  logoUrl: string
  reportTypeLabel: string
  exportFormatLabel: string
  disclaimerText: string | null
  sections: ReportSettingsPreviewSection[]
}

function trimOrEmpty(value: string | undefined): string {
  return value?.trim() ?? ''
}

/** 将报告设置表单投影为版式示意数据，不生成真实 Word/PDF。 */
export function buildReportSettingsPreview(input: ReportSettingsPreviewInput): ReportSettingsPreview {
  const coverTitle = trimOrEmpty(input.coverTitle) || REPORT_SETTINGS_COVER_FALLBACK
  return {
    coverTitle,
    disclaimerText: input.showDisclaimer ? (trimOrEmpty(input.disclaimerText) || '（未填写免责声明文案）') : null,
    exportFormatLabel: input.defaultExportFormat === 'DOCX' ? 'Word' : 'PDF',
    footerText: trimOrEmpty(input.footerText),
    headerText: trimOrEmpty(input.headerText),
    logoUrl: trimOrEmpty(input.logoUrl),
    notice: REPORT_SETTINGS_PREVIEW_NOTICE,
    reportTypeLabel: trimOrEmpty(input.reportTypeLabel),
    sections: [
      {
        key: 'calculation',
        placeholder: '此处将输出热工计算过程。',
        title: '计算过程',
        visible: input.showCalculationProcess,
      },
      {
        key: 'sources',
        placeholder: '此处将输出引用来源。',
        title: '引用来源',
        visible: input.showSourceReferences,
      },
    ],
  }
}
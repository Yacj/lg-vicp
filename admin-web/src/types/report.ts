import type { PageResult } from './api'

/**
 * 报告成果中心类型定义。
 * 严格对齐后端契约：
 * - modules/reports/reports.routes.ts
 * - modules/shares/shares.routes.ts
 * - modules/ai/ai.routes.ts（GET /ai/conversations/:id 聚合返回）
 * - modules/ai/ai-admin.routes.ts（运营详情）
 */

/** 报告类型，与后端 createReportBodySchema 对齐。 */
export type ReportType = 'energy_design' | 'design_note' | 'marketing_copy'

/** 报告状态，与后端 reportStatusEnum 对齐。 */
export type ReportStatus = 'DRAFT' | 'QUEUED' | 'GENERATING' | 'READY' | 'FAILED'

/** 报告文件格式，与后端 reportArtifactTypeEnum 对齐。 */
export type ReportArtifactType = 'HTML' | 'IMAGE' | 'WORD' | 'PDF'

/** 分享目标类型，与后端 SHARE_TARGET_TYPES 对齐。 */
export type ShareTargetType = 'AI_MESSAGES' | 'REPORT' | 'REPORT_ARTIFACT' | 'PROJECT'

/** 来源资料（report_sources 表投影）。 */
export interface ReportSource {
  id: string
  reportId: string
  messageId: string
  sortOrder: number
  snapshotContent: string
  snapshotMetadata: Record<string, unknown> | null
  createdAt: string
}

/** 报告文件（report_artifacts + files 投影，会话详情返回结构）。 */
export interface ReportArtifactItem {
  id: string
  reportId: string
  type: ReportArtifactType
  createdAt: string
  file: {
    id: string
    originalName: string
    mimeType: string
    sizeBytes: number
    status: string
  }
}

/** 报告记录（reports 表投影）。 */
export interface ReportItem {
  id: string
  projectId: string
  conversationId: string | null
  reportType: string
  status: ReportStatus
  contentJson: Record<string, unknown> | null
  templateVersion: string
  promptTemplateVersion: number | null
  publishedAt: string | null
  errorMessage: string | null
  createdById: string
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 分享链接（share_links 表投影）。 */
export interface ShareLink {
  id: string
  token: string
  targetType: ShareTargetType
  targetId: string | null
  projectId: string | null
  createdById: string | null
  title: string
  snapshotJson: Record<string, unknown>
  enabled: boolean
  expiresAt: string | null
  maxViews: number | null
  viewCount: number
  createdAt: string
  updatedAt: string
}

/** 报告聚合行：报告 + 来源资料 + 文件版本（会话详情 reports 项）。 */
export interface ReportWithAssets extends ReportItem {
  artifacts: ReportArtifactItem[]
  sources: ReportSource[]
}

/** 成果中心列表行：报告 + 会话上下文 + 分享记录。 */
export interface ReportCenterRow extends ReportWithAssets {
  conversationTitle: string | null
  conversationUserId: string | null
  projectName: string
  shareLinks: ShareLink[]
}

/** POST /reports 请求体（createReportBodySchema）。 */
export interface CreateReportInput {
  projectId: string
  conversationId?: string
  reportType: ReportType
  /** 自定义内容；缺省时后端用 sourceMessageIds 组装 selectedAnswers。 */
  contentJson?: Record<string, unknown>
  sourceMessageIds?: string[]
}

/** POST /reports 响应。 */
export interface CreateReportResult {
  message: string
  report: ReportItem
  taskId: string
}

/** GET /reports/:id 响应。 */
export interface ReportDetailResult {
  report: ReportItem
  sources: ReportSource[]
  availableFormats: ReportArtifactType[]
}

/** POST /reports/:id/generate 响应。 */
export interface RegenerateReportResult {
  message: string
  reportId: string
  taskId: string
}

/** POST /reports/:id/publish 响应。 */
export interface PublishReportResult {
  message: string
  report: ReportItem
}

/** GET /reports/:id/artifacts/:type/download-url 响应。 */
export interface ReportDownloadUrlResult {
  url: string
  expiresIn: number
}

/** POST /shares 请求体（createShareBodySchema）。 */
export interface CreateShareInput {
  targetType: ShareTargetType
  reportId?: string
  artifactType?: ReportArtifactType
  title?: string
  projectId?: string
  messageIds?: string[]
  expiresAt?: string
  maxViews?: number
}

/** POST /shares 响应。 */
export interface CreateShareResult {
  message: string
  share: ShareLink
  /** 公开访问路径（/api/v1/public/shares/:token）。 */
  url: string
}

/** PATCH /shares/:id/disable 响应。 */
export interface DisableShareResult {
  message: string
  share: ShareLink
}

/** GET /api/v1/ai/conversations/:id 响应中的报告与分享（仅提取本项目使用字段）。 */
export interface ConversationAssetsResult {
  reports: ReportWithAssets[]
  shareLinks: ShareLink[]
}

/** GET /api/v1/platform/ai/conversations/:id 响应中的报告与分享（仅提取本项目使用字段）。 */
export interface ConversationOpsAssetsResult {
  reports: ReportWithAssets[]
  shareLinks: ShareLink[]
  shareViews: Array<{
    id: string
    shareLinkId: string
    ip: string | null
    userAgent: string | null
    referer: string | null
    createdAt: string
  }>
}

export type { PageResult }
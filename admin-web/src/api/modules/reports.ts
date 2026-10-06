import type {
  ConversationAssetsResult,
  CreateReportInput,
  CreateReportResult,
  CreateShareInput,
  CreateShareResult,
  DisableShareResult,
  MyReportItem,
  MyReportQuery,
  PublicReportType,
  PublishReportResult,
  RegenerateReportResult,
  ReportArtifactType,
  ReportCenterRow,
  ReportDetailResult,
  ReportDownloadUrlResult,
  ReportSettings,
  ReportSettingsUpdate,
} from '@/types/report'
import type { PageResult } from '@/types/api'
import { api } from '@/api/http/client'

const REPORTS_PREFIX = '/api/v1/reports'
const SHARES_PREFIX = '/api/v1/shares'

export interface PlatformReportCenterResult {
  conversationCount: number
  items: ReportCenterRow[]
}

/** 平台报告成果聚合（按项目返回所有用户会话产生的报告）。 */
export function fetchPlatformReportCenter(
  projectId: string,
  signal?: AbortSignal,
): Promise<PlatformReportCenterResult> {
  return api.get<PlatformReportCenterResult>('/api/v1/platform/reports/center', {
    params: { projectId },
    signal,
  })
}

function reportPath(id: string): string {
  return `${REPORTS_PREFIX}/${encodeURIComponent(id)}`
}

const PLATFORM_REPORTS_PREFIX = '/api/v1/platform/reports'

/** 系统预置报告类型（GET /api/v1/reports/types，不含模板版本与渲染细节）。 */
export function fetchReportTypes(signal?: AbortSignal): Promise<{ items: PublicReportType[] }> {
  return api.get<{ items: PublicReportType[] }>(`${REPORTS_PREFIX}/types`, { signal })
}

/** 读取全局报告设置（GET /api/v1/platform/reports/settings，企业 Logo 复用企业信息）。 */
export function fetchReportSettings(signal?: AbortSignal): Promise<ReportSettings> {
  return api.get<ReportSettings>(`${PLATFORM_REPORTS_PREFIX}/settings`, { signal })
}

/** 更新全局报告设置（PUT /api/v1/platform/reports/settings）。 */
export function updateReportSettings(input: ReportSettingsUpdate): Promise<ReportSettings> {
  return api.put<ReportSettings>(`${PLATFORM_REPORTS_PREFIX}/settings`, input)
}

/** 当前用户报告列表（GET /api/v1/reports/my，可按项目筛选；无项目时 project 为 null）。 */
export function fetchMyReports(
  query: MyReportQuery = {},
  signal?: AbortSignal,
): Promise<PageResult<MyReportItem>> {
  return api.get<PageResult<MyReportItem>>(`${REPORTS_PREFIX}/my`, {
    params: {
      page: query.page,
      pageSize: query.pageSize,
      ...(query.projectId ? { projectId: query.projectId } : {}),
    },
    signal,
  })
}

/** 创建并排队生成报告（POST /api/v1/reports；projectId 可省略）。 */
export function createReport(input: CreateReportInput): Promise<CreateReportResult> {
  return api.post<CreateReportResult>(REPORTS_PREFIX, input)
}

/** 获取报告详情（GET /api/v1/reports/:id，未发布报告仅项目可管理者可见）。 */
export function fetchReportDetail(id: string, signal?: AbortSignal): Promise<ReportDetailResult> {
  return api.get<ReportDetailResult>(reportPath(id), { signal })
}

/** 将草稿或失败报告重新加入生成队列（POST /api/v1/reports/:id/generate）。 */
export function regenerateReport(id: string): Promise<RegenerateReportResult> {
  return api.post<RegenerateReportResult>(`${reportPath(id)}/generate`)
}

/** 发布已完成的报告（POST /api/v1/reports/:id/publish，仅 READY）。 */
export function publishReport(id: string): Promise<PublishReportResult> {
  return api.post<PublishReportResult>(`${reportPath(id)}/publish`)
}

/** 获取报告文件下载地址（GET /api/v1/reports/:id/artifacts/:type/download-url）。 */
export function fetchReportDownloadUrl(
  id: string,
  type: ReportArtifactType,
): Promise<ReportDownloadUrlResult> {
  return api.get<ReportDownloadUrlResult>(
    `${reportPath(id)}/artifacts/${encodeURIComponent(type)}/download-url`,
  )
}

/** 删除报告（DELETE /api/v1/reports/:id，软删除并取消发布）。 */
export function deleteReport(id: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(reportPath(id))
}

/** 创建公开分享链接（POST /api/v1/shares）。 */
export function createShare(input: CreateShareInput): Promise<CreateShareResult> {
  return api.post<CreateShareResult>(SHARES_PREFIX, input)
}

/** 禁用分享链接（PATCH /api/v1/shares/:id/disable，仅创建者或超级管理员）。 */
export function disableShare(id: string): Promise<DisableShareResult> {
  return api.patch<DisableShareResult>(`${SHARES_PREFIX}/${encodeURIComponent(id)}/disable`)
}

/**
 * 获取会话关联的报告与分享记录（GET /api/v1/ai/conversations/:id）。
 * 成果列表以 GET /reports/my 为准；本函数仅提取会话详情中的报告文件与分享。
 */
export async function fetchConversationAssets(
  conversationId: string,
  signal?: AbortSignal,
): Promise<ConversationAssetsResult> {
  const detail = await api.get<{
    conversation: { id: string, userId: string, title: string | null, projectId: string | null }
    reports: ConversationAssetsResult['reports']
    shareLinks: ConversationAssetsResult['shareLinks']
  }>(`/api/v1/ai/conversations/${encodeURIComponent(conversationId)}`, { signal })
  return {
    reports: detail.reports,
    shareLinks: detail.shareLinks,
  }
}

/** 会话消息（创建报告时选择来源回答，仅提取 ASSISTANT 消息所需字段）。 */
export interface ConversationMessageSource {
  id: string
  conversationId: string
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL'
  status: string
  content: string
  model: string | null
  createdAt: string
}

/** 获取会话消息列表（GET /api/v1/ai/conversations/:id）。 */
export async function fetchConversationMessages(
  conversationId: string,
  signal?: AbortSignal,
): Promise<ConversationMessageSource[]> {
  const detail = await api.get<{ messages: ConversationMessageSource[] }>(
    `/api/v1/ai/conversations/${encodeURIComponent(conversationId)}`,
    { signal },
  )
  return detail.messages
}

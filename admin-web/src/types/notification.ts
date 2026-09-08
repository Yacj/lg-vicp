/** B 端消息通知（与后端 notifications 表 + notification.service 一致；轮询读取，无 WebSocket） */

export const notificationTypes = [
  'AI_FEEDBACK',
  'STANDARD_PENDING_REVIEW',
  'KNOWLEDGE_PARSE_FAILED',
  'REPORT_GENERATION_FAILED',
] as const

export type NotificationType = (typeof notificationTypes)[number]

export interface PlatformNotification {
  id: string
  type: NotificationType
  title: string
  content: string | null
  targetType: string | null
  targetId: string | null
  projectId: string | null
  createdAt: string
  /** 当前用户已读时间；null 为未读 */
  readAt: string | null
}

export interface NotificationListQuery {
  page: number
  pageSize: number
  type?: NotificationType
  unreadOnly?: boolean
}

export interface NotificationListResult {
  items: PlatformNotification[]
  total: number
  page: number
  pageSize: number
}

export const notificationTypeMeta: Record<NotificationType, { label: string, route: string }> = {
  AI_FEEDBACK: { label: 'AI 反馈', route: '/ai-ops/feedbacks' },
  STANDARD_PENDING_REVIEW: { label: '标准审核', route: '/standard/documents' },
  KNOWLEDGE_PARSE_FAILED: { label: '知识解析', route: '/knowledge/documents' },
  REPORT_GENERATION_FAILED: { label: '报告生成', route: '/reports' },
}

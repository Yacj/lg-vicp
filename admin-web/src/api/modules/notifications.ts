import type { NotificationListQuery, NotificationListResult } from '@/types/notification'
import { api } from '@/api/http/client'

const NOTIFICATION_PREFIX = '/api/v1/platform/notifications'

/** 查询消息通知列表（含本人已读状态） */
export function fetchNotifications(
  query: NotificationListQuery,
  signal?: AbortSignal,
): Promise<NotificationListResult> {
  return api.get<NotificationListResult>(NOTIFICATION_PREFIX, {
    params: {
      page: query.page,
      pageSize: query.pageSize,
      ...(query.type ? { type: query.type } : {}),
      ...(query.unreadOnly ? { unreadOnly: true } : {}),
    },
    signal,
  })
}

/** 查询未读通知数量（轮询） */
export function fetchUnreadNotificationCount(signal?: AbortSignal): Promise<number> {
  return api.get<{ unreadCount: number }>(`${NOTIFICATION_PREFIX}/unread-count`, { signal })
    .then(result => result.unreadCount)
}

/** 标记单条通知已读（幂等） */
export function markNotificationRead(id: string): Promise<{ message: string, marked: boolean }> {
  return api.put(`${NOTIFICATION_PREFIX}/${encodeURIComponent(id)}/read`)
}

/** 全部标记已读 */
export function markAllNotificationsRead(): Promise<{ message: string, marked: number }> {
  return api.put(`${NOTIFICATION_PREFIX}/read-all`)
}

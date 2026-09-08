import type { NotificationListResult, NotificationType, PlatformNotification } from '@/types/notification'
import { computed, readonly, ref } from 'vue'
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/api/modules/notifications'

/**
 * 消息通知中心（模块级共享状态，多组件复用同一份未读数）：
 * - 未读数轮询（60s），不引入 WebSocket；无权限时调用方不启动轮询即可；
 * - 列表在 Header 面板打开时按需拉取；
 * - 反馈处理等业务动作完成后调用 refreshUnread() 保持角标准确。
 */

const UNREAD_POLL_INTERVAL_MS = 60_000
const PAGE_SIZE = 20

const unreadCount = ref(0)
const unreadCountReady = ref(false)
const items = ref<PlatformNotification[]>([])
const total = ref(0)
const page = ref(1)
const listLoading = ref(false)
const listError = ref<unknown>(null)
const typeFilter = ref<NotificationType | ''>('')
const unreadOnly = ref(false)

let pollTimer: ReturnType<typeof setInterval> | null = null
let pollSequence = 0

async function refreshUnread(): Promise<void> {
  const sequence = ++pollSequence
  try {
    const count = await fetchUnreadNotificationCount()
    if (sequence !== pollSequence) {
      return
    }
    unreadCount.value = count
    unreadCountReady.value = true
  }
  catch {
    // 轮询失败保持上次值，不打断用户操作
  }
}

function startPolling(): void {
  if (pollTimer !== null) {
    return
  }
  void refreshUnread()
  pollTimer = setInterval(() => {
    void refreshUnread()
  }, UNREAD_POLL_INTERVAL_MS)
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function loadPage(nextPage = page.value): Promise<void> {
  listLoading.value = true
  listError.value = null
  try {
    const result: NotificationListResult = await fetchNotifications({
      page: nextPage,
      pageSize: PAGE_SIZE,
      ...(typeFilter.value ? { type: typeFilter.value } : {}),
      ...(unreadOnly.value ? { unreadOnly: true } : {}),
    })
    items.value = result.items
    total.value = result.total
    page.value = result.page
  }
  catch (cause) {
    listError.value = cause
  }
  finally {
    listLoading.value = false
  }
}

async function markRead(id: string): Promise<void> {
  await markNotificationRead(id)
  const target = items.value.find(item => item.id === id)
  if (target && !target.readAt) {
    target.readAt = new Date().toISOString()
  }
  unreadCount.value = Math.max(0, unreadCount.value - 1)
}

async function markAllRead(): Promise<void> {
  const result = await markAllNotificationsRead()
  if (result.marked > 0) {
    const now = new Date().toISOString()
    for (const item of items.value) {
      item.readAt = item.readAt ?? now
    }
  }
  unreadCount.value = 0
}

function changePage(nextPage: number): void {
  void loadPage(nextPage)
}

function applyFilter(type: NotificationType | '', onlyUnread: boolean): void {
  typeFilter.value = type
  unreadOnly.value = onlyUnread
  void loadPage(1)
}

export function useNotifications() {
  return {
    unreadCount: readonly(unreadCount),
    unreadCountReady: readonly(unreadCountReady),
    items: readonly(items),
    total: readonly(total),
    page: readonly(page),
    pageSize: PAGE_SIZE,
    listLoading: readonly(listLoading),
    listError: readonly(listError),
    typeFilter: readonly(typeFilter),
    unreadOnly: readonly(unreadOnly),
    hasUnread: computed(() => unreadCount.value > 0),
    startPolling,
    stopPolling,
    refreshUnread,
    loadPage,
    markRead,
    markAllRead,
    changePage,
    applyFilter,
  }
}

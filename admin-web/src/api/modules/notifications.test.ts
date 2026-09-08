import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/http/client'
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from './notifications'

vi.mock('@/api/http/client', () => ({
  api: {
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
  getHttpAccessToken: vi.fn(),
  httpBaseURL: 'https://api.example.test',
}))

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('notification contracts', () => {
  it('lists notifications with type and unreadOnly filters', async () => {
    mockedApi.get.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 })
    await fetchNotifications({ page: 2, pageSize: 20, type: 'AI_FEEDBACK', unreadOnly: true })
    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/notifications', {
      params: { page: 2, pageSize: 20, type: 'AI_FEEDBACK', unreadOnly: true },
    })
  })

  it('omits empty filters and polls the unread count endpoint', async () => {
    mockedApi.get
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({ unreadCount: 3 })
    await fetchNotifications({ page: 1, pageSize: 20 })
    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/notifications', {
      params: { page: 1, pageSize: 20 },
    })
    await expect(fetchUnreadNotificationCount()).resolves.toBe(3)
    expect(mockedApi.get).toHaveBeenLastCalledWith('/api/v1/platform/notifications/unread-count', { signal: undefined })
  })

  it('marks single and all notifications read via PUT', async () => {
    mockedApi.put.mockResolvedValue({ message: 'ok', marked: true })
    await markNotificationRead('n-1')
    expect(mockedApi.put).toHaveBeenCalledWith('/api/v1/platform/notifications/n-1/read')

    mockedApi.put.mockResolvedValueOnce({ message: 'ok', marked: 2 })
    await markAllNotificationsRead()
    expect(mockedApi.put).toHaveBeenCalledWith('/api/v1/platform/notifications/read-all')
  })
})

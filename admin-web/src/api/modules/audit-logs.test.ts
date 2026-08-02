import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/http/client'
import { fetchProjectAuditLogs } from './audit-logs'

vi.mock('@/api/http/client', () => ({
  api: {
    get: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('audit log api contracts', () => {
  it('fetches audit logs scoped to a project with backend pagination', async () => {
    const signal = new AbortController().signal
    await fetchProjectAuditLogs('project-1', { page: 2, pageSize: 10 }, signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/audit-logs', {
      params: { page: 2, pageSize: 10, projectId: 'project-1' },
      signal,
    })
  })
})
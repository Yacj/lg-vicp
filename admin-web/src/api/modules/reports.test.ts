import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/http/client'
import {
  createReport,
  createShare,
  deleteReport,
  disableShare,
  fetchConversationAssets,
  fetchConversationMessages,
  fetchReportDetail,
  fetchReportDownloadUrl,
  publishReport,
  regenerateReport,
} from './reports'

vi.mock('@/api/http/client', () => ({
  api: {
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('report api contracts', () => {
  it('creates a report with project, conversation and sources', async () => {
    await createReport({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      reportType: 'energy_design',
      sourceMessageIds: ['message-1', 'message-2'],
    })

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/reports', {
      projectId: 'project-1',
      conversationId: 'conversation-1',
      reportType: 'energy_design',
      sourceMessageIds: ['message-1', 'message-2'],
    })
  })

  it('fetches report detail with abort signal', async () => {
    const signal = new AbortController().signal
    await fetchReportDetail('report-1', signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/reports/report-1', { signal })
  })

  it('regenerates a report draft', async () => {
    await regenerateReport('report-1')

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/reports/report-1/generate')
  })

  it('publishes a ready report', async () => {
    await publishReport('report-1')

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/reports/report-1/publish')
  })

  it('fetches artifact download url by type', async () => {
    await fetchReportDownloadUrl('report-1', 'PDF')

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/reports/report-1/artifacts/PDF/download-url')
  })

  it('deletes a report', async () => {
    await deleteReport('report-1')

    expect(mockedApi.delete).toHaveBeenCalledWith('/api/v1/reports/report-1')
  })

  it('creates a share with optional expiry and view limit', async () => {
    await createShare({
      targetType: 'REPORT',
      reportId: 'report-1',
      title: '节能报告分享',
      expiresAt: '2026-12-31T00:00:00.000Z',
      maxViews: 100,
    })

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/shares', {
      targetType: 'REPORT',
      reportId: 'report-1',
      title: '节能报告分享',
      expiresAt: '2026-12-31T00:00:00.000Z',
      maxViews: 100,
    })
  })

  it('disables a share link', async () => {
    await disableShare('share-1')

    expect(mockedApi.patch).toHaveBeenCalledWith('/api/v1/shares/share-1/disable')
  })

  it('extracts reports and share links from conversation detail', async () => {
    mockedApi.get.mockResolvedValueOnce({
      conversation: { id: 'conversation-1', userId: 'user-1', title: '会话', projectId: 'project-1' },
      reports: [{ id: 'report-1' }],
      shareLinks: [{ id: 'share-1' }],
    })

    const result = await fetchConversationAssets('conversation-1')

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/ai/conversations/conversation-1', {
      signal: undefined,
    })
    expect(result).toEqual({
      reports: [{ id: 'report-1' }],
      shareLinks: [{ id: 'share-1' }],
    })
  })

  it('fetches conversation messages for report creation', async () => {
    mockedApi.get.mockResolvedValueOnce({
      messages: [{ id: 'message-1', role: 'ASSISTANT', status: 'COMPLETED' }],
    })

    const result = await fetchConversationMessages('conversation-1')

    expect(result).toEqual([{ id: 'message-1', role: 'ASSISTANT', status: 'COMPLETED' }])
  })
})
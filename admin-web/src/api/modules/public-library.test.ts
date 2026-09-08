import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/http/client'
import {
  fetchPublicLibraryDocumentDetail,
  fetchPublicLibraryDocumentPages,
  fetchPublicLibraryDocuments,
} from './knowledge'

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

/**
 * 公开文库契约：B 端走平台路由 `/platform/knowledge/public/documents`，
 * 服务端强制 PUBLIC + PUBLISHED + 生效中过滤（与 C 端 `/client/knowledge/documents` 同一口径），
 * 前端不再叠加任何"公开"判断。
 */
describe('public library contracts', () => {
  it('requests the shared wiki public documents list with filters', async () => {
    mockedApi.get.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 10 })
    await fetchPublicLibraryDocuments({
      page: 1,
      pageSize: 10,
      docType: 'DETAIL_ATLAS',
      keyword: '图集',
      sort: 'latest',
    })
    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/knowledge/public/documents', {
      params: { page: 1, pageSize: 10, docType: 'DETAIL_ATLAS', keyword: '图集', sort: 'latest' },
    })
  })

  it('requests document detail with the section tree and paginated pages', async () => {
    mockedApi.get
      .mockResolvedValueOnce({ document: { id: 'doc-1', title: '规程', versionId: 'ver-1', version: 1, docNumber: null, docType: 'SPECIFICATION', visibility: 'PUBLIC', projectId: null }, sections: [] })
      .mockResolvedValueOnce({ items: [], total: 0 })

    await fetchPublicLibraryDocumentDetail('doc-1')
    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/knowledge/public/documents/doc-1', { signal: undefined })

    await fetchPublicLibraryDocumentPages('doc-1', 2, 20)
    expect(mockedApi.get).toHaveBeenLastCalledWith('/api/v1/platform/knowledge/public/documents/doc-1/pages', {
      params: { page: 2, pageSize: 20 },
    })
  })
})

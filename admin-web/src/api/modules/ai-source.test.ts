import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/http/client'
import { fetchAiSourceDetail, fetchSourcePageIdIndex } from './ai-source'

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

describe('ai source detail contracts', () => {
  it('requests the unified source-detail endpoint with locator params', async () => {
    mockedApi.get.mockResolvedValueOnce({
      document: { id: 'doc-1', title: '图集', versionId: 'ver-1', version: 1, docNumber: null, docType: 'DETAIL_ATLAS', visibility: 'PUBLIC', projectId: null },
      location: { sectionId: null, chapter: '第5章', section: null, sectionPath: ['第5章'], citationAnchor: null, pageNumber: 21 },
      page: { id: 'page-1', pageNumber: 21, fullText: '正文', blocks: [], pageImageUrl: null },
      highlights: [],
    })
    await fetchAiSourceDetail({ blockId: 'block-1', matchedText: '命中' })
    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/ai/knowledge/source-detail', {
      params: { blockId: 'block-1', matchedText: '命中' },
    })
  })

  it('walks platform pages to build the full page-id index for prev/next', async () => {
    mockedApi.get
      .mockResolvedValueOnce({ items: [{ id: 'p1', pageNumber: 1 }, { id: 'p2', pageNumber: 2 }], total: 120, page: 1, pageSize: 100 })
      .mockResolvedValueOnce({ items: [{ id: 'p3', pageNumber: 3 }], total: 120, page: 2, pageSize: 100 })

    const index = await fetchSourcePageIdIndex('ver-1')
    expect(mockedApi.get).toHaveBeenCalledTimes(2)
    expect(mockedApi.get).toHaveBeenNthCalledWith(1, '/api/v1/platform/knowledge/versions/ver-1/pages', {
      params: { page: 1, pageSize: 100 },
    })
    expect(mockedApi.get).toHaveBeenNthCalledWith(2, '/api/v1/platform/knowledge/versions/ver-1/pages', {
      params: { page: 2, pageSize: 100 },
    })
    expect(index.map(item => item.pageNumber)).toEqual([1, 2, 3])
  })
})

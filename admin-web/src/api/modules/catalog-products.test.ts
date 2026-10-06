import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/http/client'
import {
  compareCatalogProducts,
  createCatalogProduct,
  fetchCatalogProducts,
} from './catalog-products'

vi.mock('@/api/http/client', () => ({
  api: {
    delete: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('catalog product api contracts', () => {
  it('lists products with confirmed filters only', async () => {
    const signal = new AbortController().signal
    await fetchCatalogProducts({ keyword: 'VICP', page: 1, pageSize: 20, status: 'ACTIVE' }, signal)
    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/products', {
      params: { keyword: 'VICP', page: 1, pageSize: 20, status: 'ACTIVE' },
      signal,
    })
  })

  it('creates a product with knowledge links and no invented scoring fields', async () => {
    await createCatalogProduct({
      knowledgeDocumentIds: ['11111111-1111-1111-1111-111111111111'],
      name: 'VICP',
      status: 'ACTIVE',
      summary: '薄抹灰保温装饰板',
    })
    const body = mockedApi.post.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body).toMatchObject({
      knowledgeDocumentIds: ['11111111-1111-1111-1111-111111111111'],
      name: 'VICP',
    })
    expect(body).not.toHaveProperty('score')
    expect(body).not.toHaveProperty('weight')
  })

  it('compares selected products without targetK, weights or thermal required flags', async () => {
    await compareCatalogProducts({
      explainWithAi: true,
      productIds: ['vicp', 'eps', 'rockwool'],
    })
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/products/compare', {
      explainWithAi: true,
      productIds: ['vicp', 'eps', 'rockwool'],
    })
    const body = mockedApi.post.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body).not.toHaveProperty('targetK')
    expect(body).not.toHaveProperty('thermalRequired')
    expect(body).not.toHaveProperty('weights')
  })
})

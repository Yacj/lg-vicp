import type {
  CatalogProduct,
  CatalogProductCompareInput,
  CatalogProductCompareResult,
  CatalogProductInput,
  CatalogProductMutationResult,
  CatalogProductPageResult,
  CatalogProductQuery,
} from '@/types/catalog-product'
import { api } from '@/api/http/client'

const PRODUCTS_PREFIX = '/api/v1/platform/products'

export function fetchCatalogProducts(
  query: CatalogProductQuery,
  signal?: AbortSignal,
): Promise<CatalogProductPageResult> {
  return api.get<CatalogProductPageResult>(PRODUCTS_PREFIX, { params: query, signal })
}

export function fetchCatalogProduct(id: string, signal?: AbortSignal): Promise<CatalogProduct> {
  return api.get<CatalogProduct>(`${PRODUCTS_PREFIX}/${encodeURIComponent(id)}`, { signal })
}

export function createCatalogProduct(input: CatalogProductInput): Promise<CatalogProductMutationResult> {
  return api.post<CatalogProductMutationResult>(PRODUCTS_PREFIX, input)
}

export function updateCatalogProduct(
  id: string,
  input: Partial<CatalogProductInput>,
): Promise<CatalogProductMutationResult> {
  return api.put<CatalogProductMutationResult>(`${PRODUCTS_PREFIX}/${encodeURIComponent(id)}`, input)
}

export function deleteCatalogProduct(id: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`${PRODUCTS_PREFIX}/${encodeURIComponent(id)}`)
}

export function compareCatalogProducts(input: CatalogProductCompareInput): Promise<CatalogProductCompareResult> {
  return api.post<CatalogProductCompareResult>(`${PRODUCTS_PREFIX}/compare`, {
    explainWithAi: input.explainWithAi,
    productIds: input.productIds,
  })
}

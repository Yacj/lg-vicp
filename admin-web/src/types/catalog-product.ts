import type { PageQuery, PageResult } from './api'

export const catalogProductStatuses = ['ACTIVE', 'DISABLED'] as const
export type CatalogProductStatus = (typeof catalogProductStatuses)[number]

/** P0 产品最小骨架，仅 Backend 已确认字段。 */
export interface CatalogProduct {
  id: string
  name: string
  categoryId: string | null
  summary: string | null
  productType?: string | null
  specClass?: 'I' | 'II' | 'III' | null
  thermalConductivity?: number | null
  correctionFactor?: number | null
  thicknessOptionsMm?: number[]
  status: CatalogProductStatus
  sortOrder: number
  knowledgeDocumentIds: string[]
  createdAt: string
  updatedAt: string
}

export interface CatalogProductQuery extends PageQuery {
  keyword?: string
  status?: CatalogProductStatus
}

export interface CatalogProductInput {
  name: string
  categoryId?: string | null
  summary?: string | null
  productType?: string | null
  specClass?: 'I' | 'II' | 'III' | null
  thermalConductivity?: number | null
  correctionFactor?: number | null
  thicknessOptionsMm?: number[]
  status?: CatalogProductStatus
  sortOrder?: number
  knowledgeDocumentIds?: string[]
}

export interface CatalogProductMutationResult {
  message: string
  product: CatalogProduct
}

/** 旧对比接口字段行，新工作台会投影为 dimensions。 */
export interface CatalogProductCompareFieldValue {
  productId: string
  value: unknown
}

export interface CatalogProductCompareField {
  field: string
  values: CatalogProductCompareFieldValue[]
  same: boolean
}

export type CatalogProductCompareSourceType
  = | 'PRODUCT_FIELD'
    | 'KNOWLEDGE'
    | 'USER_REQUIREMENT'
    | 'THERMAL'
    | 'OTHER'
    | (string & {})

export interface CatalogProductCompareEvidenceRef {
  type: string
  id: string
  label: string
  productId?: string
}

export interface CatalogProductCompareDimensionItem {
  productId: string
  value?: string | number | null
  evidenceRefs?: CatalogProductCompareEvidenceRef[]
  insufficient?: boolean
  note?: string
}

export interface CatalogProductCompareDimension {
  key: string
  label: string
  sourceType?: CatalogProductCompareSourceType
  items: CatalogProductCompareDimensionItem[]
  insufficient?: boolean
  note?: string
}

export type CatalogProductCompareThermalStatus = 'NOT_AVAILABLE' | 'PENDING' | 'AVAILABLE'

export interface CatalogProductCompareThermal {
  status: CatalogProductCompareThermalStatus
  results?: unknown[]
}

export interface CatalogProductCompareInput {
  productIds: string[]
  explainWithAi?: boolean
}

/**
 * 产品对比响应。优先消费 dimensions[]；fields 仅兼容旧接口。
 * ranking / scores / agentConfig / targetK 即使回传也不作为新功能依赖。
 */
export interface CatalogProductCompareResult {
  products: CatalogProduct[]
  dimensions?: CatalogProductCompareDimension[]
  fields?: CatalogProductCompareField[]
  aiExplanation: string | null
  evidenceRefs?: CatalogProductCompareEvidenceRef[]
  missingNotes?: string[]
  thermal?: CatalogProductCompareThermal
  ranking?: null
  scores?: null
}

export type CatalogProductPageResult = PageResult<CatalogProduct>

import type {
  CatalogProduct,
  CatalogProductCompareDimension,
  CatalogProductCompareEvidenceRef,
  CatalogProductCompareField,
  CatalogProductCompareResult,
  CatalogProductCompareThermalStatus,
} from '@/types/catalog-product'
import { catalogProductFieldLabel, formatCatalogProductFieldValue } from '@/utils/catalog-product'

export const PRODUCT_COMPARE_MISSING_VALUE = '暂无可靠资料'

export const PRODUCT_COMPARE_AI_DISCLAIMER
  = 'AI说明基于系统已有产品资料和知识依据生成，不代表系统已建立固定评分或最终推荐规则。'

export const PRODUCT_COMPARE_THERMAL_UNAVAILABLE = '当前暂无热工计算结果'

/** 甲方尚未确认的评分/权重字段，即使旧接口回传也不渲染。 */
const FORBIDDEN_DIMENSION_KEYS = new Set([
  'score',
  'scores',
  'rank',
  'ranking',
  'weight',
  'weights',
  'totalScore',
  '总分',
  '排名',
  '权重',
  '性价比分数',
])

export interface ProductCompareCellView {
  productId: string
  display: string
  insufficient: boolean
}

export interface ProductCompareDimensionView {
  key: string
  label: string
  insufficient: boolean
  note?: string
  cells: ProductCompareCellView[]
}

export interface ProductCompareSourceView {
  id: string
  label: string
  type: string
}

export interface ProductCompareWorkbenchView {
  products: CatalogProduct[]
  dimensions: ProductCompareDimensionView[]
  aiExplanation: string | null
  sources: ProductCompareSourceView[]
  missingNotes: string[]
  thermalStatus: CatalogProductCompareThermalStatus
  thermalResults: unknown[] | null
  showThermalResults: boolean
}

export function buildCompareProductIds(ownerProductId: string, compareProductIds: readonly string[]): string[] {
  const owner = ownerProductId.trim()
  const rest = compareProductIds
    .map(id => id.trim())
    .filter(id => id.length > 0 && id !== owner)
  return owner ? [owner, ...uniqueIds(rest)] : uniqueIds(rest)
}

export function isForbiddenCompareDimensionKey(key: string): boolean {
  const normalized = key.trim()
  if (FORBIDDEN_DIMENSION_KEYS.has(normalized)) {
    return true
  }
  return /^(score|rank|weight|总分|排名|权重)/i.test(normalized)
}

export function formatCompareCellDisplay(
  fieldKey: string,
  value: unknown,
  insufficient?: boolean,
): string {
  if (insufficient || value == null || value === '') {
    return PRODUCT_COMPARE_MISSING_VALUE
  }
  const formatted = formatCatalogProductFieldValue(fieldKey, value)
  return formatted === '—' ? PRODUCT_COMPARE_MISSING_VALUE : formatted
}

export function projectProductCompareWorkbench(
  result: CatalogProductCompareResult,
): ProductCompareWorkbenchView {
  const products = result.products ?? []
  const dimensions = projectDimensions(result, products)
  const thermalStatus = result.thermal?.status ?? 'NOT_AVAILABLE'
  const thermalResults = Array.isArray(result.thermal?.results) ? result.thermal.results : []
  const showThermalResults = thermalStatus === 'AVAILABLE' && thermalResults.length > 0

  return {
    products,
    dimensions,
    aiExplanation: result.aiExplanation?.trim() || null,
    sources: projectSources(result.evidenceRefs, products),
    missingNotes: uniqueNotes(result.missingNotes),
    thermalStatus,
    thermalResults: showThermalResults ? thermalResults : null,
    showThermalResults,
  }
}

function projectDimensions(
  result: CatalogProductCompareResult,
  products: readonly CatalogProduct[],
): ProductCompareDimensionView[] {
  const raw = Array.isArray(result.dimensions) && result.dimensions.length > 0
    ? result.dimensions
    : fieldsToDimensions(result.fields ?? [], products)

  return raw
    .filter(dimension => !isForbiddenCompareDimensionKey(dimension.key))
    .map(dimension => ({
      key: dimension.key,
      label: dimension.label || catalogProductFieldLabel(dimension.key),
      insufficient: Boolean(dimension.insufficient),
      note: dimension.note,
      cells: products.map((product) => {
        const item = dimension.items.find(row => row.productId === product.id)
        const insufficient = Boolean(item?.insufficient || item?.value == null || item?.value === '')
        return {
          productId: product.id,
          display: formatCompareCellDisplay(dimension.key, item?.value, insufficient || item?.insufficient),
          insufficient,
        }
      }),
    }))
}

function fieldsToDimensions(
  fields: readonly CatalogProductCompareField[],
  products: readonly CatalogProduct[],
): CatalogProductCompareDimension[] {
  return fields.map((field) => {
    const byProduct = new Map(field.values.map(item => [item.productId, item.value]))
    return {
      key: field.field,
      label: catalogProductFieldLabel(field.field),
      sourceType: 'PRODUCT_FIELD',
      items: products.map((product) => {
        const value = byProduct.get(product.id)
        const missing = value == null || value === ''
        return {
          productId: product.id,
          value: missing ? null : value as string | number | null,
          insufficient: missing,
        }
      }),
    }
  })
}

function projectSources(
  refs: readonly CatalogProductCompareEvidenceRef[] | undefined,
  products: readonly CatalogProduct[],
): ProductCompareSourceView[] {
  const fromRefs = (refs ?? []).map(ref => ({
    id: ref.id,
    label: ref.label || ref.id,
    type: ref.type,
  }))
  if (fromRefs.length > 0) {
    return uniqueSources(fromRefs)
  }
  return uniqueSources(products.map(product => ({
    id: product.id,
    label: product.name,
    type: 'CATALOG_PRODUCT',
  })))
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)]
}

function uniqueNotes(notes: readonly string[] | undefined): string[] {
  return [...new Set((notes ?? []).map(item => item.trim()).filter(Boolean))]
}

function uniqueSources(sources: readonly ProductCompareSourceView[]): ProductCompareSourceView[] {
  const seen = new Set<string>()
  const result: ProductCompareSourceView[] = []
  for (const source of sources) {
    const key = `${source.type}:${source.id}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(source)
  }
  return result
}

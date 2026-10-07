import type { CatalogProductCompareDimension } from '@/types/catalog-product'
import {
  formatCompareCellDisplay,
  isForbiddenCompareDimensionKey,
  projectThermalComparison,
  type ProductCompareDimensionView,
  type ProductCompareSourceView,
  type ProductCompareThermalView,
} from '@/utils/product-compare'

export interface ReportComparisonProductView {
  id: string
  name: string
  summary?: string | null
}

export interface ReportComparisonView {
  selectedProductIds: string[]
  selectedProducts: ReportComparisonProductView[]
  dimensions: ProductCompareDimensionView[]
  sources: ProductCompareSourceView[]
  thermalStatus: 'AVAILABLE' | 'NOT_AVAILABLE' | 'PENDING'
  thermalResults: unknown[] | null
  showThermalResults: boolean
  thermal: ProductCompareThermalView
}

const EXTRACTED_CONTENT_KEYS = new Set([
  'selectedProductIds',
  'selectedProductId',
  'comparisonResult',
  'comparisonContext',
  'sourceRefs',
  'thermalResults',
  'thermal',
  'reportKind',
  'snapshotId',
  'ranking',
  'scores',
  'agentConfig',
  'targetK',
])

export function resolveSelectedProductIds(contentJson: Record<string, unknown> | null | undefined): string[] {
  if (!contentJson) {
    return []
  }
  const fromArray = readStringArray(contentJson.selectedProductIds)
  if (fromArray.length > 0) {
    return fromArray
  }
  const legacy = contentJson.selectedProductId
  return typeof legacy === 'string' && legacy.trim() ? [legacy.trim()] : []
}

export function remainingReportContentJson(
  contentJson: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!contentJson) {
    return null
  }
  const remaining = Object.fromEntries(
    Object.entries(contentJson).filter(([key]) => !EXTRACTED_CONTENT_KEYS.has(key)),
  )
  return Object.keys(remaining).length > 0 ? remaining : null
}

export function projectReportComparison(contentJson: Record<string, unknown> | null | undefined): ReportComparisonView | null {
  if (!contentJson) {
    return null
  }
  const selectedProductIds = resolveSelectedProductIds(contentJson)
  const comparisonResult = asRecord(contentJson.comparisonResult)
  const comparisonContext = asRecord(contentJson.comparisonContext)
  const products = readProducts(comparisonResult?.products ?? comparisonContext?.products)
  const selectedProducts = selectedProductIds.map((id) => {
    const found = products.find(item => item.id === id)
    return found ?? { id, name: id }
  })
  const rawDimensions = readDimensions(comparisonResult?.dimensions ?? comparisonContext?.dimensions)
  const dimensionProducts = selectedProducts.length > 0 ? selectedProducts : products
  const dimensions = rawDimensions
    .filter(dimension => !isForbiddenCompareDimensionKey(dimension.key))
    // 热工维度由后端以 JSON 透传，改由专用热工对比表呈现。
    .filter(dimension => dimension.key !== 'thermal')
    .map(dimension => ({
      key: dimension.key,
      label: dimension.label || dimension.key,
      insufficient: Boolean(dimension.insufficient),
      note: dimension.note,
      cells: dimensionProducts.map((product) => {
        const item = dimension.items.find(row => row.productId === product.id)
        const insufficient = Boolean(item?.insufficient || item?.value == null || item?.value === '')
        return {
          productId: product.id,
          display: formatCompareCellDisplay(dimension.key, item?.value, insufficient || item?.insufficient),
          insufficient,
        }
      }),
    }))

  const sources = readSources(contentJson.sourceRefs ?? comparisonResult?.evidenceRefs ?? comparisonContext?.evidenceRefs)
  const thermal = asRecord(contentJson.thermal) ?? asRecord(comparisonResult?.thermal)
  const thermalStatus = readThermalStatus(thermal?.status)
  const thermalResults = readUnknownArray(contentJson.thermalResults ?? thermal?.results)
  const showThermalResults = thermalStatus === 'AVAILABLE' && thermalResults.length > 0

  if (selectedProductIds.length === 0 && dimensions.length === 0 && sources.length === 0 && !showThermalResults) {
    return null
  }

  return {
    selectedProductIds,
    selectedProducts,
    dimensions,
    sources,
    thermalStatus,
    thermalResults: showThermalResults ? thermalResults : null,
    showThermalResults,
    thermal: projectThermalComparison(dimensionProducts, showThermalResults ? thermalResults : []),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))]
}

function readProducts(value: unknown): ReportComparisonProductView[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item) => {
    const record = asRecord(item)
    if (!record || typeof record.id !== 'string') {
      return []
    }
    return [{
      id: record.id,
      name: typeof record.name === 'string' && record.name.trim() ? record.name : record.id,
      summary: typeof record.summary === 'string' ? record.summary : null,
    }]
  })
}

function readDimensions(value: unknown): CatalogProductCompareDimension[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item) => {
    const record = asRecord(item)
    if (!record || typeof record.key !== 'string' || !Array.isArray(record.items)) {
      return []
    }
    return [{
      key: record.key,
      label: typeof record.label === 'string' ? record.label : record.key,
      sourceType: typeof record.sourceType === 'string' ? record.sourceType : undefined,
      insufficient: record.insufficient === true,
      note: typeof record.note === 'string' ? record.note : undefined,
      items: record.items.flatMap((row) => {
        const cell = asRecord(row)
        if (!cell || typeof cell.productId !== 'string') {
          return []
        }
        return [{
          productId: cell.productId,
          value: typeof cell.value === 'string' || typeof cell.value === 'number' || cell.value == null
            ? cell.value
            : String(cell.value),
          insufficient: cell.insufficient === true,
          note: typeof cell.note === 'string' ? cell.note : undefined,
        }]
      }),
    }]
  })
}

function readSources(value: unknown): ProductCompareSourceView[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set<string>()
  const result: ProductCompareSourceView[] = []
  for (const item of value) {
    const record = asRecord(item)
    if (!record || typeof record.id !== 'string') {
      continue
    }
    const type = typeof record.type === 'string' ? record.type : 'OTHER'
    const key = `${type}:${record.id}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push({
      id: record.id,
      label: typeof record.label === 'string' && record.label.trim() ? record.label : record.id,
      type,
    })
  }
  return result
}

function readUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readThermalStatus(value: unknown): 'AVAILABLE' | 'NOT_AVAILABLE' | 'PENDING' {
  if (value === 'AVAILABLE' || value === 'PENDING' || value === 'NOT_AVAILABLE') {
    return value
  }
  return 'NOT_AVAILABLE'
}

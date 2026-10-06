import type { AiSourceRef } from '@/api/types'

export const COMPARISON_MISSING_VALUE = '暂无可靠资料'
export const COMPARISON_INTRO = '根据现有资料，以下是几个产品的主要差异。你可以选择一个或多个生成进一步报告。'
export const COMPARISON_CONFIRM_LABEL = '确认并生成报告'
export const COMPARISON_THERMAL_NOTE = '目前还没有热工计算结果，这部分暂时不参与比较。'
const MISSING_PRICE_COPY = '目前缺少可靠的价格数据，暂时无法准确比较性价比。'
const MISSING_DATA_COPY = '现有资料还不足以确定这一点。'

/** 甲方未确认的评分/权重字段，即使旧数据回传也不渲染。动态维度本身按 dimensions[] 展示。 */
const FORBIDDEN_DIMENSION_KEYS = new Set([
  'score',
  'scores',
  'rank',
  'ranking',
  'weight',
  'weights',
  'totalScore',
  '性价比分数',
  '热工得分',
  '总分',
  '排名',
  '权重',
])

export interface ComparisonProductItem {
  id: string
  name: string
  summary: string
}

export interface ComparisonCellView {
  productId: string
  display: string
  insufficient: boolean
}

export interface ComparisonDimensionView {
  key: string
  label: string
  insufficient: boolean
  note?: string
  cells: ComparisonCellView[]
}

export interface ComparisonSourceView {
  id: string
  label: string
  typeLabel: string
  source?: AiSourceRef
}

export interface ComparisonThermalRow {
  label: string
  value: string
}

export interface ProductComparisonView {
  comparisonId: string
  version: string
  products: ComparisonProductItem[]
  dimensions: ComparisonDimensionView[]
  missingNotes: string[]
  sources: ComparisonSourceView[]
  thermalRows: ComparisonThermalRow[]
  thermalCoreRows: ComparisonThermalRow[]
  thermalDetailRows: ComparisonThermalRow[]
  thermalConclusion: string
  thermalNote: string
  showThermal: boolean
  intro: string
}

export interface ProductCardItem {
  id: string
  name: string
  summary: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

export function isForbiddenCompareDimensionKey(key: string) {
  const normalized = key.trim()
  if (!normalized) {
    return true
  }
  if (FORBIDDEN_DIMENSION_KEYS.has(normalized)) {
    return true
  }
  return /^(score|rank|weight|总分|排名|权重|性价比分数|热工得分)/i.test(normalized)
}

export function formatComparisonCell(value: unknown, insufficient?: boolean) {
  if (insufficient || value == null || value === '') {
    return COMPARISON_MISSING_VALUE
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'boolean') {
    return value ? '是' : '否'
  }
  const text = String(value).trim()
  return text || COMPARISON_MISSING_VALUE
}

export function parseProductCards(value: unknown): ProductCardItem[] {
  const records = Array.isArray(value)
    ? value
    : Array.isArray(asRecord(value)?.products)
      ? (asRecord(value)?.products as unknown[])
      : []
  const result: ProductCardItem[] = []
  const seen = new Set<string>()
  for (const item of records) {
    const record = asRecord(item)
    const id = asText(record?.id) || asText(record?.productId)
    const name = asText(record?.name) || asText(record?.label) || id
    if (!id || !name || seen.has(id)) {
      continue
    }
    seen.add(id)
    result.push({
      id,
      name,
      summary: asText(record?.summary) || asText(record?.description) || asText(record?.keyFeatures),
    })
  }
  return result
}

function parseProducts(value: unknown): ComparisonProductItem[] {
  return parseProductCards(value).map(item => ({
    id: item.id,
    name: item.name,
    summary: item.summary,
  }))
}

function parseDimensionItems(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item) => {
    const record = asRecord(item)
    return {
      productId: asText(record?.productId) || asText(record?.id),
      value: record?.value,
      insufficient: Boolean(record?.insufficient || record?.value == null || record?.value === ''),
      note: asText(record?.note),
    }
  }).filter(item => item.productId)
}

function fieldsToDimensions(fields: unknown, products: ComparisonProductItem[]): Array<{
  key: string
  label: string
  insufficient?: boolean
  note?: string
  items: ReturnType<typeof parseDimensionItems>
}> {
  if (!Array.isArray(fields)) {
    return []
  }
  return fields.map((field) => {
    const record = asRecord(field)
    const key = asText(record?.field) || asText(record?.key)
    const values = Array.isArray(record?.values) ? record.values : []
    const byProduct = new Map(values.map((item) => {
      const row = asRecord(item)
      return [asText(row?.productId), row?.value] as const
    }))
    return {
      key,
      label: asText(record?.label) || key,
      items: products.map((product) => {
        const value = byProduct.get(product.id)
        const missing = value == null || value === ''
        return {
          productId: product.id,
          value,
          insufficient: missing,
          note: '',
        }
      }),
    }
  }).filter(item => item.key)
}

function sourceTypeLabel(type: string) {
  if (type === 'CATALOG_PRODUCT') {
    return '产品资料'
  }
  if (type === 'KNOWLEDGE_DOCUMENT' || type === 'KNOWLEDGE') {
    return '知识来源'
  }
  if (type === 'ATLAS') {
    return '图集'
  }
  if (type === 'STANDARD') {
    return '标准'
  }
  if (type === 'THERMAL') {
    return '热工结果'
  }
  if (type === 'USER_REQUIREMENT') {
    return '你的关注点'
  }
  return '参考依据'
}

function parseSources(value: unknown): ComparisonSourceView[] {
  if (!Array.isArray(value)) {
    return []
  }
  const result: ComparisonSourceView[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const record = asRecord(item)
    const id = asText(record?.id) || asText(record?.documentId)
    const label = asText(record?.label) || asText(record?.title) || id
    const type = asText(record?.type) || asText(record?.sourceType) || 'OTHER'
    if (!id || !label) {
      continue
    }
    const key = `${type}:${id}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    const canOpen = type === 'KNOWLEDGE_DOCUMENT' || type === 'KNOWLEDGE' || type === 'ATLAS' || type === 'STANDARD'
    result.push({
      id,
      label,
      typeLabel: sourceTypeLabel(type),
      source: canOpen
        ? {
            title: label,
            documentId: id,
            pageLabel: asText(record?.pageLabel) || undefined,
            quote: asText(record?.quote) || undefined,
          }
        : undefined,
    })
  }
  return result
}

function isForbiddenThermalField(key: string) {
  return isForbiddenCompareDimensionKey(key) || /^(status|thermalStatus|code)$/i.test(key)
}

const CORE_THERMAL_PATTERN = /(?:^|[·\s])(?:k|kvalue|r|u|thickness|传热系数|热阻|导热|厚度)/i

function splitThermalRows(rows: ComparisonThermalRow[]) {
  const core = rows.filter(item => CORE_THERMAL_PATTERN.test(item.label))
  const detail = rows.filter(item => !CORE_THERMAL_PATTERN.test(item.label))
  if (core.length) {
    return { core, detail }
  }
  return {
    core: rows.slice(0, Math.min(2, rows.length)),
    detail: rows.slice(Math.min(2, rows.length)),
  }
}

function naturalizeMissingNotes(notes: string[]) {
  return [...new Set(notes.map((item) => {
    if (/价格|性价比/.test(item)) {
      return MISSING_PRICE_COPY
    }
    if (/热工/.test(item)) {
      return COMPARISON_THERMAL_NOTE
    }
    if (/检索失败|Tool无结果|Knowledge unavailable|知识库无结果|知识不可用/i.test(item)) {
      return MISSING_DATA_COPY
    }
    return item
  }).filter(Boolean))]
}

function fingerprintValue(value: string) {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) + value.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}

export function comparisonIdentity(input: {
  comparisonId?: string
  version?: string
  products: ComparisonProductItem[]
  dimensions: ComparisonDimensionView[]
}) {
  const productKey = input.products.map(item => item.id).join(',')
  const dimensionKey = input.dimensions
    .map(item => `${item.key}:${item.cells.map(cell => `${cell.productId}=${cell.display}`).join('/')}`)
    .join('|')
  const fingerprint = fingerprintValue(`${productKey}#${dimensionKey}`)
  return {
    comparisonId: input.comparisonId || `cmp-${productKey || fingerprint}`,
    version: input.version || fingerprint,
  }
}

export function parseThermalRows(results: unknown[] | undefined): ComparisonThermalRow[] {
  if (!Array.isArray(results) || !results.length) {
    return []
  }
  const rows: ComparisonThermalRow[] = []
  results.forEach((item, index) => {
    if (typeof item === 'string' || typeof item === 'number') {
      rows.push({ label: `结果 ${index + 1}`, value: String(item) })
      return
    }
    const record = asRecord(item)
    if (!record) {
      return
    }
    const entries = Object.entries(record).filter(([key, value]) => {
      if (isForbiddenThermalField(key)) {
        return false
      }
      return value != null && value !== ''
    })
    if (!entries.length) {
      return
    }
    const named = asText(record.name) || asText(record.label) || asText(record.productName)
    entries.forEach(([key, value]) => {
      if (key === 'name' || key === 'label' || key === 'productName' || key === 'productId' || key === 'id') {
        return
      }
      rows.push({
        label: named ? `${named} · ${key}` : key,
        value: formatComparisonCell(value),
      })
    })
  })
  return rows
}

export function parseProductComparison(value: unknown): ProductComparisonView | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }
  const nested = asRecord(record.comparisonResult) || asRecord(record.comparison) || record
  const products = parseProducts(nested.products)
  if (!products.length) {
    return null
  }

  const rawDimensions = Array.isArray(nested.dimensions) && nested.dimensions.length
    ? nested.dimensions.map((item) => {
        const dimension = asRecord(item)
        return {
          key: asText(dimension?.key),
          label: asText(dimension?.label) || asText(dimension?.key),
          insufficient: Boolean(dimension?.insufficient),
          note: asText(dimension?.note),
          items: parseDimensionItems(dimension?.items),
        }
      })
    : fieldsToDimensions(nested.fields, products)

  const dimensions = rawDimensions
    .filter(dimension => dimension.key && !isForbiddenCompareDimensionKey(dimension.key))
    .map(dimension => ({
      key: dimension.key,
      label: dimension.label || dimension.key,
      insufficient: Boolean(dimension.insufficient),
      note: dimension.note || undefined,
      cells: products.map((product) => {
        const item = dimension.items.find(row => row.productId === product.id)
        const insufficient = Boolean(item?.insufficient || item?.value == null || item?.value === '')
        return {
          productId: product.id,
          display: formatComparisonCell(item?.value, insufficient),
          insufficient,
        }
      }),
    }))

  const thermal = asRecord(nested.thermal)
  const thermalStatus = asText(thermal?.status)
  const hasThermal = thermalStatus === 'AVAILABLE'
    || (Array.isArray(thermal?.results) && thermal.results.length > 0 && thermalStatus !== 'NOT_AVAILABLE' && thermalStatus !== 'PENDING')
  const thermalRows = hasThermal
    ? parseThermalRows(Array.isArray(thermal?.results) ? thermal.results as unknown[] : [])
    : []
  const { core: thermalCoreRows, detail: thermalDetailRows } = splitThermalRows(thermalRows)
  const thermalConclusion = thermalCoreRows[0]
    ? `${thermalCoreRows[0].label} ${thermalCoreRows[0].value}`.trim()
    : (thermalRows[0] ? `${thermalRows[0].label} ${thermalRows[0].value}`.trim() : '')

  const sources = parseSources(nested.evidenceRefs)
  const fallbackSources = sources.length
    ? sources
    : products.map(product => ({
        id: product.id,
        label: product.name,
        typeLabel: '产品资料',
      }))

  const missingNotes = naturalizeMissingNotes(
    Array.isArray(nested.missingNotes)
      ? nested.missingNotes.map(item => asText(item)).filter(Boolean)
      : [],
  )

  const identity = comparisonIdentity({
    comparisonId: asText(nested.comparisonId) || asText(record.comparisonId),
    version: asText(nested.version) || asText(record.version),
    products,
    dimensions,
  })

  return {
    comparisonId: identity.comparisonId,
    version: identity.version,
    products,
    dimensions,
    missingNotes,
    sources: fallbackSources,
    thermalRows,
    thermalCoreRows,
    thermalDetailRows,
    thermalConclusion,
    thermalNote: hasThermal && thermalRows.length ? '' : COMPARISON_THERMAL_NOTE,
    showThermal: Boolean(hasThermal && thermalRows.length),
    intro: COMPARISON_INTRO,
  }
}

export function selectedProductNames(products: ComparisonProductItem[], selectedIds: string[]) {
  const selected = new Set(selectedIds)
  return products.filter(item => selected.has(item.id)).map(item => item.name)
}

export function canConfirmComparison(selectedCount: number, minSelections = 1) {
  return selectedCount >= minSelections
}

export function formatConfirmedCount(count: number) {
  return `已确认 ${count} 个产品`
}

export function formatSelectedCount(count: number) {
  return `已选择 ${count} 项`
}

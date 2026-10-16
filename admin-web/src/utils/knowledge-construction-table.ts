import type { KnowledgeConstructionContent, KnowledgeRenderLayer } from '@/types/knowledge-page-render'

type DisplayOption = KnowledgeConstructionContent['options'][number]

interface ConstructionRowBase {
  viewerKey: string
  layer: KnowledgeRenderLayer | null
  layerIndex?: number
  order: number | null
  groupStart: number
  groupLength: number
}

export type KnowledgeConstructionRow = ConstructionRowBase & (
  | { kind: 'layer' }
  | { kind: 'option', option: DisplayOption }
)

export type KnowledgePageTableRow = KnowledgeConstructionRow & {
  construction: KnowledgeConstructionContent
  constructionStart: number
  constructionLength: number
}

/** 同页共用表头，合并范围仍限定在各自构造内。 */
export function pageConstructionTableRows(constructions: KnowledgeConstructionContent[]): KnowledgePageTableRow[] {
  const rows: KnowledgePageTableRow[] = []
  constructions.forEach((construction, index) => {
    const constructionRows = constructionTableRows(construction)
    const constructionStart = rows.length
    rows.push(...constructionRows.map(row => ({
      ...row, construction, constructionStart, constructionLength: constructionRows.length,
      groupStart: constructionStart + row.groupStart,
      viewerKey: `construction-${index}-${row.viewerKey}`,
    })))
  })
  return rows
}

export function pageConstructionCellSpan(row: KnowledgePageTableRow, rowIndex: number, colKey: string): { rowspan?: number } {
  if (colKey === 'constructionCode' && rowIndex === row.constructionStart) return { rowspan: row.constructionLength }
  if (row.kind === 'option' && rowIndex === row.groupStart && ['name', 'lambda', 'alpha'].includes(colKey)) {
    return { rowspan: row.groupLength }
  }
  return {}
}

/** 只展开后端明确关联的材料档位；不能确定对应层时，档位单独列在同一张表中。 */
export function constructionTableRows(construction: KnowledgeConstructionContent): KnowledgeConstructionRow[] {
  const variableLayers = construction.layers.filter(layer => layer.variable)
  const indices = new Set(construction.options.flatMap(option => option.layerValues?.map(value => value.layerIndex) ?? []))
  const declaredIndex = indices.size === 1 ? [...indices][0] : undefined
  const declaredLayer = declaredIndex != null && construction.options.every(option => option.layerValues?.some(value => value.layerIndex === declaredIndex))
    ? construction.layers[declaredIndex]
    : undefined
  const variableLayer = declaredLayer ?? (variableLayers.length === 1 ? variableLayers[0] : undefined)
  const rows: KnowledgeConstructionRow[] = []
  const appendOptions = (layer: KnowledgeRenderLayer | null, order: number | null, layerIndex?: number): void => {
    const groupStart = rows.length
    construction.options.forEach((option, index) => rows.push({
      kind: 'option',
      option,
      layer,
      order,
      layerIndex,
      viewerKey: `option-${index}`, groupStart, groupLength: construction.options.length,
    }))
  }
  construction.layers.forEach((layer, index) => {
    const order = layer.order ?? index + 1
    if (layer === variableLayer && construction.options.length) {
      appendOptions(layer, order, index)
    } else {
      rows.push({ kind: 'layer', layer, order, layerIndex: index, viewerKey: `layer-${index}`, groupStart: rows.length, groupLength: 1 })
    }
  })
  if (construction.options.length && !variableLayer) appendOptions(null, null)
  return rows
}

/** 合并只用于编号、材料名称及公共 λ/α，热工档位数值始终独立成行。 */
export function constructionCellSpan(row: KnowledgeConstructionRow, rowIndex: number, colKey: string, rowCount: number): { rowspan?: number } {
  if (colKey === 'constructionCode' && rowIndex === 0) return { rowspan: rowCount }
  if (row.kind === 'option' && rowIndex === row.groupStart && ['name', 'lambda', 'alpha'].includes(colKey)) {
    return { rowspan: row.groupLength }
  }
  return {}
}

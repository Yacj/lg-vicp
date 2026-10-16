import type { KnowledgeRenderConstruction, ThermalRenderOption } from '@/api/reference-page'

type Layer = KnowledgeRenderConstruction['layers'][number]
export interface ThermalTableRow {
  key: string
  layer: Layer | null
  layerIndex?: number
  order: number | null
  option?: ThermalRenderOption
  optionIndex?: number
  groupStart: number
  groupLength: number
}

/** 只按 Backend 明确标记的可变层嵌入档位；缺少关联时另列，绝不猜材料或补数值。 */
export function thermalConstructionRows(construction: KnowledgeRenderConstruction): ThermalTableRow[] {
  const explicit = [...new Set(construction.options.flatMap(option => option.layerValues?.map(value => value.layerIndex) || []))]
  const variable = construction.layers.filter(layer => layer.variable)
  const declared = explicit.length === 1 && construction.options.every(option => option.layerValues?.filter(value => value.layerIndex === explicit[0]).length === 1)
  const variableLayer = declared && construction.layers[explicit[0]!]
    ? construction.layers[explicit[0]!]
    : !explicit.length && variable.length === 1 ? variable[0] : undefined
  const rows: ThermalTableRow[] = []
  const appendOptions = (layer: Layer | null, order: number | null) => {
    const groupStart = rows.length
    const layerIndex = layer ? construction.layers.indexOf(layer) : undefined
    construction.options.forEach((option, optionIndex) => rows.push({ key: `option-${optionIndex}`, layer, layerIndex, order, option, optionIndex, groupStart, groupLength: construction.options.length }))
  }
  construction.layers.forEach((layer, index) => {
    const order = layer.order ?? index + 1
    if (layer === variableLayer && construction.options.length)
      appendOptions(layer, order)
    else rows.push({ key: `layer-${index}`, layer, order, groupStart: rows.length, groupLength: 1 })
  })
  if (construction.options.length && !variableLayer)
    appendOptions(null, null)
  return rows
}

/** 层热阻和产品整体热阻互不补位；缺少同层证据时保留空值。 */
export function thermalLayerValue(row: ThermalTableRow, field: 'thicknessMm' | 'rValue') {
  if (!row.option)
    return row.layer?.[field]
  const evidence = row.option.layerValues?.filter(value => value.layerIndex === row.layerIndex)
  if (evidence?.length === 1)
    return evidence[0]?.[field]
  return field === 'thicknessMm' ? row.option.thicknessMm : null
}

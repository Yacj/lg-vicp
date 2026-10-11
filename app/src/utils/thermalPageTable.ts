import type { KnowledgeRenderConstruction, ThermalRenderOption } from '@/api/reference-page'

type Layer = KnowledgeRenderConstruction['layers'][number]
export interface ThermalTableRow {
  key: string
  layer: Layer | null
  order: number | null
  option?: ThermalRenderOption
  optionIndex?: number
  groupStart: number
  groupLength: number
}

/** 只按 Backend 明确标记的可变层嵌入档位；缺少关联时另列，绝不猜材料或补数值。 */
export function thermalConstructionRows(construction: KnowledgeRenderConstruction): ThermalTableRow[] {
  const variable = construction.layers.filter(layer => layer.variable)
  const variableLayer = variable.length === 1 ? variable[0] : undefined
  const rows: ThermalTableRow[] = []
  const appendOptions = (layer: Layer | null, order: number | null) => {
    const groupStart = rows.length
    construction.options.forEach((option, optionIndex) => rows.push({ key: `option-${optionIndex}`, layer, order, option, optionIndex, groupStart, groupLength: construction.options.length }))
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

import type { KnowledgeRenderConstruction, ThermalSourceColumn } from '@/api/reference-page'

type Field = ThermalSourceColumn['fieldKey']
const displayColumns = (construction: KnowledgeRenderConstruction) => construction.sourceDisplayColumns ?? construction.sourceColumns
export function sourceTableHeader(constructions: KnowledgeRenderConstruction[], key: 'identifier' | 'diagram' | 'layers'): string {
  const labels = constructions.map(item => item.sourceTableHeaders?.[key])
  return labels[0] && labels.every(label => label === labels[0]) ? labels[0] : { identifier: '编号', diagram: '构造简图', layers: '构造层' }[key]
}

export function constructionDiagramNotes(construction: KnowledgeRenderConstruction): string[] {
  return [...(construction.diagramNotes ?? []), ...construction.layers.filter(layer => layer.sourceRegion === 'DIAGRAM').map(layer => `${layer.sourceLayerLabel || layer.order || ''} ${layer.name}`.trim())]
}
const fallback: Record<Field, { label: string, unit: string }> = {
  thicknessMm: { label: '分层厚度', unit: 'mm' },
  lambda: { label: '导热系数', unit: 'W/(m·K)' },
  alpha: { label: '修正系数 α', unit: '' },
  rValue: { label: '热阻', unit: '(m²·K)/W' },
  productThermalResistance: { label: '档位热阻', unit: '(m²·K)/W' },
  totalThermalResistance: { label: '传热阻', unit: '(m²·K)/W' },
  kValue: { label: '传热系数', unit: 'W/(m²·K)' },
}

/** 只显示来源合同。缺失、重复或组间冲突不猜表头，也不按屋面类别纠正原稿。 */
export function thermalColumnHeader(constructions: KnowledgeRenderConstruction[], field: Field) {
  const columns = constructions.map((construction) => {
    const own = displayColumns(construction)?.filter(column => column.fieldKey === field)
    return own?.length === 1 ? own[0] : undefined
  })
  const first = columns[0]
  if (!first || columns.some(column => !column || column.label !== first.label || column.symbol !== first.symbol || column.unit !== first.unit || column.scope !== first.scope))
    return fallback[field]
  const label = first.symbol && !first.label.includes(first.symbol) ? `${first.label} ${first.symbol}` : first.label
  return { label, unit: first.unit || '' }
}

export function thermalGroupHeader(constructions: KnowledgeRenderConstruction[]): string {
  const names = constructions.map((construction) => {
    const columns = displayColumns(construction)?.filter(column => column.fieldKey === 'totalThermalResistance')
    const k = displayColumns(construction)?.filter(column => column.fieldKey === 'kValue')
    return columns?.length === 1 && k?.length === 1 && columns[0]?.groupLabel === k[0]?.groupLabel ? columns[0]?.groupLabel : undefined
  })
  return names[0] && names.every(name => name === names[0]) ? names[0] : ''
}

/** 只在每个构造都明确采用原表单列布局、且热阻列头一致时合列。 */
export function hasSharedSourceResistance(constructions: KnowledgeRenderConstruction[]): boolean {
  return constructions.length > 0 && constructions.every(item => item.sourceTableLayout?.resistance === 'SHARED_LAYER_OPTION')
    && constructions.every((item) => {
      const own = displayColumns(item)?.filter(column => column.fieldKey === 'rValue')
      const first = constructions[0] && displayColumns(constructions[0])?.find(column => column.fieldKey === 'rValue')
      return own?.length === 1 && own[0]?.label === first?.label && own[0]?.unit === first?.unit
    })
}

export function sourceHeaderNotice(constructions: KnowledgeRenderConstruction[]): string {
  const fields: Field[] = ['thicknessMm', 'lambda', 'alpha', 'rValue', 'totalThermalResistance', 'kValue']
  const complete = fields.every(field => constructions.every((item) => {
    const columns = displayColumns(item)?.filter(column => column.fieldKey === field)
    const first = constructions[0] && displayColumns(constructions[0])?.find(column => column.fieldKey === field)
    return columns?.length === 1 && columns[0]?.label === first?.label && columns[0]?.symbol === first?.symbol && columns[0]?.unit === first?.unit && columns[0]?.scope === first?.scope
  }))
  return constructions.length && (!complete || !thermalGroupHeader(constructions)) ? '部分表头尚未与原页核对，当前按字段名称展示，请结合原始页面查看。' : ''
}

export function constructionLabel(construction: KnowledgeRenderConstruction): string {
  return construction.rawConstructionLabel?.trim() || construction.constructionCode?.trim() || construction.title?.trim() || construction.systemName?.trim() || '未标注构造'
}

export function constructionAttributes(construction: KnowledgeRenderConstruction): string[] {
  return [construction.specClass ? `${construction.specClass} 型 VICP` : null, construction.applicationPart === 'EXTERNAL_WALL' ? '外墙' : construction.applicationPart === 'ROOF' ? '屋面' : null, construction.roofForm === 'SLOPED' ? '坡屋面' : construction.roofForm === 'FLAT' ? '平屋面' : null, construction.placement === 'UPRIGHT' ? '正置' : construction.placement === 'INVERTED' ? '倒置' : null, construction.waterproofGrade ? `防水等级：${construction.waterproofGrade}` : construction.applicationPart === 'ROOF' ? '防水等级待核对' : null, construction.baseMaterial ? `${construction.baseMaterial}${construction.baseThicknessMm != null ? ` ${construction.baseThicknessMm}mm` : '（厚度待核）'}` : null].filter((value): value is string => !!value)
}

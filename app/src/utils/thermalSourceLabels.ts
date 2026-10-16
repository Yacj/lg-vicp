import type { KnowledgeRenderConstruction, ThermalSourceColumn } from '@/api/reference-page'

type Field = ThermalSourceColumn['fieldKey']
const fallback: Record<Field, { label: string, unit: string }> = {
  thicknessMm: { label: '分层厚度', unit: 'mm' },
  lambda: { label: '导热系数 λ', unit: 'W/(m·K)' },
  alpha: { label: '修正系数 α', unit: '' },
  rValue: { label: '材料层热阻', unit: '(m²·K)/W' },
  productThermalResistance: { label: '产品整体热阻（源文待核）', unit: '(m²·K)/W' },
  totalThermalResistance: { label: '整构造传热阻（源文符号待核）', unit: '(m²·K)/W' },
  kValue: { label: '传热系数（源文符号待核）', unit: 'W/(m²·K)' },
}

/** 只显示来源合同。缺失、重复或组间冲突不猜表头，也不按屋面类别纠正原稿。 */
export function thermalColumnHeader(constructions: KnowledgeRenderConstruction[], field: Field) {
  const columns = constructions.map((construction) => {
    const own = construction.sourceColumns?.filter(column => column.fieldKey === field)
    return own?.length === 1 ? own[0] : undefined
  })
  const first = columns[0]
  if (!first || columns.some(column => !column || column.label !== first.label || column.symbol !== first.symbol || column.unit !== first.unit || column.scope !== first.scope))
    return fallback[field]
  const label = first.symbol && !first.label.includes(first.symbol) ? `${first.label} ${first.symbol}` : first.label
  return { label: first.scope === 'UNKNOWN' ? `${label}（语义待核）` : label, unit: first.unit || '' }
}

export function thermalGroupHeader(constructions: KnowledgeRenderConstruction[]): string {
  const names = constructions.map((construction) => {
    const columns = construction.sourceColumns?.filter(column => column.fieldKey === 'totalThermalResistance')
    return columns?.length === 1 ? columns[0]?.groupLabel : undefined
  })
  return names[0] && names.every(name => name === names[0]) ? names[0] : '整构造参数（源文组名待核）'
}

export function constructionLabel(construction: KnowledgeRenderConstruction): string {
  return construction.rawConstructionLabel?.trim() || construction.constructionCode?.trim() || construction.title?.trim() || construction.systemName?.trim() || '未标注构造'
}

export function constructionAttributes(construction: KnowledgeRenderConstruction): string[] {
  return [construction.specClass ? `${construction.specClass} 型 VICP` : null, construction.applicationPart === 'EXTERNAL_WALL' ? '外墙' : construction.applicationPart === 'ROOF' ? '屋面' : null, construction.roofForm === 'SLOPED' ? '坡屋面' : construction.roofForm === 'FLAT' ? '平屋面' : null, construction.placement === 'UPRIGHT' ? '正置' : construction.placement === 'INVERTED' ? '倒置' : null, construction.waterproofGrade ? `防水等级：${construction.waterproofGrade}` : construction.applicationPart === 'ROOF' ? '防水等级待核对' : null, construction.baseMaterial ? `${construction.baseMaterial}${construction.baseThicknessMm != null ? ` ${construction.baseThicknessMm}mm` : '（厚度待核）'}` : null].filter((value): value is string => !!value)
}

import type { PageRecognitionSourceColumn } from '@/types/knowledge'
import type { KnowledgeConstructionContent } from '@/types/knowledge-page-render'

type Field = PageRecognitionSourceColumn['fieldKey']
export function sourceTableHeader(constructions: KnowledgeConstructionContent[], key: 'identifier' | 'diagram' | 'layers'): string {
  const labels = constructions.map(item => item.sourceTableHeaders?.[key])
  return labels[0] && labels.every(label => label === labels[0]) ? labels[0] : { identifier: '编号', diagram: '构造简图', layers: '构造层' }[key]
}

export function constructionDiagramNotes(construction: KnowledgeConstructionContent): string[] {
  return [...(construction.diagramNotes ?? []), ...construction.layers.filter(layer => layer.sourceRegion === 'DIAGRAM').map(layer => `${layer.sourceLayerLabel || layer.order || ''} ${layer.name}`.trim())]
}
const fallback: Record<Field, { label: string, unit: string }> = {
  thicknessMm: { label: '分层厚度', unit: 'mm' },
  lambda: { label: '导热系数', unit: 'W/(m·K)' },
  alpha: { label: '修正系数', unit: '' },
  rValue: { label: '材料层热阻', unit: '(m²·K)/W' },
  productThermalResistance: { label: '产品整体热阻（源文待核）', unit: '(m²·K)/W' },
  totalThermalResistance: { label: '整构造传热阻（源文符号待核）', unit: '(m²·K)/W' },
  kValue: { label: '传热系数（源文符号待核）', unit: 'W/(m²·K)' },
}

/** 仅呈现后端来源字段；缺失或各组不一致则用保守工程标签，不按部位改表头。 */
export function thermalColumnHeader(constructions: KnowledgeConstructionContent[], field: Field) {
  const columns = constructions.map((item) => {
    const own = item.sourceColumns?.filter(column => column.fieldKey === field)
    return own?.length === 1 ? own[0] : undefined
  })
  const first = columns[0]
  if (!first || columns.some(item => !item || item.label !== first.label || item.symbol !== first.symbol || item.unit !== first.unit || item.scope !== first.scope)) {
    return fallback[field]
  }
  const label = first.symbol && !first.label.includes(first.symbol) ? `${first.label} ${first.symbol}` : first.label
  return { label: first.scope === 'UNKNOWN' ? `${label}（语义待核）` : label, unit: first.unit || '' }
}

export function thermalGroupHeader(constructions: KnowledgeConstructionContent[]): string {
  const names = constructions.map(item => item.sourceColumns?.find(column => column.fieldKey === 'totalThermalResistance')?.groupLabel)
  return names[0] && names.every(name => name === names[0]) ? names[0] : '整构造参数（源文组名待核）'
}

export function constructionLabel(construction: KnowledgeConstructionContent): string {
  return construction.rawConstructionLabel || construction.constructionCode || construction.title || construction.systemName || '未标注构造'
}

export function constructionAttributes(construction: KnowledgeConstructionContent): string[] {
  return [construction.specClass ? `${construction.specClass} 型 VICP` : null, construction.applicationPart === 'EXTERNAL_WALL' ? '外墙' : construction.applicationPart === 'ROOF' ? '屋面' : null, construction.roofForm === 'SLOPED' ? '坡屋面' : construction.roofForm === 'FLAT' ? '平屋面' : null, construction.placement === 'UPRIGHT' ? '正置' : construction.placement === 'INVERTED' ? '倒置' : null, construction.waterproofGrade || (construction.applicationPart === 'ROOF' ? '防水等级待核对' : null), construction.baseMaterial ? `${construction.baseMaterial}${construction.baseThicknessMm != null ? ` ${construction.baseThicknessMm}mm` : '（厚度待核）'}` : null].filter((item): item is string => !!item)
}

/** Backend 页面模型；C 端只做显示投影，不解析回答或补算参数。 */
export type RenderNumber = number | string | null
export type ThermalFieldKey = 'thicknessMm' | 'productThermalResistance' | 'totalThermalResistance' | 'kValue'
export interface ThermalSourceColumn {
  fieldKey: ThermalFieldKey | 'lambda' | 'alpha' | 'rValue'
  label: string
  groupLabel?: string | null
  symbol?: string | null
  unit?: string | null
  scope: 'LAYER' | 'PRODUCT' | 'CONSTRUCTION' | 'UNKNOWN'
}
export interface ThermalRenderOption {
  sourceRowLabel?: string | null
  fieldEvidence?: Partial<Record<ThermalFieldKey, string | null>> | null
  layerValues?: Array<{ layerIndex: number, thicknessMm?: number | null, rValue?: number | null, thicknessText?: string | null, rValueText?: string | null }>
  optionId: string
  thicknessMm?: RenderNumber
  productThermalResistance?: RenderNumber
  totalThermalResistance?: RenderNumber
  kValue?: RenderNumber
  warnings?: string[]
}
export interface KnowledgeRenderConstruction {
  sourceTableHeaders?: { identifier?: string, diagram?: string, layers?: string }
  diagramNotes?: string[]
  rawConstructionLabel?: string | null
  applicationPart?: 'EXTERNAL_WALL' | 'ROOF' | null
  roofForm?: 'SLOPED' | 'FLAT' | null
  placement?: 'UPRIGHT' | 'INVERTED' | null
  waterproofGrade?: string | null
  sourceColumns?: ThermalSourceColumn[]
  constructionId: string
  constructionCode?: string | null
  title?: string | null
  systemName?: string | null
  specClass?: string | null
  baseMaterial?: string | null
  baseThicknessMm?: RenderNumber
  layers: Array<{ sourceRegion?: 'THERMAL_TABLE' | 'DIAGRAM' | 'UNKNOWN', sourceLayerLabel?: string | null, sourceGroupLabel?: string | null, layerId?: string, order?: number | null, name: string, thicknessMm?: RenderNumber, lambda?: RenderNumber, alpha?: RenderNumber, rValue?: RenderNumber, variable?: boolean }>
  material?: { name: string, lambda?: RenderNumber, alpha?: RenderNumber } | null
  options: ThermalRenderOption[]
  notes?: string[]
  warnings?: string[]
}
export interface KnowledgePageRenderModel {
  schemaVersion?: 2
  confirmedRevision?: string
  pageTitle?: string | null
  pageLabel?: string | null
  constructions: KnowledgeRenderConstruction[]
  paragraphs?: string[]
  notes?: string[]
  warnings?: string[]
}
export interface ReferenceHighlight {
  confirmedRevision?: string
  pageId?: string | null
  constructionId?: string | null
  optionId?: string | null
  fieldKeys?: string[]
  /** Backend 给出的可见回答字符位置，只用于段落关联。 */
  answerOffset?: number
}
export interface ReferencePageSummary {
  systemType?: string
  constructionCode?: string
  productName?: string
  thicknessMm?: RenderNumber
  productThermalResistance?: RenderNumber
  totalThermalResistance?: RenderNumber
  kValue?: RenderNumber
}
export interface ReferencePageMatch extends ReferenceHighlight {
  candidateId?: string
  summary?: ReferencePageSummary
}
export interface AiReferencePage {
  type: 'REFERENCE_PAGE'
  answerStyle?: 'THERMAL_SOLUTIONS'
  primaryFieldKeys?: ThermalFieldKey[]
  page: { documentId: string, pageId: string, documentTitle: string, versionId?: string, pageLabelSource?: string | null, pageLabelVerified?: boolean | null, pageLabel?: string | null, imageUrl: string, docNumber?: string | null }
  renderModel?: KnowledgePageRenderModel | null
  summary?: ReferencePageSummary
  matches: ReferencePageMatch[]
}

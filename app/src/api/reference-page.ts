/** Backend 页面模型；C 端只做显示投影，不解析回答或补算参数。 */
export type RenderNumber = number | string | null
export type ThermalFieldKey = 'thicknessMm' | 'productThermalResistance' | 'totalThermalResistance' | 'kValue'
export interface ThermalRenderOption {
  optionId: string
  thicknessMm?: RenderNumber
  productThermalResistance?: RenderNumber
  totalThermalResistance?: RenderNumber
  kValue?: RenderNumber
  warnings?: string[]
}
export interface KnowledgeRenderConstruction {
  constructionId: string
  constructionCode?: string | null
  title?: string | null
  systemName?: string | null
  specClass?: string | null
  baseMaterial?: string | null
  baseThicknessMm?: RenderNumber
  layers: Array<{ layerId?: string, order?: number | null, name: string, thicknessMm?: RenderNumber, lambda?: RenderNumber, alpha?: RenderNumber, rValue?: RenderNumber, variable?: boolean }>
  material?: { name: string, lambda?: RenderNumber, alpha?: RenderNumber } | null
  options: ThermalRenderOption[]
  notes?: string[]
  warnings?: string[]
}
export interface KnowledgePageRenderModel {
  pageTitle?: string | null
  pageLabel?: string | null
  constructions: KnowledgeRenderConstruction[]
  paragraphs?: string[]
  notes?: string[]
  warnings?: string[]
}
export interface ReferenceHighlight {
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
  page: { documentId: string, pageId: string, documentTitle: string, pageLabel?: string | null, imageUrl: string, docNumber?: string | null }
  renderModel?: KnowledgePageRenderModel | null
  summary?: ReferencePageSummary
  matches: ReferencePageMatch[]
}

import type { PageRecognitionLayerValue, PageRecognitionOption, PageRecognitionResult, PageRecognitionSystem } from './knowledge'

/** 页面展示契约：由 Backend 提供，不从全文或识别草稿重建。 */
export type ThermalFieldKey = 'thicknessMm' | 'productThermalResistance' | 'totalThermalResistance' | 'kValue'
export type RenderNumber = number | string | null

export interface ThermalRenderOption extends Pick<PageRecognitionOption, 'sourceRowLabel' | 'fieldEvidence'> {
  layerValues?: PageRecognitionLayerValue[]
  optionId: string
  thicknessMm?: RenderNumber
  productThermalResistance?: RenderNumber
  totalThermalResistance?: RenderNumber
  kValue?: RenderNumber
  warnings?: string[]
}

export interface KnowledgeRenderLayer {
  sourceRegion?: 'THERMAL_TABLE' | 'DIAGRAM' | 'UNKNOWN'
  sourceLayerLabel?: string | null
  sourceGroupLabel?: string | null
  layerId?: string
  order?: number | null
  name: string
  thicknessMm?: RenderNumber
  lambda?: RenderNumber
  alpha?: RenderNumber
  rValue?: RenderNumber
  /** 多档位层不在公共层列表重复展示单一厚度/R。 */
  variable?: boolean
}

export interface KnowledgeRenderConstruction extends Pick<PageRecognitionSystem, 'rawConstructionLabel' | 'applicationPart' | 'roofForm' | 'placement' | 'waterproofGrade' | 'sourceColumns' | 'sourceTableHeaders' | 'diagramNotes' | 'specClass' | 'baseMaterial' | 'baseThicknessMm'> {
  constructionId: string
  constructionCode?: string | null
  title?: string | null
  systemName?: string | null
  layers: KnowledgeRenderLayer[]
  material?: { name: string, lambda?: RenderNumber, alpha?: RenderNumber } | null
  options: ThermalRenderOption[]
  notes?: string[]
  warnings?: string[]
}

/** 旧识别数据只做显示投影；缺少后端标识时不生成命中标识。 */
export type KnowledgeConstructionContent = Omit<KnowledgeRenderConstruction, 'constructionId' | 'options'> & {
  constructionId?: string
  options: Array<Omit<ThermalRenderOption, 'optionId'> & { optionId?: string }>
}

export interface KnowledgePageRenderModel {
  confirmedRevision?: string
  schemaVersion?: 2
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
}

export interface KnowledgePagePresentation {
  renderModel?: KnowledgePageRenderModel | null
  confirmedStructuredData?: PageRecognitionResult | null
  referenceHighlight?: ReferenceHighlight | null
  matches?: ReferenceHighlight[]
}

/**
 * 页面识别草稿（前端编辑态）。
 *
 * AI 结果仅作候选，人工确认后才写入正式热工行与页面分块；
 * 草稿结构与后端 PageRecognitionResult 对齐，提交前原样序列化。
 */

export interface RecognitionDraftOption {
  thicknessMm?: number
  /** 产品层热阻。 */
  productThermalResistance?: number
  /** 外墙主断面总热阻（正式字段）。 */
  totalThermalResistance?: number
  kValue?: number
  /** 管理员人工选择的正式产品规格；确认时提交给后端做正式映射。 */
  productSpecId?: string | null
  /** 可选的产品目录约束；人工映射时随规格一并提交。 */
  catalogProductId?: string | null
}

export interface RecognitionDraftLayer {
  order?: number
  name: string
  thicknessMm?: number
  lambda?: number
  alpha?: number
  rValue?: number
}

export interface RecognitionDraftSystem {
  systemName?: string
  specClass?: 'I' | 'II' | 'III'
  constructionCode?: string
  baseMaterial?: string
  baseThicknessMm?: number
  layers: RecognitionDraftLayer[]
  options: RecognitionDraftOption[]
  /** 管理员人工选择的正式构造方案；确认时提交给后端做正式映射。 */
  schemeId?: string | null
}

export interface RecognitionDraft {
  pageLabel?: string
  pageTitle?: string
  fullText: string
  systems: RecognitionDraftSystem[]
  notes?: string[]
  warnings?: string[]
}

export const SPEC_CLASS_OPTIONS: ReadonlyArray<{ label: string, value: 'I' | 'II' | 'III' }> = [
  { label: 'I 型', value: 'I' },
  { label: 'II 型', value: 'II' },
  { label: 'III 型', value: 'III' },
]

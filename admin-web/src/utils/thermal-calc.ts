import type { ThermalCalcMode, ThermalCalcRecord } from '@/types/thermal'

/**
 * 计算模式展示文案（单一事实源）。
 * 与后端 enum REFERENCE_TABLE / EQUIVALENT / LAYERED 一一对应；
 * EQUIVALENT 后端语义为「整体当量法」，不得在别处另起「当量导热 / 等效热阻」等别名。
 */
export const THERMAL_CALC_MODE_OPTIONS: Array<{ label: string, value: ThermalCalcMode }> = [
  { label: '参考构造', value: 'REFERENCE_TABLE' },
  { label: '等效热阻计算', value: 'EQUIVALENT' },
  { label: '分层构造计算', value: 'LAYERED' },
]

export function thermalCalcModeLabel(mode: ThermalCalcMode): string {
  return THERMAL_CALC_MODE_OPTIONS.find(item => item.value === mode)?.label ?? mode
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** 从后端快照读取结论，不在前端重算。 */
export function thermalCalcConclusion(record: ThermalCalcRecord): string {
  const result = asRecord(record.result)
  const kValue = asNumber(result.kValue) ?? asNumber(result.resultK)
  const compliant = typeof result.compliant === 'boolean' ? result.compliant : null
  const parts: string[] = []
  if (kValue != null) {
    parts.push(`传热系数 K = ${kValue} W/(m²·K)`)
  }
  if (compliant === true) {
    parts.push('满足限值要求')
  }
  else if (compliant === false) {
    parts.push('不满足限值要求')
  }
  return parts.length > 0 ? parts.join('；') : '已返回计算快照，请核对方公式与步骤。'
}

export function thermalCalcStepLines(record: ThermalCalcRecord): Array<{ label: string, formula: string, value: string }> {
  return (Array.isArray(record.steps) ? record.steps : []).flatMap((step) => {
    const item = asRecord(step)
    const label = typeof item.label === 'string' ? item.label : (typeof item.key === 'string' ? item.key : '步骤')
    const formula = typeof item.formula === 'string' ? item.formula : ''
    const value = item.value == null ? '' : String(item.value)
    return [{ label, formula, value }]
  })
}

export function thermalCalcFormulaLines(record: ThermalCalcRecord): Array<{ key: string, value: string }> {
  return Object.entries(record.formulas ?? {}).map(([key, value]) => ({
    key,
    value: value == null ? '—' : String(value),
  }))
}

/**
 * 图集查表命中行（后端 REFERENCE_TABLE 快照 result.candidates[]）。
 * 后端已按参考集 priority 排序，前端不重排、不插值。
 */
export interface ThermalCalcReferenceCandidate {
  setId: string | null
  setCode: string | null
  setVersion: number | null
  thicknessMm: number | null
  /** 产品层热阻 R（快照无独立舍入字段，直接取原值） */
  productThermalResistance: number | null
  /** 总热阻 R₀（优先取舍入值） */
  totalThermalResistance: number | null
  /** 传热系数 K（优先取舍入值） */
  kValue: number | null
  compliant: boolean | null
  evidenceSource: string | null
  evidenceRef: string | null
  evidenceLevel: string | null
}

export function thermalCalcReferenceCandidates(record: ThermalCalcRecord): ThermalCalcReferenceCandidate[] {
  const result = asRecord(record.result)
  return (Array.isArray(result.candidates) ? result.candidates : []).map(asRecord).map(item => ({
    setId: asText(item.setId),
    setCode: asText(item.setCode),
    setVersion: asNumber(item.setVersion),
    thicknessMm: asNumber(item.thicknessMm),
    productThermalResistance: asNumber(item.productThermalResistance),
    totalThermalResistance: asNumber(item.totalThermalResistanceRounded) ?? asNumber(item.totalThermalResistance),
    kValue: asNumber(item.kValueRounded) ?? asNumber(item.kValue),
    compliant: typeof item.compliant === 'boolean' ? item.compliant : null,
    evidenceSource: asText(item.evidenceSource),
    evidenceRef: asText(item.evidenceRef),
    evidenceLevel: asText(item.evidenceLevel),
  }))
}

export interface ThermalCalcResultSummary {
  productResistance: number | null
  totalResistance: number | null
  kValue: number | null
  limitKValue: number | null
  compliant: boolean | null
  /** 产品层总厚度（mm）：产品层不止一层时是各产品子层厚度之和，不等于保温层厚度 */
  thicknessMm: number | null
  interiorSurfaceResistance: number | null
  exteriorSurfaceResistance: number | null
  ruleCode: string | null
  ruleName: string | null
  ruleUsage: string | null
  standardName: string | null
  standardClause: string | null
  /** 图集查表命中参考行数；非查表模式为 0 */
  candidateCount: number
  /** 构造层快照里的产品层行数：>1 表示产品由多个子层组成，厚度不能按单层理解 */
  productLayerCount: number
}

/**
 * 从后端计算快照读取业务结果，不在前端重算。
 * 结果主视图展示双 R（产品层热阻 R / 总热阻 R₀）/ 传热系数 K / 限值 / 是否满足 / 使用规则，
 * raw JSON 仅作技术详情。
 * REFERENCE_TABLE 快照没有顶层数值，结果只存在于 result.candidates[]（取排序后的首条为主视图）。
 */
export function thermalCalcResultSummary(record: ThermalCalcRecord): ThermalCalcResultSummary {
  const result = asRecord(record.result)
  const rule = asRecord(record.rule)
  const standard = asRecord(record.standard)
  const input = asRecord(record.input)
  const compliant = typeof result.compliant === 'boolean' ? result.compliant : null
  const candidates = thermalCalcReferenceCandidates(record)
  const productLayerCount = (Array.isArray(record.layers) ? record.layers : [])
    .map(asRecord).filter(layer => asText(layer.layerType) === 'PRODUCT_LAYER').length
  const primary = candidates[0] ?? null
  return {
    productResistance: asNumber(result.productResistanceRounded)
      ?? asNumber(result.productResistance)
      ?? primary?.productThermalResistance
      ?? null,
    totalResistance: asNumber(result.totalResistanceRounded)
      ?? asNumber(result.totalResistance)
      ?? primary?.totalThermalResistance
      ?? null,
    kValue: asNumber(result.kValueRounded) ?? asNumber(result.kValue) ?? primary?.kValue ?? null,
    limitKValue: asNumber(result.limitKValue) ?? asNumber(standard.limitKValue),
    compliant: compliant ?? primary?.compliant ?? null,
    thicknessMm: asNumber(input.thicknessMm) ?? primary?.thicknessMm ?? null,
    interiorSurfaceResistance: asNumber(rule.interiorSurfaceResistance),
    exteriorSurfaceResistance: asNumber(rule.exteriorSurfaceResistance),
    ruleCode: asText(rule.code),
    ruleName: asText(rule.name),
    ruleUsage: asText(rule.usage),
    standardName: asText(standard.basisName) ?? asText(standard.regionName),
    standardClause: asText(standard.clauseRef),
    candidateCount: candidates.length,
    productLayerCount,
  }
}

/**
 * 厚度标签：产品层不止一层时必须说「产品总厚度」，
 * 否则「保温层厚度」会被理解成单层板厚（甲方 Excel 分层例是 10+15+10=35mm）。
 */
export function thermalCalcThicknessLabel(summary: ThermalCalcResultSummary): string {
  return summary.productLayerCount > 1 ? `产品总厚度（${summary.productLayerCount} 个子层）` : '产品厚度'
}

/** 结果依据与来源回溯（图集证据优先，其次计算规则/标准限值快照）。 */
export interface ThermalCalcEvidence {
  /** 依据来源（图集证据来源 / 标准名称 / 规则证据来源） */
  source: string | null
  /** 依据编号（图集证据编号 / 标准条文 / 规则证据编号） */
  ref: string | null
  /** 证据等级（A/B/C/D） */
  level: string | null
  ruleCode: string | null
  ruleVersion: number | null
  limitVersion: number | null
  /** 图集查表命中参考行数 */
  candidateCount: number
}

export function thermalCalcEvidence(record: ThermalCalcRecord): ThermalCalcEvidence {
  const rule = asRecord(record.rule)
  const standard = asRecord(record.standard)
  const candidates = thermalCalcReferenceCandidates(record)
  const primary = candidates[0] ?? null
  return {
    source: primary?.evidenceSource ?? asText(standard.basisName) ?? asText(rule.evidenceSource),
    ref: primary?.evidenceRef ?? asText(standard.clauseRef) ?? asText(rule.evidenceRef),
    level: primary?.evidenceLevel ?? asText(standard.evidenceLevel) ?? asText(rule.evidenceLevel),
    ruleCode: asText(rule.code),
    ruleVersion: asNumber(rule.version) ?? record.ruleVersion,
    limitVersion: asNumber(standard.version) ?? record.limitVersion,
    candidateCount: candidates.length,
  }
}

/** 依据展示文本（如「DB11/891 · 3.3.1」），无依据时返回 null。 */
export function thermalCalcEvidenceLabel(evidence: ThermalCalcEvidence): string | null {
  const parts = [evidence.source, evidence.ref].filter((item): item is string => Boolean(item))
  return parts.length > 0 ? parts.join(' · ') : null
}

export interface ThermalCalcLayerRow {
  order: number
  name: string
  /** 构造层类型：PRODUCT_LAYER / BASE_LAYER / FIXING_LAYER / VARIABLE_LAYER（快照缺省为 null） */
  layerType: string | null
  /** 层类型中文名（快照缺类型时为空，不猜） */
  layerTypeLabel: string
  thicknessMm: number | null
  lambda: number | null
  correctionFactor: number | null
  rValue: number | null
}

/** 构造层类型中文名（与后端 layerType 枚举一一对应）。 */
export const THERMAL_LAYER_TYPE_LABELS: Record<string, string> = {
  PRODUCT_LAYER: '产品层',
  BASE_LAYER: '基层',
  FIXING_LAYER: '固定层',
  VARIABLE_LAYER: '可变层',
}

/**
 * 构造层表格行：材料 / 厚度 / λ / 修正系数 α / 热阻 R。
 * 数值全部来自冻结快照（layers + steps），仅把 m 换算为 mm，不重算 R。
 *
 * R 必须按步骤 key 里的层序取（`layer_N` / `product_N`），不能按数组下标猜：
 * - EQUIVALENT（整体当量法）下产品层步骤 key 是 `product_N`，不在 `layer_*` 里；
 * - `includeNonProductLayers=false` 时非产品层根本不产生步骤。
 * 这两种情况步骤数都少于层数，按下标兜底会把别的层的 R 贴到这一层（层表 R 错位）。
 * 没有对应步骤时如实留空，不得用相邻层的数值顶替。
 */
export function thermalCalcLayerRows(record: ThermalCalcRecord): ThermalCalcLayerRow[] {
  const rawLayers = (Array.isArray(record.layers) ? record.layers : []).map(asRecord)
  const steps = (Array.isArray(record.steps) ? record.steps : []).map(asRecord)
  const rByOrder = new Map<number, number | null>()
  for (const step of steps) {
    const matched = typeof step.key === 'string' ? /^(?:layer|product)_(\d+)$/.exec(step.key) : null
    if (!matched) {
      continue
    }
    rByOrder.set(Number(matched[1]), asNumber(step.rounded) ?? asNumber(step.value))
  }
  return rawLayers.map((layer, index) => {
    const order = asNumber(layer.layerOrder) ?? index + 1
    const thicknessM = asNumber(layer.thicknessM)
    const layerType = asText(layer.layerType)
    return {
      order,
      name: asText(layer.layerName) ?? '未命名构造层',
      layerType,
      layerTypeLabel: layerType ? THERMAL_LAYER_TYPE_LABELS[layerType] ?? layerType : '',
      thicknessMm: thicknessM != null ? Math.round(thicknessM * 1000 * 100) / 100 : asNumber(layer.thicknessMm),
      lambda: asNumber(layer.lambda),
      correctionFactor: asNumber(layer.correctionFactor),
      rValue: rByOrder.get(order) ?? null,
    }
  }).sort((a, b) => a.order - b.order)
}

/** 结果来源类型：图集查表为「图集参考值」，其余为「系统计算结果」。 */
export function thermalCalcSourceLabel(mode: ThermalCalcMode): string {
  return mode === 'REFERENCE_TABLE' ? '图集参考值' : '系统计算结果'
}

export function thermalCalcComplianceLabel(compliant: boolean | null): string {
  if (compliant === true) {
    return '满足要求'
  }
  if (compliant === false) {
    return '不满足要求'
  }
  return '未判定（缺少地区限值）'
}

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
  }
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
  thicknessMm: number | null
  lambda: number | null
  correctionFactor: number | null
  rValue: number | null
}

/**
 * 构造层表格行：材料 / 厚度 / λ / 修正系数 α / 热阻 R。
 * 数值全部来自冻结快照（layers + steps），仅把 m 换算为 mm，不重算 R。
 */
export function thermalCalcLayerRows(record: ThermalCalcRecord): ThermalCalcLayerRow[] {
  const rawLayers = (Array.isArray(record.layers) ? record.layers : []).map(asRecord)
  const steps = (Array.isArray(record.steps) ? record.steps : []).map(asRecord)
  const layerStepValues = steps
    .filter(step => typeof step.key === 'string' && step.key.startsWith('layer_'))
    .sort((a, b) => Number(String(a.key).replace('layer_', '')) - Number(String(b.key).replace('layer_', '')))
    .map(step => asNumber(step.rounded) ?? asNumber(step.value))
  const byOrder = new Map<number, number | null>()
  layerStepValues.forEach((value, index) => byOrder.set(index + 1, value))
  return rawLayers.map((layer, index) => {
    const order = asNumber(layer.layerOrder) ?? index + 1
    const thicknessM = asNumber(layer.thicknessM)
    return {
      order,
      name: asText(layer.layerName) ?? '未命名构造层',
      thicknessMm: thicknessM != null ? Math.round(thicknessM * 1000 * 100) / 100 : asNumber(layer.thicknessMm),
      lambda: asNumber(layer.lambda),
      correctionFactor: asNumber(layer.correctionFactor),
      rValue: byOrder.get(order) ?? layerStepValues[index] ?? null,
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

import type { ThermalCalcMode, ThermalCalcRecord } from '@/types/thermal'

export const THERMAL_CALC_MODE_OPTIONS: Array<{ label: string, value: ThermalCalcMode }> = [
  { label: '图集查表', value: 'REFERENCE_TABLE' },
  { label: '当量导热', value: 'EQUIVALENT' },
  { label: '分层计算', value: 'LAYERED' },
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

export interface ThermalCalcResultSummary {
  productResistance: number | null
  totalResistance: number | null
  kValue: number | null
  limitKValue: number | null
  compliant: boolean | null
  ruleName: string | null
  ruleUsage: string | null
  standardName: string | null
  standardClause: string | null
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/**
 * 从后端计算快照读取业务结果，不在前端重算。
 * 结果主视图展示总热阻 / 传热系数 / 限值 / 是否满足 / 使用规则，raw JSON 仅作技术详情。
 */
export function thermalCalcResultSummary(record: ThermalCalcRecord): ThermalCalcResultSummary {
  const result = asRecord(record.result)
  const rule = asRecord(record.rule)
  const standard = asRecord(record.standard)
  const compliant = typeof result.compliant === 'boolean' ? result.compliant : null
  return {
    productResistance: asNumber(result.productResistanceRounded) ?? asNumber(result.productResistance),
    totalResistance: asNumber(result.totalResistanceRounded) ?? asNumber(result.totalResistance),
    kValue: asNumber(result.kValueRounded) ?? asNumber(result.kValue),
    limitKValue: asNumber(result.limitKValue),
    compliant,
    ruleName: asText(rule.name),
    ruleUsage: asText(rule.usage),
    standardName: asText(standard.basisName) ?? asText(standard.regionName),
    standardClause: asText(standard.clauseRef),
  }
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

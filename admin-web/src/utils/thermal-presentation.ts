import type { ThermalCalcMode, ThermalCalcRecord } from '@/types/thermal'

/**
 * 热工计算「用户展示视图」纯投影：
 * - 数值全部来自 thermal_calc_records 冻结快照（steps/layers/result/standard 列），
 *   只做展示单位换算（m → mm），不重新计算 K、不读取实时后台参数；
 * - 内部 ID 与调试字段不进入用户视图。
 */

export interface ThermalCalcStepView {
  key: string
  label: string
  formula: string | null
  value: number | null
  unit: string | null
}

export interface ThermalCalcLayerView {
  order: number
  name: string
  type: string | null
  thicknessMm: number | null
  lambda: number | null
  correctionFactor: number | null
}

export interface ThermalCalcPresentation {
  mode: ThermalCalcMode
  resultK: number | null
  targetK: number | null
  compliant: boolean | null
  totalResistance: number | null
  /** 标准依据描述（如「GB 50189 第 3.3.1 条」），无限值快照时为 null */
  standardLabel: string | null
  steps: ThermalCalcStepView[]
  layers: ThermalCalcLayerView[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** 展示单位按确定性 key 映射（与后端 thermal-calc-presentation 同口径，不猜测数值） */
function stepUnit(key: string): string | null {
  if (key === 'k_value') {
    return 'W/(㎡·K)'
  }
  if (key === 'total_resistance' || key.startsWith('layer_') || key.startsWith('product_')) {
    return '(㎡·K)/W'
  }
  return null
}

export function buildThermalCalcPresentation(record: ThermalCalcRecord): ThermalCalcPresentation {
  const result = asRecord(record.result)
  const standard = asRecord(record.standard)

  const steps = (Array.isArray(record.steps) ? record.steps : []).map((raw) => {
    const step = asRecord(raw)
    const key = asString(step.key) ?? ''
    return {
      key,
      label: asString(step.label) ?? key,
      formula: asString(step.formula),
      value: asNumber(step.rounded) ?? asNumber(step.value),
      unit: stepUnit(key),
    }
  }).filter(step => step.key)

  const layers = (Array.isArray(record.layers) ? record.layers : []).map((raw) => {
    const layer = asRecord(raw)
    const thicknessM = asNumber(layer.thicknessM)
    return {
      order: asNumber(layer.layerOrder) ?? 0,
      name: asString(layer.layerName) ?? '未命名构造层',
      type: asString(layer.layerType),
      thicknessMm: thicknessM !== null ? Math.round(thicknessM * 1000 * 100) / 100 : null,
      lambda: asNumber(layer.lambda),
      correctionFactor: asNumber(layer.correctionFactor),
    }
  }).sort((a, b) => a.order - b.order)

  const standardParts = [asString(standard.basisName), asString(standard.clauseRef)].filter((item): item is string => item !== null)

  return {
    mode: record.mode,
    resultK: asNumber(result.kValueRounded) ?? asNumber(result.kValue),
    targetK: asNumber(standard.limitKValue),
    compliant: typeof result.compliant === 'boolean' ? result.compliant : null,
    totalResistance: asNumber(result.totalResistanceRounded) ?? asNumber(result.totalResistance),
    standardLabel: standardParts.length > 0 ? standardParts.join(' · ') : null,
    steps,
    layers,
  }
}

export interface ThermalCandidateRanking {
  candidateId: string
  ranking?: { kGap?: number, isClosestToTarget?: boolean } | null
}

/**
 * 候选列表「最接近目标值」标记集合（后端 isClosestToTarget 为唯一事实源，前端不自行比较 K）。
 * 不允许出现「AI 唯一推荐」类文案。
 */
export function closestThermalCandidateIds<T extends ThermalCandidateRanking>(candidates: readonly T[]): Set<string> {
  return new Set(candidates.filter(item => item.ranking?.isClosestToTarget === true).map(item => item.candidateId))
}

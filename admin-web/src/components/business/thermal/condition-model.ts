import type { ThermalLookupFilter, ThermalLookupMetric, ThermalLookupMode } from '@/types/thermal'

/**
 * 热工参考查询条件编辑模型（UI 层）。
 * 与后端 filters[] 契约的差异只在 targetValue 允许为空（提交时过滤未填行）。
 */

/** 厚度档：不限 / 精确档 / 区间（与后端 thicknessMm 与 thicknessMin+Max 互斥语义一致）。 */
export type ThermalThicknessMode = 'any' | 'exact' | 'range'

/** 编辑态条件行（targetValue 允许为空，提交时才过滤）。 */
export interface ThermalConditionDraft {
  metric: ThermalLookupMetric
  mode: ThermalLookupMode
  targetValue: number | undefined
}

/** 提交给调用方的已校验条件载荷（调用方再叠加地区 / 基层 / 规格类别等范围条件）。 */
export interface ThermalConditionPayload {
  filters: ThermalLookupFilter[]
  thicknessMm?: number
  thicknessMin?: number
  thicknessMax?: number
}

/** 后端 filters[] 上限。 */
export const THERMAL_CONDITION_MAX_ROWS = 12

export function createThermalConditionDraft(
  metric: ThermalLookupMetric = 'K',
  mode: ThermalLookupMode = 'MAX_LIMIT',
): ThermalConditionDraft {
  return { metric, mode, targetValue: undefined }
}

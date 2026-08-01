import type { EChartsOption } from '../echarts'
import type { ChartTokens } from '../tokens'
import type {
  DashboardTaskDistributionItem,
  DashboardTrendPoint,
  TrendRange,
} from '@/types/dashboard'
import { isCategoryEmpty, isSeriesEmpty } from '../helpers'
import { createDonutOption } from './donut'
import { createLineOption } from './line'

export const TREND_LABELS: Record<TrendRange, { stored: string; reviewed: string; reports: string }> = {
  '7d': {
    stored: '资料入库',
    reviewed: '数据复核',
    reports: '报告生成',
  },
  '30d': {
    stored: '资料入库',
    reviewed: '数据复核',
    reports: '报告生成',
  },
}

export const TASK_STATUS_LABELS: Record<DashboardTaskDistributionItem['status'], string> = {
  PENDING: '待处理',
  PROCESSING: '处理中',
  COMPLETED: '已完成',
  FAILED: '失败',
}

export interface TrendOptionParams {
  points: DashboardTrendPoint[]
  tokens: ChartTokens
}

/** 业务处理趋势：最近 7/30 天三条业务线，默认最多 3 条 */
export function createTrendOption({ points, tokens }: TrendOptionParams): EChartsOption | null {
  const series = [
    { name: TREND_LABELS['7d'].stored, data: points.map(point => point.stored) },
    { name: TREND_LABELS['7d'].reviewed, data: points.map(point => point.reviewed) },
    { name: TREND_LABELS['7d'].reports, data: points.map(point => point.reports) },
  ]

  if (isSeriesEmpty(series)) {
    return null
  }

  return createLineOption({
    categories: points.map(point => point.date),
    series,
    tokens,
  })
}

export interface TaskDistributionOptionParams {
  items: DashboardTaskDistributionItem[]
  tokens: ChartTokens
}

/** 任务状态分布：数据过少时返回 null，调用方回退到水平进度条 */
export function createTaskDistributionOption({
  items,
  tokens,
}: TaskDistributionOptionParams): EChartsOption | null {
  const categories = items.map(item => ({ name: TASK_STATUS_LABELS[item.status], value: item.count }))
  if (isCategoryEmpty(categories) || categories.length < 4) {
    return null
  }

  return createDonutOption({
    items: categories,
    tokens,
  })
}
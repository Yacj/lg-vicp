import type { ChartTokens } from './tokens'
import { describe, expect, it } from 'vitest'
import { createTaskDistributionOption, createTrendOption, TASK_STATUS_LABELS } from './options/dashboard'
import { filterEmptySeries, isCategoryEmpty, isSeriesEmpty } from './helpers'
import type { DashboardTaskDistributionItem, DashboardTrendPoint } from '@/types/dashboard'
import { createLineOption } from './options/line'
import { createBarOption } from './options/bar'

const tokens: ChartTokens = {
  theme: 'light',
  textPrimary: '#181818',
  textSecondary: 'rgba(0, 0, 0, .6)',
  textPlaceholder: 'rgba(0, 0, 0, .4)',
  axisLine: '#e8e8e8',
  splitLine: '#e8e8e8',
  tooltipBg: '#fff',
  tooltipBorder: '#ddd',
  brand: '#0052d9',
  success: '#2ba471',
  warning: '#e37318',
  error: '#d54941',
  palette: ['#0052d9', '#2ba471', '#e37318', '#d54941'],
}

describe('chart data projection', () => {
  it('detects empty trend series and returns null option', () => {
    const points: DashboardTrendPoint[] = [
      { date: '03-08', stored: 0, reviewed: 0, reports: 0 },
      { date: '03-09', stored: 0, reviewed: 0, reports: 0 },
    ]

    expect(isSeriesEmpty([
      { name: '资料入库', data: [0, 0] },
      { name: '数据复核', data: [0, 0] },
      { name: '报告生成', data: [0, 0] },
    ])).toBe(true)
    expect(createTrendOption({ points, tokens })).toBeNull()
  })

  it('builds trend option from real points with exactly three series', () => {
    const points: DashboardTrendPoint[] = [
      { date: '03-08', stored: 2, reviewed: 1, reports: 0 },
      { date: '03-09', stored: 3, reviewed: 2, reports: 1 },
    ]
    const option = createTrendOption({ points, tokens })

    expect(option).not.toBeNull()
    const series = option!.series
    const seriesList = Array.isArray(series) ? series : series ? [series] : []
    expect(seriesList).toHaveLength(3)
    expect(seriesList.every(item => item.type === 'line')).toBe(true)
  })

  it('falls back to null task distribution when too few categories', () => {
    const items: DashboardTaskDistributionItem[] = [
      { status: 'PENDING', count: 3 },
      { status: 'COMPLETED', count: 8 },
    ]

    expect(isCategoryEmpty([
      { name: '待处理', value: 0 },
      { name: '处理中', value: 0 },
    ])).toBe(true)
    expect(createTaskDistributionOption({ items, tokens })).toBeNull()
  })

  it('maps task status labels without inventing statuses', () => {
    expect(TASK_STATUS_LABELS).toEqual({
      PENDING: '待处理',
      PROCESSING: '处理中',
      COMPLETED: '已完成',
      FAILED: '失败',
    })
  })

  it('drops series that are entirely zero from line rendering', () => {
    const kept = filterEmptySeries([
      { name: '资料入库', data: [0, 1] },
      { name: '数据复核', data: [0, 0] },
    ])

    expect(kept.map(item => item.name)).toEqual(['资料入库'])
  })

  it('derives colors from the shared token palette only', () => {
    const option = createLineOption({
      categories: ['a', 'b'],
      series: [{ name: '入库', data: [1, 2] }],
      tokens,
    })
    const barOption = createBarOption({
      categories: ['a', 'b'],
      series: [{ name: '任务数', data: [1, 2] }],
      tokens,
      horizontal: true,
    })

    expect(option.color).toEqual(tokens.palette.slice(0, 1))
    expect(barOption.color).toEqual(tokens.palette.slice(0, 1))
    const xAxis = Array.isArray(barOption.xAxis) ? barOption.xAxis[0] : barOption.xAxis
    const yAxis = Array.isArray(barOption.yAxis) ? barOption.yAxis[0] : barOption.yAxis
    expect(xAxis?.type).toBe('value')
    expect(yAxis?.type).toBe('category')
  })
})
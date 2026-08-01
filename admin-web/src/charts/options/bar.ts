import type { EChartsOption } from '../echarts'
import type { ChartTokens } from '../tokens'
import {
  assignPalette,
  createAxisCommonStyle,
  createGridStyle,
  createLegendStyle,
  createTooltipStyle,
  type ChartSeriesData,
} from '../helpers'

export interface BarOptionParams {
  categories: string[]
  series: ChartSeriesData[]
  tokens: ChartTokens
  horizontal?: boolean
}

/** 柱状图：横向柱状图适合少量分类的对比，系列颜色取自统一 Token 调色板 */
export function createBarOption({
  categories,
  series,
  tokens,
  horizontal = false,
}: BarOptionParams): EChartsOption {
  const colorMap = assignPalette(series.map(item => item.name), tokens.palette)
  const axisCommon = createAxisCommonStyle(tokens)

  return {
    animationDuration: 300,
    color: series.map(item => colorMap[item.name]),
    grid: createGridStyle(tokens, series.length > 1),
    legend: series.length > 1 ? createLegendStyle(tokens, 'top') : undefined,
    series: series.map(item => ({
      barMaxWidth: 24,
      data: item.data,
      name: item.name,
      type: 'bar',
      emphasis: {
        focus: 'series',
      },
    })),
    tooltip: {
      ...createTooltipStyle(tokens),
      trigger: 'axis',
      axisPointer: {
        type: 'shadow',
      },
    },
    xAxis: horizontal
      ? { type: 'value', ...axisCommon }
      : { type: 'category', data: categories, ...axisCommon },
    yAxis: horizontal
      ? { type: 'category', data: categories, ...axisCommon }
      : { type: 'value', minInterval: 1, ...axisCommon },
  }
}
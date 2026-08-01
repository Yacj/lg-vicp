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

export interface LineOptionParams {
  categories: string[]
  series: ChartSeriesData[]
  tokens: ChartTokens
  smooth?: boolean
}

/** 折线图：多系列趋势对比，系列颜色取自统一 Token 调色板 */
export function createLineOption({
  categories,
  series,
  tokens,
  smooth = true,
}: LineOptionParams): EChartsOption {
  const colorMap = assignPalette(series.map(item => item.name), tokens.palette)

  return {
    animationDuration: 300,
    color: series.map(item => colorMap[item.name]),
    grid: createGridStyle(tokens, series.length > 1),
    legend: series.length > 1 ? createLegendStyle(tokens, 'top') : undefined,
    series: series.map(item => ({
      data: item.data,
      name: item.name,
      smooth,
      symbol: 'circle',
      symbolSize: 5,
      type: 'line',
      emphasis: {
        focus: 'series',
      },
    })),
    tooltip: {
      ...createTooltipStyle(tokens),
      trigger: 'axis',
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: categories,
      ...createAxisCommonStyle(tokens),
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      ...createAxisCommonStyle(tokens),
    },
  }
}
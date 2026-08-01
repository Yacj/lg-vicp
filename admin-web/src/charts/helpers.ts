import type { ChartTokens } from './tokens'

export interface ChartSeriesData {
  name: string
  data: number[]
}

export interface ChartCategoryItem {
  name: string
  value: number
}

/** 系列名 → 调色板颜色，未配置的系列按顺序取色 */
export function assignPalette(seriesNames: readonly string[], palette: readonly string[]): Record<string, string> {
  return Object.fromEntries(seriesNames.map((name, index) => [name, palette[index % palette.length]]))
}

/** 去掉全零或全为 null 的系列，避免画无意义折线 */
export function filterEmptySeries(
  series: readonly ChartSeriesData[],
): ChartSeriesData[] {
  return series.filter(item => item.data.some(value => value > 0))
}

/** 全部数据点都为空时返回 true，用于空状态判断 */
export function isSeriesEmpty(series: readonly ChartSeriesData[]): boolean {
  return series.every(item => item.data.length === 0 || item.data.every(value => !value))
}

export function isCategoryEmpty(items: readonly ChartCategoryItem[]): boolean {
  return items.length === 0 || items.every(item => !item.value)
}

export function createTooltipStyle(tokens: ChartTokens) {
  return {
    backgroundColor: tokens.tooltipBg,
    borderColor: tokens.tooltipBorder,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: {
      color: tokens.textPrimary,
      fontSize: 12,
    },
  }
}

export function createLegendStyle(tokens: ChartTokens, position: 'top' | 'bottom' = 'top') {
  return {
    bottom: position === 'bottom' ? 0 : undefined,
    icon: 'roundRect',
    itemHeight: 8,
    itemWidth: 14,
    textStyle: {
      color: tokens.textSecondary,
      fontSize: 12,
    },
    top: position === 'top' ? 0 : undefined,
  }
}

export function createGridStyle(_tokens: ChartTokens, hasLegend: boolean) {
  return {
    bottom: hasLegend ? 32 : 24,
    containLabel: true,
    left: 8,
    right: 12,
    top: hasLegend ? 28 : 12,
  }
}

export function createAxisCommonStyle(tokens: ChartTokens) {
  return {
    axisLabel: {
      color: tokens.textSecondary,
      fontSize: 12,
    },
    axisLine: {
      lineStyle: {
        color: tokens.axisLine,
      },
    },
    axisTick: {
      show: false,
    },
    splitLine: {
      lineStyle: {
        color: tokens.splitLine,
        type: 'dashed' as const,
      },
    },
  }
}
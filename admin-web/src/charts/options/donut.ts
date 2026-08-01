import type { EChartsOption } from '../echarts'
import type { ChartTokens } from '../tokens'
import type { ChartCategoryItem } from '../helpers'
import { createTooltipStyle, createLegendStyle } from '../helpers'

export interface DonutOptionParams {
  items: ChartCategoryItem[]
  tokens: ChartTokens
  centerText?: string
}

/** 环形图：适合少量状态分类占比；数据过少时调用方应优先使用进度条 */
export function createDonutOption({
  items,
  tokens,
  centerText,
}: DonutOptionParams): EChartsOption {
  const total = items.reduce((sum, item) => sum + item.value, 0)

  return {
    animationDuration: 300,
    color: tokens.palette,
    legend: createLegendStyle(tokens, 'bottom'),
    series: [
      {
        avoidLabelOverlap: true,
        center: ['50%', '42%'],
        data: items.map(item => ({ name: item.name, value: item.value })),
        emphasis: {
          itemStyle: {
            shadowBlur: 6,
            shadowOffsetX: 0,
            shadowColor: tokens.textPlaceholder,
          },
        },
        itemStyle: {
          borderRadius: 4,
          borderColor: tokens.tooltipBg,
          borderWidth: 2,
        },
        label: {
          color: tokens.textSecondary,
          fontSize: 12,
        },
        labelLine: {
          length: 8,
          length2: 8,
        },
        radius: ['58%', '82%'],
        type: 'pie',
      },
    ],
    title: centerText
      ? {
          text: centerText,
          left: 'center',
          top: '32%',
          textStyle: {
            color: tokens.textPrimary,
            fontSize: 20,
            fontWeight: 600,
          },
        }
      : undefined,
    tooltip: {
      ...createTooltipStyle(tokens),
      formatter: (params) => {
        const item = Array.isArray(params) ? params[0] : params
        const value = typeof item.value === 'number' ? item.value : 0
        const percent = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0'
        return `${item.name}：${value}（${percent}%）`
      },
      trigger: 'item',
    },
  }
}
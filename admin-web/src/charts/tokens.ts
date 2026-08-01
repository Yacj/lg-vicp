import type { ChartTheme } from './theme'
import { pickTokenFallbacks } from './theme'

export interface ChartTokens {
  theme: ChartTheme
  textPrimary: string
  textSecondary: string
  textPlaceholder: string
  axisLine: string
  splitLine: string
  tooltipBg: string
  tooltipBorder: string
  brand: string
  success: string
  warning: string
  error: string
  palette: string[]
}

// 兜底值仅在读取不到 CSS 变量时（如测试环境）使用，运行时以 --td-* 为准
function readCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') {
    return fallback
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

export function createChartTokens(theme: ChartTheme): ChartTokens {
  const fallback = pickTokenFallbacks(theme)

  return {
    theme,
    textPrimary: readCssVar('--td-text-color-primary', fallback.textPrimary),
    textSecondary: readCssVar('--td-text-color-secondary', fallback.textSecondary),
    textPlaceholder: readCssVar('--td-text-color-placeholder', fallback.textPlaceholder),
    axisLine: readCssVar('--td-component-stroke', fallback.axisLine),
    splitLine: readCssVar('--td-component-stroke', fallback.splitLine),
    tooltipBg: readCssVar('--td-bg-color-container', fallback.tooltipBg),
    tooltipBorder: readCssVar('--td-component-border', fallback.tooltipBorder),
    brand: readCssVar('--td-brand-color', fallback.brand),
    success: readCssVar('--td-success-color', fallback.success),
    warning: readCssVar('--td-warning-color', fallback.warning),
    error: readCssVar('--td-error-color', fallback.error),
    palette: fallback.palette.map((value, index) =>
      readCssVar(
        PALETTE_CSS_VARS[index] ?? '',
        value,
      ),
    ),
  }
}

const PALETTE_CSS_VARS = [
  '--td-brand-color',
  '--td-success-color',
  '--td-warning-color',
  '--td-error-color',
  '--td-brand-color-8',
  '--td-success-color-6',
]
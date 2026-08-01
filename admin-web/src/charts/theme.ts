export type ChartTheme = 'dark' | 'light'

/** 图表主题兜底色板：仅在 CSS 变量读取失败（测试环境）时使用，运行时颜色一律来自 --td-* */
export interface ChartTokenFallbacks {
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

/** 浅色兜底：TDesign 官方默认值 */
const LIGHT_TOKEN_FALLBACKS: ChartTokenFallbacks = {
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
  palette: ['#0052d9', '#2ba471', '#e37318', '#d54941', '#003cab', '#008858'],
}

/** 深色兜底：文本与结构色按深色惯例调整，语义色保持官方默认 */
const DARK_TOKEN_FALLBACKS: ChartTokenFallbacks = {
  ...LIGHT_TOKEN_FALLBACKS,
  textPrimary: 'rgba(255, 255, 255, .9)',
  textSecondary: 'rgba(255, 255, 255, .6)',
  textPlaceholder: 'rgba(255, 255, 255, .4)',
  axisLine: 'rgba(255, 255, 255, .2)',
  splitLine: 'rgba(255, 255, 255, .2)',
  tooltipBg: '#202020',
  tooltipBorder: 'rgba(255, 255, 255, .2)',
}

export function pickTokenFallbacks(theme: ChartTheme): ChartTokenFallbacks {
  return theme === 'dark' ? DARK_TOKEN_FALLBACKS : LIGHT_TOKEN_FALLBACKS
}
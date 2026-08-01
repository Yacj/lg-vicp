import type { ChartTheme } from '@/charts/theme'
import type { ChartTokens } from '@/charts/tokens'
import { createChartTokens } from '@/charts/tokens'
import { useSettingsStore } from '@/stores/settings'
import { computed, nextTick, ref, watch } from 'vue'

/**
 * 图表主题派生：跟随 settings store 的 effectiveTheme。
 * 主题切换时先等待 DOM 外观属性应用（nextTick），再重读 --td-* 变量，
 * 保证浅色/深色实时响应且颜色取自全局 Design Token。
 */
export function useChartTheme() {
  const settingsStore = useSettingsStore()
  const theme = computed<ChartTheme>(() => settingsStore.effectiveTheme)
  const tokensVersion = ref(0)

  watch(theme, () => {
    void nextTick(() => {
      tokensVersion.value += 1
    })
  })

  const tokens = computed<ChartTokens>(() => {
    void tokensVersion.value
    return createChartTokens(theme.value)
  })

  return { theme, tokens }
}
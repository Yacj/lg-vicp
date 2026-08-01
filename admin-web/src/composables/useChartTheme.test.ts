import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { useSettingsStore } from '@/stores/settings'
import { useChartTheme } from './useChartTheme'

function applyTheme(theme: 'light' | 'dark'): void {
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

describe('useChartTheme', () => {
  it('derives theme from settings store effective theme', () => {
    setActivePinia(createPinia())
    const settingsStore = useSettingsStore()
    const { theme } = useChartTheme()

    applyTheme('light')
    settingsStore.updateSettings({ themeMode: 'light' })
    expect(theme.value).toBe('light')

    settingsStore.updateSettings({ themeMode: 'dark' })
    applyTheme('dark')
    expect(theme.value).toBe('dark')
  })

  it('reads text tokens from the applied design tokens', async () => {
    setActivePinia(createPinia())
    const settingsStore = useSettingsStore()
    const { tokens } = useChartTheme()

    settingsStore.updateSettings({ themeMode: 'dark' })
    applyTheme('dark')

    expect(tokens.value.theme).toBe('dark')
    // CSS 变量读取失败时使用兜底值，保证 token 结构稳定
    expect(tokens.value.textPrimary).toBeTruthy()
    expect(tokens.value.palette.length).toBeGreaterThanOrEqual(4)
  })
})
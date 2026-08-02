import type { AppearanceSettings } from '@/types/appearance'
import { usePreferredDark, useStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import {
  APPEARANCE_STORAGE_KEY,
  createDefaultAppearanceSettings,
  parseAppearanceSettings,
} from '@/config/appearance'
import { generateBrandColorScale } from '@/utils/color'

export type EffectiveTheme = 'dark' | 'light'
export type { AppearanceSettings, ThemeMode } from '@/types/appearance'

export function applyAppearance(settings: AppearanceSettings, effectiveTheme: EffectiveTheme): void {
  const root = document.documentElement
  const sidebarTheme = settings.sidebarTheme === 'auto'
    ? effectiveTheme
    : settings.sidebarTheme
  const brandScale = generateBrandColorScale(settings.primaryColor)[effectiveTheme]
  brandScale.forEach((color, index) => {
    root.style.setProperty(`--td-brand-color-${index + 1}`, color)
  })
  const attributes = {
    'data-theme': effectiveTheme,
    'data-layout': settings.layoutMode,
    'data-sidebar-theme': sidebarTheme,
    'data-content-width': settings.contentWidth,
    'data-density': settings.density,
    'data-tabs-style': settings.tabsStyle,
    'data-radius': settings.radiusLevel,
    'data-primary-color': settings.primaryColor,
    'data-fixed-header': String(settings.fixedHeader),
  }

  root.classList.toggle('dark', effectiveTheme === 'dark')
  root.removeAttribute('data-theme-preset')
  Object.entries(attributes).forEach(([name, value]) => root.setAttribute(name, value))
  root.style.colorScheme = effectiveTheme
}

export const useSettingsStore = defineStore('settings', () => {
  const persistedSettings = useStorage<unknown>(
    APPEARANCE_STORAGE_KEY,
    createDefaultAppearanceSettings(),
  )
  const settings = ref<AppearanceSettings>(
    parseAppearanceSettings(persistedSettings.value) ?? createDefaultAppearanceSettings(),
  )
  const preferredDark = usePreferredDark()

  const effectiveTheme = computed<EffectiveTheme>(() => {
    if (settings.value.themeMode === 'system') {
      return preferredDark.value ? 'dark' : 'light'
    }
    return settings.value.themeMode
  })

  function updateSettings(patch: Partial<AppearanceSettings>): void {
    const nextSettings = parseAppearanceSettings({ ...settings.value, ...patch })
    if (!nextSettings) {
      throw new TypeError('外观配置包含无效字段')
    }
    settings.value = nextSettings
  }

  function patchSetting<Key extends keyof AppearanceSettings>(
    key: Key,
    value: AppearanceSettings[Key],
  ): void {
    updateSettings({ [key]: value } as Pick<AppearanceSettings, Key>)
  }

  function resetSettings(): void {
    settings.value = createDefaultAppearanceSettings()
  }

  function exportSettings(): string {
    return JSON.stringify(settings.value, null, 2)
  }

  function importSettings(serialized: string) {
    try {
      const imported = parseAppearanceSettings(JSON.parse(serialized))
      if (!imported) {
        return { success: false, error: '导入内容不是有效的外观配置' } as const
      }
      settings.value = imported
      return { success: true, data: { ...imported } } as const
    }
    catch {
      return { success: false, error: '导入内容不是有效的 JSON' } as const
    }
  }

  watch(
    settings,
    (value) => {
      persistedSettings.value = { ...value }
    },
    { deep: true, immediate: true },
  )

  watch(
    [settings, effectiveTheme],
    ([currentSettings, currentTheme]) => applyAppearance(currentSettings, currentTheme),
    { deep: true, immediate: true },
  )

  return {
    effectiveTheme,
    exportSettings,
    importSettings,
    patchSetting,
    resetSettings,
    settings,
    updateSettings,
  }
})

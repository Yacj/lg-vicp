import type { AppearanceSettings } from '@/types/appearance'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_SETTINGS,
} from '@/config/appearance'
import {
  CONTENT_WIDTHS,
  LAYOUT_MODES,
  PAGE_DENSITIES,
  RADIUS_LEVELS,
  THEME_PRESETS,
} from '@/types/appearance'
import { useSettingsStore } from './settings'

interface MatchMediaController {
  setMatches: (matches: boolean) => void
}

const CUSTOM_APPEARANCE_SETTINGS: AppearanceSettings = {
  themeMode: 'dark',
  layoutMode: 'top',
  sidebarTheme: 'auto',
  contentWidth: 'fixed',
  density: 'compact',
  tabsStyle: 'chrome',
  radiusLevel: 'large',
  systemThemePreset: 'technology-blue',
  componentThemePreset: 'purple',
  syncThemeColors: false,
  fixedHeader: false,
  showTabs: false,
  sidebarCollapsed: true,
}

function installMatchMedia(initialMatches: boolean): MatchMediaController {
  let matches = initialMatches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const mediaQuery = {
    get matches() {
      return matches
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
      if (event === 'change') {
        listeners.add(listener)
      }
    }),
    removeEventListener: vi.fn((event: string, listener: (event: MediaQueryListEvent) => void) => {
      if (event === 'change') {
        listeners.delete(listener)
      }
    }),
    addListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList

  vi.mocked(window.matchMedia).mockImplementation(() => mediaQuery)

  return {
    setMatches(nextMatches: boolean) {
      matches = nextMatches
      const event = { matches, media: mediaQuery.media } as MediaQueryListEvent
      listeners.forEach(listener => listener(event))
    },
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  installMatchMedia(false)
})

describe('appearance settings store', () => {
  it('uses the complete default appearance configuration', () => {
    const store = useSettingsStore()

    expect(store.settings).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(store.effectiveTheme).toBe('light')
    expect(document.documentElement.dataset).toMatchObject({
      theme: 'light',
      layout: 'mixed',
      sidebarTheme: 'dark',
      contentWidth: 'fluid',
      density: 'comfortable',
      tabsStyle: 'line',
      radius: 'medium',
      systemThemePreset: 'vicp-blue',
      componentThemePreset: 'vicp-blue',
      syncThemeColors: 'true',
      fixedHeader: 'true',
    })
  })

  it('persists and restores every appearance field with the versioned key', async () => {
    const store = useSettingsStore()
    store.updateSettings(CUSTOM_APPEARANCE_SETTINGS)
    await nextTick()

    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? '{}'))
      .toEqual(CUSTOM_APPEARANCE_SETTINGS)

    store.$dispose()
    setActivePinia(createPinia())
    const restoredStore = useSettingsStore()

    expect(restoredStore.settings).toEqual(CUSTOM_APPEARANCE_SETTINGS)
    expect(document.documentElement.dataset).toMatchObject({
      theme: 'dark',
      layout: 'top',
      sidebarTheme: 'dark',
      contentWidth: 'fixed',
      density: 'compact',
      tabsStyle: 'chrome',
      radius: 'large',
      systemThemePreset: 'technology-blue',
      componentThemePreset: 'purple',
      syncThemeColors: 'false',
      fixedHeader: 'false',
    })
  })

  it('migrates legacy themePreset into the normalized theme fields', async () => {
    const legacySettings: Record<string, unknown> = { ...DEFAULT_APPEARANCE_SETTINGS }
    delete legacySettings.systemThemePreset
    delete legacySettings.componentThemePreset
    delete legacySettings.syncThemeColors
    delete legacySettings.fixedHeader
    legacySettings.themePreset = 'purple'
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(legacySettings))

    const store = useSettingsStore()
    await nextTick()

    expect(store.settings.systemThemePreset).toBe('purple')
    expect(store.settings.componentThemePreset).toBe('purple')
    expect(store.settings.syncThemeColors).toBe(true)
    expect(store.settings.fixedHeader).toBe(true)
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? '{}'))
      .toEqual(store.settings)
    expect(document.documentElement.dataset.systemThemePreset).toBe('purple')
  })

  it('tracks system theme changes without changing the selected mode', async () => {
    const media = installMatchMedia(false)
    const store = useSettingsStore()

    expect(store.settings.themeMode).toBe('system')
    expect(store.effectiveTheme).toBe('light')

    media.setMatches(true)
    await nextTick()

    expect(store.settings.themeMode).toBe('system')
    expect(store.effectiveTheme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('projects independent system and component theme presets', async () => {
    const store = useSettingsStore()
    store.patchSetting('systemThemePreset', 'technology-blue')
    await nextTick()

    expect(document.documentElement.dataset.systemThemePreset).toBe('technology-blue')
    expect(document.documentElement.dataset.componentThemePreset).toBe('technology-blue')

    store.patchSetting('syncThemeColors', false)
    store.patchSetting('componentThemePreset', 'purple')
    await nextTick()

    expect(document.documentElement.dataset.systemThemePreset).toBe('technology-blue')
    expect(document.documentElement.dataset.componentThemePreset).toBe('purple')
  })

  it.each(THEME_PRESETS)('accepts and projects the %s theme preset', async (preset) => {
    const store = useSettingsStore()
    store.patchSetting('systemThemePreset', preset)
    await nextTick()

    expect(document.documentElement.dataset.systemThemePreset).toBe(preset)
    expect(document.documentElement.dataset.componentThemePreset).toBe(preset)
  })

  it('projects every layout, density, content width and radius option', async () => {
    const store = useSettingsStore()

    for (const layout of LAYOUT_MODES) {
      store.patchSetting('layoutMode', layout)
      await nextTick()
      expect(document.documentElement.dataset.layout).toBe(layout)
    }
    for (const density of PAGE_DENSITIES) {
      store.patchSetting('density', density)
      await nextTick()
      expect(document.documentElement.dataset.density).toBe(density)
    }
    for (const contentWidth of CONTENT_WIDTHS) {
      store.patchSetting('contentWidth', contentWidth)
      await nextTick()
      expect(document.documentElement.dataset.contentWidth).toBe(contentWidth)
    }
    for (const radius of RADIUS_LEVELS) {
      store.patchSetting('radiusLevel', radius)
      await nextTick()
      expect(document.documentElement.dataset.radius).toBe(radius)
    }
  })

  it('applies explicit light and dark modes immediately', async () => {
    const store = useSettingsStore()

    for (const themeMode of ['light', 'dark'] as const) {
      store.patchSetting('themeMode', themeMode)
      await nextTick()
      expect(store.effectiveTheme).toBe(themeMode)
      expect(document.documentElement.dataset.theme).toBe(themeMode)
    }
  })

  it('resets every setting and persisted field to defaults', async () => {
    const store = useSettingsStore()
    store.updateSettings(CUSTOM_APPEARANCE_SETTINGS)

    store.resetSettings()
    await nextTick()

    expect(store.settings).toEqual(DEFAULT_APPEARANCE_SETTINGS)
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? '{}'))
      .toEqual(DEFAULT_APPEARANCE_SETTINGS)
  })

  it('imports validated settings and rejects invalid content without mutation', () => {
    const store = useSettingsStore()
    const exported = store.exportSettings()

    store.patchSetting('themeMode', 'dark')
    expect(store.importSettings(exported)).toMatchObject({ success: true })
    expect(store.settings.themeMode).toBe('system')

    const beforeInvalidImport = store.exportSettings()
    expect(store.importSettings('{"themeMode":"unknown"}')).toEqual({
      success: false,
      error: '导入内容不是有效的外观配置',
    })
    expect(store.exportSettings()).toBe(beforeInvalidImport)
  })
})

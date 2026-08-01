import type { AppearanceSettings } from '@/types/appearance'
import {
  CONTENT_WIDTHS,
  LAYOUT_MODES,
  PAGE_DENSITIES,
  RADIUS_LEVELS,
  SIDEBAR_THEMES,
  TABS_STYLES,
  THEME_MODES,
  THEME_PRESETS,
} from '@/types/appearance'

export const APPEARANCE_STORAGE_KEY = 'vicp-admin-appearance-v1'

export const DEFAULT_APPEARANCE_SETTINGS: Readonly<AppearanceSettings> = Object.freeze({
  themeMode: 'system',
  layoutMode: 'mixed',
  sidebarTheme: 'dark',
  contentWidth: 'fluid',
  density: 'comfortable',
  tabsStyle: 'line',
  radiusLevel: 'medium',
  systemThemePreset: 'vicp-blue',
  componentThemePreset: 'vicp-blue',
  syncThemeColors: true,
  fixedHeader: true,
  showTabs: true,
  sidebarCollapsed: false,
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function includes<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value)
}

function resolveThemePresets(value: Record<string, unknown>): {
  componentThemePreset: AppearanceSettings['componentThemePreset']
  systemThemePreset: AppearanceSettings['systemThemePreset']
} | null {
  const legacyPreset = includes(THEME_PRESETS, value.themePreset) ? value.themePreset : null
  const systemThemePreset = includes(THEME_PRESETS, value.systemThemePreset)
    ? value.systemThemePreset
    : legacyPreset
  const componentThemePreset = includes(THEME_PRESETS, value.componentThemePreset)
    ? value.componentThemePreset
    : legacyPreset ?? systemThemePreset

  return systemThemePreset && componentThemePreset
    ? { componentThemePreset, systemThemePreset }
    : null
}

export function createDefaultAppearanceSettings(): AppearanceSettings {
  return { ...DEFAULT_APPEARANCE_SETTINGS }
}

export function parseAppearanceSettings(value: unknown): AppearanceSettings | null {
  if (!isRecord(value)) {
    return null
  }

  const themePresets = resolveThemePresets(value)
  const syncThemeColors = typeof value.syncThemeColors === 'boolean'
    ? value.syncThemeColors
    : true
  const fixedHeader = typeof value.fixedHeader === 'boolean'
    ? value.fixedHeader
    : true
  if (!includes(THEME_MODES, value.themeMode)
    || !includes(LAYOUT_MODES, value.layoutMode)
    || !includes(SIDEBAR_THEMES, value.sidebarTheme)
    || !includes(CONTENT_WIDTHS, value.contentWidth)
    || !includes(PAGE_DENSITIES, value.density)
    || !includes(TABS_STYLES, value.tabsStyle)
    || !includes(RADIUS_LEVELS, value.radiusLevel)
    || !themePresets
    || typeof value.showTabs !== 'boolean'
    || typeof value.sidebarCollapsed !== 'boolean') {
    return null
  }

  return {
    themeMode: value.themeMode,
    layoutMode: value.layoutMode,
    sidebarTheme: value.sidebarTheme,
    contentWidth: value.contentWidth,
    density: value.density,
    tabsStyle: value.tabsStyle,
    radiusLevel: value.radiusLevel,
    systemThemePreset: themePresets.systemThemePreset,
    componentThemePreset: themePresets.componentThemePreset,
    syncThemeColors,
    fixedHeader,
    showTabs: value.showTabs,
    sidebarCollapsed: value.sidebarCollapsed,
  }
}

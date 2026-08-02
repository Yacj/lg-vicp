import type { AppearanceSettings } from '@/types/appearance'
import {
  CONTENT_WIDTHS,
  LAYOUT_MODES,
  PAGE_DENSITIES,
  RADIUS_LEVELS,
  SIDEBAR_THEMES,
  TABS_STYLES,
  THEME_MODES,
} from '@/types/appearance'
import { isValidHexColor, normalizeHexColor } from '@/utils/color'

export const APPEARANCE_STORAGE_KEY = 'vicp-admin-appearance-v1'

export const DEFAULT_APPEARANCE_SETTINGS: Readonly<AppearanceSettings> = Object.freeze({
  themeMode: 'system',
  layoutMode: 'mixed',
  sidebarTheme: 'dark',
  contentWidth: 'fluid',
  density: 'comfortable',
  tabsStyle: 'line',
  radiusLevel: 'medium',
  primaryColor: '#0052d9',
  fixedHeader: true,
  showTabs: true,
  sidebarCollapsed: false,
})

/** 旧版预设名 → 主色 hex，用于持久化数据迁移 */
const LEGACY_PRESET_COLORS: Record<string, string> = {
  'vicp-blue': '#0052d9',
  'technology-blue': '#0b6cc4',
  indigo: '#5b50c8',
  cyan: '#0b8fa8',
  emerald: '#07885d',
  purple: '#7a3fc5',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function includes<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value)
}

/**
 * 解析主题主色，兼容旧版 themePreset / systemThemePreset / componentThemePreset。
 * 优先级：新字段 primaryColor > 旧 themePreset > 旧 systemThemePreset > 旧 componentThemePreset。
 */
function resolvePrimaryColor(value: Record<string, unknown>): string | null {
  if (typeof value.primaryColor === 'string') {
    return isValidHexColor(value.primaryColor) ? normalizeHexColor(value.primaryColor) : null
  }
  for (const legacyKey of ['themePreset', 'systemThemePreset', 'componentThemePreset'] as const) {
    const presetColor = typeof value[legacyKey] === 'string'
      ? LEGACY_PRESET_COLORS[value[legacyKey]]
      : undefined
    if (presetColor) {
      return presetColor
    }
  }
  return null
}

export function createDefaultAppearanceSettings(): AppearanceSettings {
  return { ...DEFAULT_APPEARANCE_SETTINGS }
}

export function parseAppearanceSettings(value: unknown): AppearanceSettings | null {
  if (!isRecord(value)) {
    return null
  }

  const primaryColor = resolvePrimaryColor(value)
  const fixedHeader = typeof value.fixedHeader === 'boolean'
    ? value.fixedHeader
    : true
  if (!primaryColor
    || !includes(THEME_MODES, value.themeMode)
    || !includes(LAYOUT_MODES, value.layoutMode)
    || !includes(SIDEBAR_THEMES, value.sidebarTheme)
    || !includes(CONTENT_WIDTHS, value.contentWidth)
    || !includes(PAGE_DENSITIES, value.density)
    || !includes(TABS_STYLES, value.tabsStyle)
    || !includes(RADIUS_LEVELS, value.radiusLevel)
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
    primaryColor,
    fixedHeader,
    showTabs: value.showTabs,
    sidebarCollapsed: value.sidebarCollapsed,
  }
}
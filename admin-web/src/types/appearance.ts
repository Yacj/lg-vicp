export const THEME_MODES = ['light', 'dark', 'system'] as const
export const LAYOUT_MODES = ['side', 'top', 'mixed', 'dual'] as const
export const SIDEBAR_THEMES = ['light', 'dark', 'auto'] as const
export const CONTENT_WIDTHS = ['fluid', 'fixed'] as const
export const PAGE_DENSITIES = ['comfortable', 'compact'] as const
export const TABS_STYLES = ['line', 'card', 'chrome'] as const
export const RADIUS_LEVELS = ['square', 'small', 'medium', 'large'] as const
export const THEME_PRESETS = [
  'vicp-blue',
  'technology-blue',
  'indigo',
  'cyan',
  'emerald',
  'purple',
] as const

export type ThemeMode = typeof THEME_MODES[number]
export type LayoutMode = typeof LAYOUT_MODES[number]
export type SidebarTheme = typeof SIDEBAR_THEMES[number]
export type ContentWidth = typeof CONTENT_WIDTHS[number]
export type PageDensity = typeof PAGE_DENSITIES[number]
export type TabsStyle = typeof TABS_STYLES[number]
export type RadiusLevel = typeof RADIUS_LEVELS[number]
export type ThemePreset = typeof THEME_PRESETS[number]

export interface AppearanceSettings {
  themeMode: ThemeMode
  layoutMode: LayoutMode
  sidebarTheme: SidebarTheme
  contentWidth: ContentWidth
  density: PageDensity
  tabsStyle: TabsStyle
  radiusLevel: RadiusLevel
  systemThemePreset: ThemePreset
  componentThemePreset: ThemePreset
  syncThemeColors: boolean
  fixedHeader: boolean
  showTabs: boolean
  sidebarCollapsed: boolean
}

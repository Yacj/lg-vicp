export const THEME_MODES = ['light', 'dark', 'system'] as const
export const LAYOUT_MODES = ['side', 'top', 'mixed', 'dual'] as const
export const SIDEBAR_THEMES = ['light', 'dark', 'auto'] as const
export const CONTENT_WIDTHS = ['fluid', 'fixed'] as const
export const PAGE_DENSITIES = ['comfortable', 'compact'] as const
export const TABS_STYLES = ['line', 'card', 'chrome'] as const
export const RADIUS_LEVELS = ['square', 'small', 'medium', 'large'] as const

/** 主题色快捷预设（与 TDesign 色板第 7 级主色一致） */
export const THEME_COLOR_PRESETS = [
  { label: 'VICP 深蓝', value: '#0052d9' },
  { label: '科技蓝', value: '#0b6cc4' },
  { label: '靛青', value: '#5b50c8' },
  { label: '青色', value: '#0b8fa8' },
  { label: '生态绿', value: '#07885d' },
  { label: '紫色', value: '#7a3fc5' },
] as const

export type ThemeMode = typeof THEME_MODES[number]
export type LayoutMode = typeof LAYOUT_MODES[number]
export type SidebarTheme = typeof SIDEBAR_THEMES[number]
export type ContentWidth = typeof CONTENT_WIDTHS[number]
export type PageDensity = typeof PAGE_DENSITIES[number]
export type TabsStyle = typeof TABS_STYLES[number]
export type RadiusLevel = typeof RADIUS_LEVELS[number]
export type ThemeColorPreset = typeof THEME_COLOR_PRESETS[number]

export interface AppearanceSettings {
  themeMode: ThemeMode
  layoutMode: LayoutMode
  sidebarTheme: SidebarTheme
  contentWidth: ContentWidth
  density: PageDensity
  tabsStyle: TabsStyle
  radiusLevel: RadiusLevel
  /** 主题主色（hex），同时驱动 TDesign 组件色阶与系统品牌色 */
  primaryColor: string
  fixedHeader: boolean
  showTabs: boolean
  sidebarCollapsed: boolean
}
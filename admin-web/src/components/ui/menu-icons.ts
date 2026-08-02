import type { Component } from 'vue'
import { defineAsyncComponent } from 'vue'
import { AppIcon as TDesignAppIcon, manifest } from 'tdesign-icons-vue-next'
import { LOCAL_ICON_OPTIONS, resolveLocalIcon } from '@/assets/menu-icons'

export type MenuIconKind = 'tdesign' | 'local' | 'fallback'
export type MenuIconFilter = 'all' | 'tdesign' | 'local'

export interface LocalIconOption {
  value: string
  label: string
  keywords: readonly string[]
  source: string
}

export interface MenuIconOption {
  value: string
  label: string
  keywords: readonly string[]
  kind: Exclude<MenuIconKind, 'fallback'>
  component?: Component
  source?: string
}

export interface MenuIconResolution {
  kind: MenuIconKind
  value: string | null
  component: Component
  source: string | null
}

type ComponentLoader = () => Promise<unknown>

const fallbackIcon = TDesignAppIcon as Component
const iconModules = import.meta.glob<ComponentLoader>('../../../node_modules/tdesign-icons-vue-next/esm/components/*.js', {
  import: 'default',
})

const tdesignComponents = new Map<string, Component>()
for (const entry of manifest) {
  const modulePath = `../../../node_modules/tdesign-icons-vue-next/esm/components/${entry.stem}.js`
  const loader = iconModules[modulePath]
  if (loader) {
    tdesignComponents.set(
      `tdesign:${entry.stem}`,
      defineAsyncComponent(() => loader() as Promise<Component>),
    )
  }
}

const legacyAliases: Readonly<Record<string, string>> = {
  ai: 'tdesign:robot',
  app: 'tdesign:app',
  architecture: 'tdesign:building-1',
  building: 'tdesign:building-1',
  chart: 'tdesign:chart',
  control: 'tdesign:control-platform',
  dashboard: 'tdesign:control-platform',
  file: 'tdesign:file',
  folder: 'tdesign:folder',
  home: 'tdesign:home',
  knowledge: 'tdesign:book',
  layers: 'tdesign:layers',
  menu: 'tdesign:menu',
  monitor: 'tdesign:control-platform',
  project: 'tdesign:building-1',
  role: 'tdesign:usergroup',
  setting: 'tdesign:setting',
  settings: 'tdesign:system-setting',
  system: 'tdesign:system-setting',
  user: 'tdesign:user',
  users: 'tdesign:usergroup',
}

const iconLabels: Readonly<Record<string, string>> = {
  app: '应用',
  book: '知识',
  chart: '图表',
  'control-platform': '控制台',
  file: '文件',
  folder: '文件夹',
  home: '首页',
  layers: '层级',
  menu: '菜单',
  robot: 'AI',
  setting: '设置',
  'system-setting': '系统设置',
  user: '用户',
  usergroup: '用户组',
}

function normalizeIconValue(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLocaleLowerCase() ?? ''
  if (!normalized) {
    return null
  }
  if (normalized in legacyAliases) {
    return legacyAliases[normalized]
  }
  if (normalized.startsWith('tdesign:')) {
    return `tdesign:${normalized.slice('tdesign:'.length)}`
  }
  if (normalized.startsWith('local:')) {
    return normalized
  }
  return null
}

function toTDesignOption(value: string, component: Component): MenuIconOption {
  const stem = value.slice('tdesign:'.length)
  const manifestEntry = manifest.find(entry => entry.stem === stem)
  const label = iconLabels[stem] ?? stem
  return {
    component,
    kind: 'tdesign',
    keywords: [stem, manifestEntry?.icon ?? '', label],
    label,
    value,
  }
}

export const MENU_ICON_OPTIONS: readonly MenuIconOption[] = Object.freeze([
  ...[...tdesignComponents.entries()].map(([value, component]) => toTDesignOption(value, component)),
  ...LOCAL_ICON_OPTIONS.map(option => ({
    ...option,
    kind: 'local' as const,
  })),
])

export function resolveMenuIconValue(value: string | null | undefined): MenuIconResolution {
  const normalized = normalizeIconValue(value)
  if (normalized?.startsWith('local:')) {
    const source = resolveLocalIcon(normalized)
    if (source) {
      return {
        component: fallbackIcon,
        kind: 'local',
        source,
        value: normalized,
      }
    }
  }
  if (normalized) {
    const component = tdesignComponents.get(normalized)
    if (component) {
      return {
        component,
        kind: 'tdesign',
        source: null,
        value: normalized,
      }
    }
  }
  return {
    component: fallbackIcon,
    kind: 'fallback',
    source: null,
    value: value?.trim() || null,
  }
}

/** 保留给只需要 TDesign component 的旧调用方；本地 SVG 请使用 AppIcon。 */
export function resolveMenuIcon(value: string | null | undefined): Component {
  return resolveMenuIconValue(value).component
}

export function canonicalizeMenuIcon(value: string | null | undefined): string | null {
  const normalized = normalizeIconValue(value)
  if (!normalized) {
    return null
  }
  if (normalized.startsWith('local:')) {
    return resolveLocalIcon(normalized) ? normalized : null
  }
  return tdesignComponents.has(normalized) ? normalized : null
}

export function isKnownMenuIcon(value: string | null | undefined): boolean {
  return canonicalizeMenuIcon(value) !== null
}

export function searchMenuIcons(keyword: string): readonly MenuIconOption[] {
  const normalized = keyword.trim().toLocaleLowerCase()
  if (!normalized) {
    return MENU_ICON_OPTIONS
  }
  return MENU_ICON_OPTIONS.filter(option => option.keywords.some(value => value.toLocaleLowerCase().includes(normalized)))
}

export function filterMenuIcons(
  options: readonly MenuIconOption[],
  filter: MenuIconFilter,
): readonly MenuIconOption[] {
  if (filter === 'all') {
    return options
  }
  return options.filter(option => option.kind === filter)
}

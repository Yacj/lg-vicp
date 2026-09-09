import type { Component } from 'vue'

export type DynamicComponentLoader = () => Promise<{ default: Component }>

const VIEW_GLOB_PREFIX = '../views/'
const VIEW_FILE_SUFFIX = '.vue'
const viewLoaders = import.meta.glob<{ default: Component }>('../views/**/*.vue')
const generatedComponentMap = Object.fromEntries(
  Object.entries(viewLoaders).map(([filePath, loader]) => {
    const key = filePath.slice(VIEW_GLOB_PREFIX.length, -VIEW_FILE_SUFFIX.length)
    return [key, loader] as const
  }),
) as Record<string, DynamicComponentLoader>

const homeLoader = generatedComponentMap['home/index']
if (!homeLoader) {
  throw new Error('组件白名单缺少 home/index 页面')
}

/**
 * 历史后端菜单 component 值 → 当前视图 key。
 * 白名单始终以真实视图文件为准；旧 key 仅在投影时改写，
 * 保证旧菜单种子（如 project/index、ai/index）不产生 UNKNOWN_COMPONENT。
 */
export const LEGACY_COMPONENT_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'ai/index': 'ai-ops/debug/index',
  'project/index': 'projects/index',
})

function resolveLegacyAlias(key: string): string {
  return LEGACY_COMPONENT_ALIASES[key] ?? key
}

export const componentMap: Readonly<Record<string, DynamicComponentLoader>> = Object.freeze({
  ...generatedComponentMap,
  Home: homeLoader,
})

export type DynamicComponentKey = keyof typeof componentMap

export interface DynamicComponentOption {
  value: DynamicComponentKey
  label: string
  path: string
}

function hasComponentKey(value: string): value is DynamicComponentKey {
  return Object.prototype.hasOwnProperty.call(componentMap, value)
}

function toViewPath(key: string): string {
  const resolvedKey = key === 'Home' ? 'home/index' : key
  return `@/views/${resolvedKey}.vue`
}

export function normalizeDynamicComponentKey(value: string | null | undefined): DynamicComponentKey | null {
  const input = value?.trim().replace(/\\/g, '/') ?? ''
  if (!input || input.includes('\u0000') || /^[a-z][a-z\d+.-]*:\/\//i.test(input) || input.startsWith('//')) {
    return null
  }

  const pathPrefixes = ['@/views/', '@src/views/', 'src/views/'] as const
  const prefix = pathPrefixes.find(item => input.startsWith(item))
  const candidate = prefix ? input.slice(prefix.length) : input
  const segments = candidate.split('/')
  if (
    candidate.startsWith('/')
    || candidate.endsWith('/')
    || segments.some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    return null
  }

  const key = candidate.endsWith(VIEW_FILE_SUFFIX)
    ? candidate.slice(0, -VIEW_FILE_SUFFIX.length)
    : candidate
  const aliasedKey = resolveLegacyAlias(key)
  return hasComponentKey(aliasedKey) ? aliasedKey : null
}

export function getDynamicComponentPath(value: string | null | undefined): string | null {
  const key = normalizeDynamicComponentKey(value)
  return key ? toViewPath(key) : null
}

const sortedComponentKeys = Object.keys(componentMap).sort((a, b) => {
  if (a === 'Home') return -1
  if (b === 'Home') return 1
  return a.localeCompare(b)
})

export const dynamicComponentOptions: readonly DynamicComponentOption[] = Object.freeze(
  sortedComponentKeys.map(value => ({
    label: toViewPath(value),
    path: toViewPath(value),
    value: value as DynamicComponentKey,
  })),
)

export function resolveDynamicComponent(key: string): DynamicComponentLoader | null {
  const normalized = normalizeDynamicComponentKey(key)
  return normalized ? componentMap[normalized] : null
}
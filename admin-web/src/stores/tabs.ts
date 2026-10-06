import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export interface AppTab {
  affix: boolean
  closable: boolean
  fullPath: string
  keepAlive: boolean
  name: string
  pinned: boolean
  title: string
}

export function tabPathname(fullPath: string): string {
  return fullPath.split(/[?#]/, 1)[0] || '/'
}

export function routeToTab(route: RouteLocationNormalizedLoaded): AppTab | null {
  if (route.meta.noTab || typeof route.name !== 'string') {
    return null
  }

  const affix = route.meta.affix === true
  return {
    affix,
    closable: !affix,
    fullPath: tabPathname(route.path),
    keepAlive: route.meta.keepAlive === true,
    name: route.name,
    pinned: false,
    title: typeof route.meta.title === 'string' ? route.meta.title : route.name,
  }
}

function isProtected(tab: AppTab): boolean {
  return tab.affix || tab.pinned || !tab.closable
}

function resolveAdjacentPath(tabs: readonly AppTab[], index: number): string {
  return tabs[index]?.fullPath || tabs[index - 1]?.fullPath || tabs.find(isProtected)?.fullPath || '/'
}

export const useTabsStore = defineStore('tabs', () => {
  const activePath = ref('/')
  const tabs = ref<AppTab[]>([])
  const refreshVersion = ref(0)
  const refreshingPath = ref<string | null>(null)

  const cachedRouteNames = computed(() => [...new Set(
    tabs.value
      .filter(tab => tab.keepAlive)
      .map(tab => tab.name),
  )])

  function findTabIndex(path: string): number {
    const pathname = tabPathname(path)
    return tabs.value.findIndex(tab => tabPathname(tab.fullPath) === pathname)
  }

  function open(tab: AppTab): void {
    const next = {
      ...tab,
      fullPath: tabPathname(tab.fullPath),
    }
    const index = findTabIndex(next.fullPath)
    if (index === -1) {
      tabs.value.push(next)
    }
    else {
      const currentTab = tabs.value[index]
      tabs.value[index] = {
        ...next,
        affix: currentTab?.affix || next.affix,
        pinned: currentTab?.pinned ?? next.pinned,
        closable: currentTab?.affix || currentTab?.pinned ? false : next.closable,
      }
    }
    activePath.value = next.fullPath
  }

  function close(path: string): string {
    const index = findTabIndex(path)
    const target = tabs.value[index]
    if (index < 0 || !target || isProtected(target)) {
      return activePath.value
    }

    tabs.value.splice(index, 1)
    if (tabPathname(activePath.value) === tabPathname(path)) {
      activePath.value = resolveAdjacentPath(tabs.value, index)
    }
    return activePath.value
  }

  function closeCurrent(): string {
    return close(activePath.value)
  }

  function closeAll(): string {
    const preserved = tabs.value.filter(isProtected)
    tabs.value = preserved
    activePath.value = preserved[0]?.fullPath || '/'
    return activePath.value
  }

  function closeOthers(path: string): string {
    const target = tabs.value[findTabIndex(path)]
    if (!target) {
      return activePath.value
    }
    const pathname = tabPathname(path)
    tabs.value = tabs.value.filter(tab => isProtected(tab) || tabPathname(tab.fullPath) === pathname)
    activePath.value = target.fullPath
    return activePath.value
  }

  function closeLeft(path: string): string {
    const index = findTabIndex(path)
    const target = tabs.value[index]
    if (index < 0 || !target) {
      return activePath.value
    }
    tabs.value = tabs.value.filter((tab, tabIndex) => isProtected(tab) || tabIndex >= index)
    activePath.value = target.fullPath
    return activePath.value
  }

  function closeRight(path: string): string {
    const index = findTabIndex(path)
    const target = tabs.value[index]
    if (index < 0 || !target) {
      return activePath.value
    }
    tabs.value = tabs.value.filter((tab, tabIndex) => isProtected(tab) || tabIndex <= index)
    activePath.value = target.fullPath
    return activePath.value
  }

  function pin(path: string): void {
    const target = tabs.value[findTabIndex(path)]
    if (target && !target.affix) {
      target.pinned = true
      target.closable = false
    }
  }

  function unpin(path: string): void {
    const target = tabs.value[findTabIndex(path)]
    if (target && !target.affix) {
      target.pinned = false
      target.closable = true
    }
  }

  function move(path: string, targetIndex: number): void {
    const sourceIndex = findTabIndex(path)
    const source = tabs.value[sourceIndex]
    if (sourceIndex < 0 || !source || source.affix) {
      return
    }

    const boundedIndex = Math.max(0, Math.min(targetIndex, tabs.value.length - 1))
    if (sourceIndex === boundedIndex) {
      return
    }
    tabs.value.splice(sourceIndex, 1)
    tabs.value.splice(Math.min(boundedIndex, tabs.value.length), 0, source)
  }

  function refresh(path = activePath.value): number {
    const target = tabs.value[findTabIndex(path)]
    if (!target) {
      return refreshVersion.value
    }
    activePath.value = target.fullPath
    refreshingPath.value = target.fullPath
    refreshVersion.value += 1
    return refreshVersion.value
  }

  function completeRefresh(path: string): void {
    if (refreshingPath.value && tabPathname(refreshingPath.value) === tabPathname(path)) {
      refreshingPath.value = null
    }
  }

  function prune(
    validRouteNames: ReadonlySet<string>,
    validRoutePaths: ReadonlySet<string>,
  ): string {
    const previousTabs = tabs.value
    const previousActiveIndex = previousTabs.findIndex(tab => tabPathname(tab.fullPath) === tabPathname(activePath.value))
    const isAvailable = (tab: AppTab): boolean => {
      return validRouteNames.has(tab.name) && validRoutePaths.has(tabPathname(tab.fullPath))
    }
    tabs.value = previousTabs.filter(isAvailable)

    if (!tabs.value.some(tab => tabPathname(tab.fullPath) === tabPathname(activePath.value))) {
      activePath.value = resolveAdjacentPath(
        tabs.value,
        Math.min(Math.max(previousActiveIndex, 0), tabs.value.length - 1),
      )
    }
    return activePath.value
  }

  function reset(): void {
    activePath.value = '/'
    refreshingPath.value = null
    refreshVersion.value = 0
    tabs.value = []
  }

  return {
    activePath,
    cachedRouteNames,
    close,
    closeAll,
    closeCurrent,
    closeLeft,
    closeOthers,
    closeRight,
    completeRefresh,
    move,
    open,
    pin,
    prune,
    refresh,
    refreshVersion,
    refreshingPath,
    reset,
    tabs,
    unpin,
  }
})

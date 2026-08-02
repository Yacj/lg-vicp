import type { Router, RouteRecordRaw } from 'vue-router'
import type { BackendMenuNode, MenuProjectionIssue, SidebarMenuItem } from '@/types/menu'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchDynamicRouters } from '@/api/modules/menus'
import {
  findMenuById,
  findMenuGroup,
  firstNavigableTarget,
  projectDynamicMenus,
} from '@/router/dynamic-routes'
import { useTabsStore } from './tabs'

export interface RouteStoreRefreshResult {
  currentRouteRemoved: boolean
  fallbackPath: string | null
  issues: MenuProjectionIssue[]
}

function routeNameOf(route: RouteRecordRaw): string | null {
  return typeof route.name === 'string' ? route.name : null
}

function firstInternalPath(item: SidebarMenuItem | null | undefined): string | null {
  if (!item) {
    return null
  }
  const target = firstNavigableTarget(item)
  if (target?.kind === 'internal') {
    return target.path
  }
  for (const child of item.children) {
    const path = firstInternalPath(child)
    if (path) {
      return path
    }
  }
  return null
}

export const useRouteStore = defineStore('route', () => {
  const rawMenus = ref<BackendMenuNode[]>([])
  const dynamicRoutes = ref<RouteRecordRaw[]>([])
  const sidebarMenus = ref<SidebarMenuItem[]>([])
  const buttonPermissions = ref<string[]>([])
  const projectionIssues = ref<MenuProjectionIssue[]>([])
  const dynamicRoutesReady = ref(false)

  const removeRouteHandlers: Array<() => void> = []
  let initializationPromise: Promise<void> | null = null
  let refreshPromise: Promise<RouteStoreRefreshResult> | null = null

  function removeRegisteredRoutes(): void {
    while (removeRouteHandlers.length > 0) {
      removeRouteHandlers.pop()?.()
    }
  }

  function registerProjection(
    router: Router,
    result: { routers: BackendMenuNode[], permissions: string[] },
  ): void {
    const projection = projectDynamicMenus(result.routers)

    removeRegisteredRoutes()
    for (const route of projection.routes) {
      removeRouteHandlers.push(router.addRoute('AdminRoot', route))
    }

    rawMenus.value = result.routers
    dynamicRoutes.value = projection.routes
    sidebarMenus.value = projection.sidebarMenus
    buttonPermissions.value = [...new Set([...result.permissions, ...projection.buttonPermissions])]
    projectionIssues.value = projection.issues
    dynamicRoutesReady.value = true
  }

  async function initialize(router: Router): Promise<void> {
    if (dynamicRoutesReady.value) {
      return
    }
    if (refreshPromise) {
      await refreshPromise
      return
    }
    if (initializationPromise) {
      return initializationPromise
    }

    initializationPromise = (async () => {
      const result = await fetchDynamicRouters()
      registerProjection(router, result)
    })().finally(() => {
      initializationPromise = null
    })

    return initializationPromise
  }

  async function refresh(router: Router): Promise<RouteStoreRefreshResult> {
    if (refreshPromise) {
      return refreshPromise
    }

    refreshPromise = (async () => {
      const currentRoute = router.currentRoute.value
      const previousGroup = findMenuGroup(sidebarMenus.value, currentRoute.path)
      const previousDynamicRoutes = new Map(
        dynamicRoutes.value
          .map(route => ({ name: routeNameOf(route), route }))
          .filter((entry): entry is { name: string, route: RouteRecordRaw } => entry.name !== null)
          .map(entry => [entry.name, entry.route] as const),
      )
      const result = await fetchDynamicRouters()
      registerProjection(router, result)

      const currentRouteName = typeof currentRoute.name === 'string' ? currentRoute.name : null
      const previousCurrentRoute = currentRouteName ? previousDynamicRoutes.get(currentRouteName) : undefined
      const currentRouteRemoved = previousCurrentRoute !== undefined
        && !dynamicRoutes.value.some(route => routeNameOf(route) === currentRouteName
          && route.path === currentRoute.path)

      const tabsStore = useTabsStore()
      const availableRouteNames = new Set(
        router.getRoutes()
          .map(route => route.name)
          .filter((name): name is string => typeof name === 'string'),
      )
      const availableRoutePaths = new Set(router.getRoutes().map(route => route.path))
      tabsStore.prune(availableRouteNames, availableRoutePaths)

      if (!currentRouteRemoved) {
        return {
          currentRouteRemoved: false,
          fallbackPath: null,
          issues: projectionIssues.value,
        }
      }

      const nextGroup = previousGroup
        ? findMenuById(sidebarMenus.value, previousGroup.id)
        : findMenuGroup(sidebarMenus.value, currentRoute.path)
      const fallbackPath = firstInternalPath(nextGroup)
        ?? firstInternalPath(sidebarMenus.value[0])
        ?? '/'

      if (fallbackPath !== currentRoute.fullPath) {
        await router.replace(fallbackPath)
      }

      return {
        currentRouteRemoved: true,
        fallbackPath,
        issues: projectionIssues.value,
      }
    })().finally(() => {
      refreshPromise = null
    })

    return refreshPromise
  }

  function reset(router?: Router): void {
    if (router) {
      removeRegisteredRoutes()
    }
    rawMenus.value = []
    dynamicRoutes.value = []
    sidebarMenus.value = []
    buttonPermissions.value = []
    projectionIssues.value = []
    dynamicRoutesReady.value = false
  }

  return {
    buttonPermissions,
    dynamicRoutes,
    dynamicRoutesReady,
    initialize,
    projectionIssues,
    rawMenus,
    refresh,
    reset,
    sidebarMenus,
  }
})
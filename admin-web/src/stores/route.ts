import type { Router, RouteRecordRaw } from 'vue-router'
import type { BackendMenuNode, MenuProjectionIssue, SidebarMenuItem } from '@/types/menu'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchDynamicRouters } from '@/api/modules/menus'
import { projectDynamicMenus } from '@/router/dynamic-routes'

export const useRouteStore = defineStore('route', () => {
  const rawMenus = ref<BackendMenuNode[]>([])
  const dynamicRoutes = ref<RouteRecordRaw[]>([])
  const sidebarMenus = ref<SidebarMenuItem[]>([])
  const buttonPermissions = ref<string[]>([])
  const projectionIssues = ref<MenuProjectionIssue[]>([])
  const dynamicRoutesReady = ref(false)

  const removeRouteHandlers: Array<() => void> = []
  let initializationPromise: Promise<void> | null = null

  function removeRegisteredRoutes(): void {
    while (removeRouteHandlers.length > 0) {
      removeRouteHandlers.pop()?.()
    }
  }

  async function initialize(router: Router): Promise<void> {
    if (dynamicRoutesReady.value) {
      return
    }
    if (initializationPromise) {
      return initializationPromise
    }

    initializationPromise = (async () => {
      const result = await fetchDynamicRouters()
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
    })().finally(() => {
      initializationPromise = null
    })

    return initializationPromise
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
    reset,
    sidebarMenus,
  }
})

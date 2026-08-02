import type { MenuNavigationTarget, SidebarMenuItem } from '@/types/menu'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  findMenuGroup,
  findMenuPath,
  firstNavigableTarget,
  navigateMenuTarget,
  projectContextMenus,
  projectPrimaryMenus,
  withHomeMenu,
} from '@/router/dynamic-routes'
import { useRouteStore } from '@/stores/route'

export function useShellNavigation() {
  const routeStore = useRouteStore()
  const route = useRoute()
  const router = useRouter()

  const fullMenus = computed(() => withHomeMenu(routeStore.sidebarMenus))
  const primaryMenus = computed(() => projectPrimaryMenus(fullMenus.value))
  const activePrimaryMenu = computed(() => findMenuGroup(primaryMenus.value, route.path))
  const contextMenus = computed(() => projectContextMenus(primaryMenus.value, route.path))
  const currentModuleTitle = computed(() => activePrimaryMenu.value?.title ?? '')
  /** 当前路由的完整菜单链，首项为顶层菜单（含工作台），末项为当前页 */
  const breadcrumbItems = computed(() => findMenuPath(fullMenus.value, route.path))

  function resolveMenuTarget(item: SidebarMenuItem): MenuNavigationTarget | null {
    return firstNavigableTarget(item)
  }

  function activateMenu(item: SidebarMenuItem): void {
    const target = resolveMenuTarget(item)
    if (target) {
      navigateMenuTarget(target, router)
    }
  }

  function navigate(target: MenuNavigationTarget): void {
    navigateMenuTarget(target, router)
  }

  return {
    activateMenu,
    activePrimaryMenu,
    breadcrumbItems,
    contextMenus,
    currentModuleTitle,
    fullMenus,
    navigate,
    primaryMenus,
    resolveMenuTarget,
  }
}

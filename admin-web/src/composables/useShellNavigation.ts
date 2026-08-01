import type { SidebarMenuItem } from '@/types/menu'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  findMenuGroup,
  firstNavigablePath,
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

  function resolveMenuTarget(item: SidebarMenuItem): string | null {
    return firstNavigablePath(item)
  }

  function activateMenu(item: SidebarMenuItem): void {
    const target = resolveMenuTarget(item)
    if (target) {
      void router.push(target)
    }
  }

  function navigate(path: string): void {
    if (path.startsWith('/')) {
      void router.push(path)
    }
  }

  return {
    activateMenu,
    activePrimaryMenu,
    contextMenus,
    currentModuleTitle,
    fullMenus,
    navigate,
    primaryMenus,
    resolveMenuTarget,
  }
}

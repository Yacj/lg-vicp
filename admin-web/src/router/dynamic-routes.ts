import type { Router, RouteRecordRaw } from 'vue-router'
import type {
  BackendMenuNode,
  MenuNavigationTarget,
  MenuProjectionIssue,
  SidebarMenuItem,
} from '@/types/menu'
import { deriveMenuRouteName, isHttpUrl, isInternalRoutePath } from '@/utils/system-menu'
import { resolveDynamicComponent } from './component-map'

export interface DynamicMenuProjection {
  buttonPermissions: string[]
  issues: MenuProjectionIssue[]
  routes: RouteRecordRaw[]
  sidebarMenus: SidebarMenuItem[]
}

function routeName(menuId: string): string {
  return deriveMenuRouteName(menuId)
}

function matchesPath(item: SidebarMenuItem, pathname: string): boolean {
  if (item.path && (pathname === item.path || pathname.startsWith(`${item.path}/`))) {
    return true
  }
  return item.children.some(child => matchesPath(child, pathname))
}

function targetForInternalPath(path: string): MenuNavigationTarget {
  return { kind: 'internal', path }
}

function targetForExternalPath(href: string): MenuNavigationTarget {
  return { href, kind: 'external' }
}

export function navigateMenuTarget(
  target: MenuNavigationTarget,
  router: Pick<Router, 'push'>,
): void {
  if (target.kind === 'external') {
    if (isHttpUrl(target.href)) {
      globalThis.window?.open(target.href, '_blank', 'noopener,noreferrer')
    }
    return
  }
  void router.push(target.path)
}

function createIssue(
  node: BackendMenuNode,
  reason: MenuProjectionIssue['reason'],
): MenuProjectionIssue {
  return {
    component: node.component,
    menuId: node.id,
    menuName: node.name,
    reason,
  }
}

export const HOME_MENU_ITEM: SidebarMenuItem = {
  children: [],
  icon: 'home',
  id: 'static-home',
  path: '/',
  target: targetForInternalPath('/'),
  title: '工作台',
  type: 'MENU',
}

export function withHomeMenu(menus: readonly SidebarMenuItem[]): SidebarMenuItem[] {
  return menus.some(menu => menu.target?.kind === 'internal'
    ? menu.target.path === '/'
    : !menu.target && menu.path === '/')
    ? [...menus]
    : [HOME_MENU_ITEM, ...menus]
}

export function firstNavigableTarget(item: SidebarMenuItem): MenuNavigationTarget | null {
  if (item.target) {
    return item.target
  }
  for (const child of item.children) {
    const childTarget = firstNavigableTarget(child)
    if (childTarget) {
      return childTarget
    }
  }
  return null
}

export function firstNavigablePath(item: SidebarMenuItem): string | null {
  const target = firstNavigableTarget(item)
  return target?.kind === 'internal' ? target.path : null
}

export function flattenNavigableMenus(
  menus: readonly SidebarMenuItem[],
): SidebarMenuItem[] {
  return menus.flatMap(item => [
    ...(firstNavigableTarget(item) && item.type === 'MENU' ? [item] : []),
    ...flattenNavigableMenus(item.children),
  ])
}

export function flattenMenuItems(
  menus: readonly SidebarMenuItem[],
): SidebarMenuItem[] {
  return menus.flatMap(item => [item, ...flattenMenuItems(item.children)])
}

export function findMenuById(
  menus: readonly SidebarMenuItem[],
  id: string,
): SidebarMenuItem | null {
  return flattenMenuItems(menus).find(item => item.id === id) ?? null
}

export function findMenuGroup(
  menus: readonly SidebarMenuItem[],
  pathname: string,
): SidebarMenuItem | null {
  return menus.find(menu => matchesPath(menu, pathname)) ?? null
}

/**
 * 按路径返回从根到叶子的完整菜单链（面包屑数据源）。
 * 未命中时返回空数组；命中时首项为顶层菜单，末项为路径归属菜单。
 */
export function findMenuPath(
  menus: readonly SidebarMenuItem[],
  pathname: string,
): SidebarMenuItem[] {
  for (const menu of menus) {
    if (matchesPath(menu, pathname)) {
      return [menu, ...findMenuPath(menu.children, pathname)]
    }
  }
  return []
}

export function projectPrimaryMenus(
  menus: readonly SidebarMenuItem[],
): SidebarMenuItem[] {
  return [...menus]
}

export function projectContextMenus(
  menus: readonly SidebarMenuItem[],
  pathname: string,
): SidebarMenuItem[] {
  return (findMenuGroup(menus, pathname)?.children ?? [])
    .filter(item => firstNavigableTarget(item) !== null)
}

function projectMenuNode(
  node: BackendMenuNode,
  issues: MenuProjectionIssue[],
  routes: RouteRecordRaw[],
  buttonPermissions: Set<string>,
  routePaths: Map<string, string>,
  routeNames: Map<string, string>,
): SidebarMenuItem | null {
  if (!node.visible) {
    return null
  }
  if (node.menuType === 'BUTTON') {
    if (node.permissionCode) {
      buttonPermissions.add(node.permissionCode)
    }
    return null
  }

  const children = node.children
    .map(child => projectMenuNode(child, issues, routes, buttonPermissions, routePaths, routeNames))
    .filter((child): child is SidebarMenuItem => child !== null)

  if (node.menuType === 'DIRECTORY') {
    if (node.isExternal || (node.routePath && !isInternalRoutePath(node.routePath))) {
      issues.push(createIssue(node, 'INVALID_PATH'))
      return children.length > 0
        ? {
            children,
            icon: node.icon,
            id: node.id,
            path: null,
            target: null,
            title: node.name,
            type: node.menuType,
          }
        : null
    }
    return {
      children,
      icon: node.icon,
      id: node.id,
      path: node.routePath,
      target: null,
      title: node.name,
      type: node.menuType,
    }
  }

  if (node.isExternal) {
    if (!isHttpUrl(node.routePath)) {
      issues.push(createIssue(node, 'INVALID_EXTERNAL_URL'))
      return null
    }
    return {
      children,
      icon: node.icon,
      id: node.id,
      path: null,
      target: targetForExternalPath(node.routePath),
      title: node.name,
      type: node.menuType,
    }
  }
  if (!isInternalRoutePath(node.routePath)) {
    issues.push(createIssue(node, node.routePath ? 'INVALID_PATH' : 'MISSING_PATH'))
    return null
  }
  if (!node.component) {
    issues.push(createIssue(node, 'MISSING_COMPONENT'))
    return null
  }

  const component = resolveDynamicComponent(node.component)
  if (!component) {
    issues.push(createIssue(node, 'UNKNOWN_COMPONENT'))
    return null
  }

  const existingPathOwner = routePaths.get(node.routePath)
  if (existingPathOwner) {
    issues.push(createIssue(node, 'DUPLICATE_PATH'))
    return null
  }
  routePaths.set(node.routePath, node.id)

  const generatedName = routeName(node.id)
  const existingNameOwner = routeNames.get(generatedName)
  if (existingNameOwner) {
    issues.push(createIssue(node, 'DUPLICATE_ROUTE_NAME'))
    return null
  }
  routeNames.set(generatedName, node.id)

  routes.push({
    path: node.routePath,
    name: generatedName,
    component,
    meta: {
      dynamic: true,
      keepAlive: true,
      permissions: node.permissionCode ? [node.permissionCode] : [],
      title: node.name,
    },
  })

  return {
    children,
    icon: node.icon,
    id: node.id,
    path: node.routePath,
    target: targetForInternalPath(node.routePath),
    title: node.name,
    type: node.menuType,
  }
}

export function projectDynamicMenus(nodes: BackendMenuNode[]): DynamicMenuProjection {
  const issues: MenuProjectionIssue[] = []
  const routes: RouteRecordRaw[] = []
  const buttonPermissions = new Set<string>()
  const routePaths = new Map<string, string>()
  const routeNames = new Map<string, string>()
  const sidebarMenus = nodes
    .map(node => projectMenuNode(node, issues, routes, buttonPermissions, routePaths, routeNames))
    .filter((node): node is SidebarMenuItem => node !== null)

  return {
    buttonPermissions: [...buttonPermissions],
    issues,
    routes,
    sidebarMenus,
  }
}

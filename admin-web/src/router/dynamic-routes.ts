import type { RouteRecordRaw } from 'vue-router'
import type {
  BackendMenuNode,
  MenuProjectionIssue,
  SidebarMenuItem,
} from '@/types/menu'
import { resolveDynamicComponent } from './component-map'

export interface DynamicMenuProjection {
  buttonPermissions: string[]
  issues: MenuProjectionIssue[]
  routes: RouteRecordRaw[]
  sidebarMenus: SidebarMenuItem[]
}

function routeName(menuId: string): string {
  return `Dynamic_${menuId.replace(/\W/g, '_')}`
}

function matchesPath(item: SidebarMenuItem, pathname: string): boolean {
  if (item.path && (pathname === item.path || pathname.startsWith(`${item.path}/`))) {
    return true
  }
  return item.children.some(child => matchesPath(child, pathname))
}

export const HOME_MENU_ITEM: SidebarMenuItem = {
  children: [],
  icon: 'home',
  id: 'static-home',
  path: '/',
  title: '工作台',
  type: 'MENU',
}

export function withHomeMenu(menus: readonly SidebarMenuItem[]): SidebarMenuItem[] {
  return menus.some(menu => menu.path === '/')
    ? [...menus]
    : [HOME_MENU_ITEM, ...menus]
}

export function firstNavigablePath(item: SidebarMenuItem): string | null {
  for (const child of item.children) {
    const childPath = firstNavigablePath(child)
    if (childPath) {
      return childPath
    }
  }
  return item.type === 'MENU' ? item.path : null
}

export function flattenNavigableMenus(
  menus: readonly SidebarMenuItem[],
): SidebarMenuItem[] {
  return menus.flatMap(item => [
    ...(item.type === 'MENU' && item.path ? [item] : []),
    ...flattenNavigableMenus(item.children),
  ])
}

export function findMenuGroup(
  menus: readonly SidebarMenuItem[],
  pathname: string,
): SidebarMenuItem | null {
  return menus.find(menu => matchesPath(menu, pathname)) ?? null
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
    .filter(item => firstNavigablePath(item) !== null)
}

function projectMenuNode(
  node: BackendMenuNode,
  issues: MenuProjectionIssue[],
  routes: RouteRecordRaw[],
  buttonPermissions: Set<string>,
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
    .map(child => projectMenuNode(child, issues, routes, buttonPermissions))
    .filter((child): child is SidebarMenuItem => child !== null)

  if (node.menuType === 'DIRECTORY') {
    return {
      children,
      icon: node.icon,
      id: node.id,
      path: node.routePath,
      title: node.name,
      type: node.menuType,
    }
  }

  if (node.isExternal) {
    issues.push({ component: node.component, menuId: node.id, menuName: node.name, reason: 'EXTERNAL_ROUTE' })
    return children.length > 0
      ? { children, icon: node.icon, id: node.id, path: null, title: node.name, type: node.menuType }
      : null
  }
  if (!node.routePath?.startsWith('/')) {
    issues.push({ component: node.component, menuId: node.id, menuName: node.name, reason: 'INVALID_PATH' })
    return null
  }
  if (!node.component) {
    issues.push({ component: null, menuId: node.id, menuName: node.name, reason: 'MISSING_COMPONENT' })
    return null
  }

  const component = resolveDynamicComponent(node.component)
  if (!component) {
    issues.push({ component: node.component, menuId: node.id, menuName: node.name, reason: 'UNKNOWN_COMPONENT' })
    return null
  }

  routes.push({
    path: node.routePath,
    name: routeName(node.id),
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
    title: node.name,
    type: node.menuType,
  }
}

export function projectDynamicMenus(nodes: BackendMenuNode[]): DynamicMenuProjection {
  const issues: MenuProjectionIssue[] = []
  const routes: RouteRecordRaw[] = []
  const buttonPermissions = new Set<string>()
  const sidebarMenus = nodes
    .map(node => projectMenuNode(node, issues, routes, buttonPermissions))
    .filter((node): node is SidebarMenuItem => node !== null)

  return {
    buttonPermissions: [...buttonPermissions],
    issues,
    routes,
    sidebarMenus,
  }
}

import type { Router, RouteRecordRaw } from 'vue-router'
import type {
  BackendMenuNode,
  MenuNavigationTarget,
  MenuProjectionIssue,
  SidebarMenuItem,
} from '@/types/menu'
import { hasAnyPermission } from '@/permissions/rbac'
import { deriveMenuRouteName, isHttpUrl, isInternalRoutePath } from '@/utils/system-menu'
import { resolveDynamicComponent } from './component-map'
import { STATIC_OWNED_PATHS } from './routes'

export interface DynamicMenuProjection {
  buttonPermissions: string[]
  issues: MenuProjectionIssue[]
  routes: RouteRecordRaw[]
  sidebarMenus: SidebarMenuItem[]
}

/**
 * 后端历史 routePath → 前端新任务入口。
 * 菜单导航改指新入口；旧路径注册为 redirect，收藏链接、通知链接等仍可直达。
 * 命中该映射的菜单不再要求 component 可解析（redirect 优先于组件解析）。
 */
export const LEGACY_PATH_REDIRECTS: Readonly<Record<string, string>> = Object.freeze({
  '/project': '/projects',
  '/reports/center': '/reports',
  '/content/profile': '/system/enterprise',
  '/content/certificates': '/system/enterprise',
  '/collection/manual': '/collection',
  '/collection/sources': '/collection',
  '/collection/tasks': '/collection',
  '/collection/dashboard': '/collection',
  '/collection/skills': '/collection',
  '/collection/records': '/collection',
  '/ai-config/prompt': '/ai-config/business-prompts',
})

/** 后端仍可能下发分子页的目录；侧栏收成单一入口，子路由仍注册以免旧链接 404。 */
export const UNIFIED_DIRECTORY_TARGETS: Readonly<Record<string, string>> = Object.freeze({
  '/system/enterprise': '/system/enterprise',
  '/collection': '/collection',
})

/**
 * 普通侧栏不再展示的路径前缀。
 * 产品与计算只保留产品管理 / 产品对比 / 热工计算；旧参数体系与技术 Prompt 页隐藏。
 * 超级管理员已并入用户管理，不再单独入口。
 */
export const ORDINARY_HIDDEN_SIDEBAR_PATH_PREFIXES: readonly string[] = [
  '/knowledge/crawlers',
  '/masterdata',
  '/construction',
  '/nodes',
  '/comparison',
  '/thermal/sets',
  '/thermal/calc-rules',
  '/products/catalog',
  '/products/materials',
  '/products/construction',
  '/products/thermal',
  '/products/nodes',
  '/products/comparison',
  '/products/series',
  '/products/parameters',
  '/products/specs',
  '/products/attachments',
  '/thermal/candidates',
  '/thermal/standard-limits',
  '/thermal/calc-records',
  '/system/admins',
  '/ai-config/providers',
  '/ai-config/filters',
  '/ai-config/scenes',
  '/ai-config/prompts',
]

export const ORDINARY_HIDDEN_SIDEBAR_TITLES: ReadonlySet<string> = new Set([
  '材料参数',
  '构造体系',
  '节点图库',
  '产品热工数据',
  '材料对比配置',
  '资料采集源',
  '资料抓取',
  '超级管理员',
  '服务商管理',
  '场景配置',
  '提示词管理',
  '关键词过滤',
  '内容安全',
])

export const SIDEBAR_TITLE_OVERRIDES: Readonly<Record<string, string>> = {
  '产品中心': '产品与计算',
  '业务提示词': '提示词配置',
  '模型管理': '模型配置',
  // 后端菜单仍以旧名称下发，前端统一展示为业务名称，避免暴露内部术语。
  'Agent设置': '高级设置',
}

const PRIMARY_MENU_ORDER: readonly string[] = [
  '/system/user',
  '/projects',
  '/project',
  '/products',
  '/knowledge',
  '/collection',
  '/reports',
  '/ai-config',
  '/ai-ops',
  '/system',
]

function matchesHiddenPath(path: string | null): boolean {
  if (!path) {
    return false
  }
  return ORDINARY_HIDDEN_SIDEBAR_PATH_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
}

function isOrdinaryHiddenSidebarItem(item: SidebarMenuItem): boolean {
  return matchesHiddenPath(item.path) || ORDINARY_HIDDEN_SIDEBAR_TITLES.has(item.title)
}

function applySidebarTitleOverrides(items: readonly SidebarMenuItem[]): SidebarMenuItem[] {
  return items.map(item => ({
    ...item,
    title: SIDEBAR_TITLE_OVERRIDES[item.title] ?? item.title,
    children: applySidebarTitleOverrides(item.children),
  }))
}

function primaryMenuOrderIndex(path: string | null): number {
  if (!path) {
    return PRIMARY_MENU_ORDER.length + 1
  }
  const index = PRIMARY_MENU_ORDER.indexOf(path)
  return index >= 0 ? index : PRIMARY_MENU_ORDER.length
}

function liftUserManagementMenu(items: readonly SidebarMenuItem[]): SidebarMenuItem[] {
  let userMenu: SidebarMenuItem | null = null
  const next = items.map((item) => {
    if (item.path !== '/system') {
      return item
    }
    const found = item.children.find(child => child.path === '/system/user')
    if (!found) {
      return item
    }
    userMenu = found
    return {
      ...item,
      children: item.children.filter(child => child.path !== '/system/user'),
    }
  })
  if (!userMenu) {
    return [...next]
  }
  return [userMenu, ...next]
}

function sortPrimaryMenus(items: readonly SidebarMenuItem[]): SidebarMenuItem[] {
  return [...items].sort((left, right) => primaryMenuOrderIndex(left.path) - primaryMenuOrderIndex(right.path))
}

function filterOrdinarySidebarMenus(items: readonly SidebarMenuItem[]): SidebarMenuItem[] {
  return items.flatMap((item) => {
    if (isOrdinaryHiddenSidebarItem(item)) {
      return []
    }
    return [{
      ...item,
      children: filterOrdinarySidebarMenus(item.children),
    }]
  })
}

export const PRODUCTS_CALC_MENU_ORDER: readonly string[] = [
  '/products/manage',
  '/products/compare',
  '/thermal/calc',
]

function routeName(menuId: string): string {
  return deriveMenuRouteName(menuId)
}

function matchesPath(item: SidebarMenuItem, pathname: string): boolean {
  if (selfPathScore(item.path, pathname) >= 0) {
    return true
  }
  return item.children.some(child => matchesPath(child, pathname))
}

/** 精确匹配优先于前缀；更长的路径优先于更短的前缀（避免 /reports 抢走 /reports/settings）。 */
function selfPathScore(itemPath: string | null, pathname: string): number {
  if (!itemPath) {
    return -1
  }
  if (pathname === itemPath) {
    return itemPath.length * 2 + 1
  }
  if (pathname.startsWith(`${itemPath}/`)) {
    return itemPath.length * 2
  }
  return -1
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

/**
 * 隐藏菜单保持兼容策略：页面未实现或配置异常时静默跳过（不产生投影噪音），
 * 等前端补齐组件后随菜单数据自动生效。
 */
function reportIssue(
  node: BackendMenuNode,
  issues: MenuProjectionIssue[],
  reason: MenuProjectionIssue['reason'],
): void {
  if (node.visible) {
    issues.push(createIssue(node, reason))
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

/**
 * 侧栏仍以后端 getRouters 为准；这里只补后端种子尚未下发、但前端已有静态页的叶子。
 * 后端补齐同路径菜单后自动跳过，避免重复。
 */
export interface StaticSidebarExtra {
  id: string
  parentPath: string
  parentTitle: string
  path: string
  title: string
  permissions: readonly string[]
  insertAfter: readonly string[]
}

function sortProductsCalcMenus(items: readonly SidebarMenuItem[]): SidebarMenuItem[] {
  return items.map((item) => {
    const children = sortProductsCalcMenus(item.children)
    if (item.path !== '/products') {
      return children === item.children ? item : { ...item, children }
    }
    const rank = (path: string | null): number => {
      const index = PRODUCTS_CALC_MENU_ORDER.indexOf(path ?? '')
      return index >= 0 ? index : PRODUCTS_CALC_MENU_ORDER.length
    }
    return {
      ...item,
      children: [...children].sort((left, right) => rank(left.path) - rank(right.path)),
    }
  })
}

export function sanitizeOrdinarySidebarMenus(items: readonly SidebarMenuItem[]): SidebarMenuItem[] {
  return sortProductsCalcMenus(
    sortPrimaryMenus(liftUserManagementMenu(applySidebarTitleOverrides(filterOrdinarySidebarMenus(items)))),
  )
}

export const STATIC_SIDEBAR_EXTRAS: readonly StaticSidebarExtra[] = [
  {
    id: 'static-products-manage',
    insertAfter: [],
    parentPath: '/products',
    parentTitle: '产品与计算',
    path: '/products/manage',
    permissions: ['system:md:product:list'],
    title: '产品管理',
  },
  {
    id: 'static-products-compare',
    insertAfter: ['/products/manage'],
    parentPath: '/products',
    parentTitle: '产品与计算',
    path: '/products/compare',
    permissions: ['system:md:product:list'],
    title: '产品对比',
  },
  {
    id: 'static-thermal-calc',
    insertAfter: ['/products/compare', '/products/manage'],
    parentPath: '/products',
    parentTitle: '产品与计算',
    path: '/thermal/calc',
    permissions: ['system:thermal:list'],
    title: '热工计算',
  },
  {
    id: 'static-ai-config-business-prompts',
    insertAfter: ['/ai-config/quick-prompts'],
    parentPath: '/ai-config',
    parentTitle: 'AI 配置',
    path: '/ai-config/business-prompts',
    permissions: ['system:ai:prompt:list'],
    title: '提示词配置',
  },
  {
    id: 'static-ai-config-advanced',
    insertAfter: ['/ai-config/business-prompts', '/ai-config/quick-prompts', '/ai-config/models'],
    parentPath: '/ai-config',
    parentTitle: 'AI 配置',
    path: '/ai-config/advanced',
    permissions: ['system:ai:model:edit', 'system:ai:debug:use'],
    title: '高级设置',
  },
]

function collectSidebarPaths(items: readonly SidebarMenuItem[]): Set<string> {
  return new Set(flattenMenuItems(items).flatMap(item => item.path ? [item.path] : []))
}

function toStaticSidebarItem(extra: StaticSidebarExtra): SidebarMenuItem {
  return {
    children: [],
    icon: null,
    id: extra.id,
    path: extra.path,
    target: targetForInternalPath(extra.path),
    title: extra.title,
    type: 'MENU',
  }
}

function insertSidebarChild(
  children: readonly SidebarMenuItem[],
  item: SidebarMenuItem,
  insertAfter: readonly string[],
): SidebarMenuItem[] {
  if (children.some(child => child.path === item.path)) {
    return [...children]
  }
  let index = children.length
  for (const after of insertAfter) {
    const found = children.findIndex(child => child.path === after)
    if (found >= 0) {
      index = found + 1
      break
    }
  }
  return [...children.slice(0, index), item, ...children.slice(index)]
}

export function withStaticSidebarExtras(
  menus: readonly SidebarMenuItem[],
  grantedPermissions: Iterable<string>,
  isSuperAdmin = false,
): SidebarMenuItem[] {
  const existingPaths = collectSidebarPaths(menus)
  const allowed = STATIC_SIDEBAR_EXTRAS.filter(extra =>
    !existingPaths.has(extra.path)
    && hasAnyPermission(grantedPermissions, [...extra.permissions], isSuperAdmin),
  )
  if (allowed.length === 0) {
    return sortProductsCalcMenus(menus)
  }

  const inject = (items: readonly SidebarMenuItem[]): SidebarMenuItem[] =>
    items.map((item) => {
      const children = inject(item.children)
      const extrasHere = allowed.filter(extra => extra.parentPath === item.path)
      if (extrasHere.length === 0) {
        return children === item.children ? item : { ...item, children }
      }
      return {
        ...item,
        children: extrasHere.reduce(
          (next, extra) => insertSidebarChild(next, toStaticSidebarItem(extra), extra.insertAfter),
          children,
        ),
      }
    })

  let next = inject(menus)
  const presentPaths = collectSidebarPaths(next)
  const missingParents = [...new Map(
    allowed
      .filter(extra => !presentPaths.has(extra.parentPath))
      .map(extra => [extra.parentPath, extra] as const),
  ).values()]

  for (const parent of missingParents) {
    const children = allowed
      .filter(extra => extra.parentPath === parent.parentPath)
      .reduce(
        (nextChildren, extra) => insertSidebarChild(nextChildren, toStaticSidebarItem(extra), extra.insertAfter),
        [] as SidebarMenuItem[],
      )
    const directory: SidebarMenuItem = {
      children,
      icon: null,
      id: `static-dir-${parent.parentPath}`,
      path: parent.parentPath,
      target: null,
      title: parent.parentTitle,
      type: 'DIRECTORY',
    }
    const insertBefore = next.findIndex(item => item.path === '/system')
    next = insertBefore >= 0
      ? [...next.slice(0, insertBefore), directory, ...next.slice(insertBefore)]
      : [...next, directory]
  }

  return sortProductsCalcMenus(next)
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
  let bestChain: SidebarMenuItem[] = []
  let bestScore = -1

  for (const menu of menus) {
    const childChain = findMenuPath(menu.children, pathname)
    if (childChain.length > 0) {
      const score = selfPathScore(childChain.at(-1)?.path ?? null, pathname)
      if (score > bestScore) {
        bestScore = score
        bestChain = [menu, ...childChain]
      }
      continue
    }

    const score = selfPathScore(menu.path, pathname)
    if (score > bestScore) {
      bestScore = score
      bestChain = [menu]
    }
  }

  return bestChain
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
  if (node.menuType === 'BUTTON') {
    if (node.permissionCode) {
      buttonPermissions.add(node.permissionCode)
    }
    return null
  }

  // 子节点先递归：隐藏子菜单仍注册路由（待办 / 详情 / 旧链接直达），只是不进入侧栏
  const children = node.children
    .map(child => projectMenuNode(child, issues, routes, buttonPermissions, routePaths, routeNames))
    .filter((child): child is SidebarMenuItem => child !== null)

  if (node.menuType === 'DIRECTORY') {
    const unifiedTarget = node.routePath ? UNIFIED_DIRECTORY_TARGETS[node.routePath] : undefined
    if (unifiedTarget) {
      if (!node.visible) {
        return null
      }
      return {
        children: [],
        icon: node.icon,
        id: node.id,
        path: unifiedTarget,
        target: targetForInternalPath(unifiedTarget),
        title: node.name,
        type: 'MENU',
      }
    }
    // 隐藏目录不进侧栏；其可见子菜单经路由匹配仍可达
    if (!node.visible) {
      return null
    }
    if (node.isExternal || (node.routePath && !isInternalRoutePath(node.routePath))) {
      reportIssue(node, issues, 'INVALID_PATH')
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
      reportIssue(node, issues, 'INVALID_EXTERNAL_URL')
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
    reportIssue(node, issues, node.routePath ? 'INVALID_PATH' : 'MISSING_PATH')
    return null
  }

  // 历史路径兼容：注册 redirect 路由，菜单导航改指新入口
  const redirectTarget = LEGACY_PATH_REDIRECTS[node.routePath]
  if (redirectTarget) {
    const existingRedirectOwner = routePaths.get(node.routePath)
    if (existingRedirectOwner) {
      reportIssue(node, issues, 'DUPLICATE_PATH')
      return null
    }
    routePaths.set(node.routePath, node.id)
    if (!STATIC_OWNED_PATHS.has(node.routePath)) {
      routes.push({
        path: node.routePath,
        name: routeName(node.id),
        redirect: redirectTarget,
        meta: {
          dynamic: true,
          title: node.name,
        },
      })
    }
    if (!node.visible) {
      return null
    }
    return {
      children,
      icon: node.icon,
      id: node.id,
      path: redirectTarget,
      target: targetForInternalPath(redirectTarget),
      title: node.name,
      type: node.menuType,
    }
  }

  if (!node.component) {
    reportIssue(node, issues, 'MISSING_COMPONENT')
    return null
  }

  const component = resolveDynamicComponent(node.component)
  if (!component) {
    reportIssue(node, issues, 'UNKNOWN_COMPONENT')
    return null
  }

  // 静态路由已承载同路径页面（同视图、同权限码）：复用静态路由，不重复注册
  if (STATIC_OWNED_PATHS.has(node.routePath)) {
    if (!node.visible) {
      return null
    }
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

  const existingPathOwner = routePaths.get(node.routePath)
  if (existingPathOwner) {
    reportIssue(node, issues, 'DUPLICATE_PATH')
    return null
  }
  routePaths.set(node.routePath, node.id)

  const generatedName = routeName(node.id)
  const existingNameOwner = routeNames.get(generatedName)
  if (existingNameOwner) {
    reportIssue(node, issues, 'DUPLICATE_ROUTE_NAME')
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
      ...(node.visible ? {} : { hidden: true }),
    },
  })

  // 隐藏菜单：路由可达，但不进入侧栏
  if (!node.visible) {
    return null
  }

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
  const sidebarMenus = sanitizeOrdinarySidebarMenus(
    nodes
      .map(node => projectMenuNode(node, issues, routes, buttonPermissions, routePaths, routeNames))
      .filter((node): node is SidebarMenuItem => node !== null),
  )

  return {
    buttonPermissions: [...buttonPermissions],
    issues,
    routes,
    sidebarMenus,
  }
}

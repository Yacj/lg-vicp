import type {
  SystemMenu,
  SystemMenuInput,
  SystemMenuTreeNode,
  SystemMenuType,
} from '@/types/system-management'
import { canonicalizeMenuIcon } from '@/components/ui/menu-icons'
import { normalizeDynamicComponentKey } from '@/router/component-map'

export interface MenuTreeOption {
  value: string
  label: string
  disabled?: boolean
  children?: MenuTreeOption[]
}

export interface SystemMenuForm extends Record<string, unknown> {
  parentId: string | undefined
  menuType: SystemMenuType
  name: string
  routePath: string
  component: string
  icon: string | null
  permissionCode: string
  sortOrder: number
  visible: boolean
  enabled: boolean
  isExternal: boolean
}

export type SystemMenuIssueCode =
  | 'DUPLICATE_ID'
  | 'DUPLICATE_PATH'
  | 'DUPLICATE_ROUTE_NAME'
  | 'INVALID_PERMISSION'
  | 'UNKNOWN_COMPONENT'
  | 'ORPHAN_PARENT'
  | 'PARENT_CYCLE'
  | 'INVALID_PARENT_TYPE'
  | 'BUTTON_ROOT'
  | 'INVALID_TYPE_FIELDS'
  | 'INVALID_SORT_ORDER'
  | 'INVALID_PATH'
  | 'MISSING_PATH'
  | 'MISSING_COMPONENT'
  | 'INVALID_EXTERNAL_URL'

export interface SystemMenuIssue {
  nodeId: string
  code: SystemMenuIssueCode
  message: string
  relatedId?: string
}

const menuTypeLabels: Record<SystemMenuType, string> = {
  BUTTON: '按钮',
  DIRECTORY: '目录',
  MENU: '菜单',
}

export function getMenuTypeLabel(type: SystemMenuType): string {
  return menuTypeLabels[type]
}

export function deriveMenuRouteName(menuId: string): string {
  return `Dynamic_${menuId.replace(/\W/g, '_')}`
}

export function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) {
    return false
  }
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
  }
  catch {
    return false
  }
}

export function isInternalRoutePath(value: string | null | undefined): value is string {
  return Boolean(value && value.startsWith('/') && !value.startsWith('//'))
}

function compareMenu(a: Pick<SystemMenu, 'sortOrder' | 'name' | 'id'>, b: Pick<SystemMenu, 'sortOrder' | 'name' | 'id'>): number {
  return a.sortOrder - b.sortOrder
    || a.name.localeCompare(b.name, 'zh-Hans-CN')
    || a.id.localeCompare(b.id)
}

function cloneMenuTree(nodes: readonly SystemMenuTreeNode[]): SystemMenuTreeNode[] {
  return nodes.map(node => ({
    ...node,
    children: cloneMenuTree(node.children),
  }))
}

function findCycles(items: readonly SystemMenu[]): Set<string> {
  const byId = new Map(items.map(item => [item.id, item]))
  const cycleIds = new Set<string>()

  for (const item of items) {
    const path: string[] = []
    const seen = new Set<string>()
    let current: SystemMenu | undefined = item
    while (current?.parentId) {
      if (seen.has(current.id)) {
        const start = path.indexOf(current.id)
        path.slice(Math.max(0, start)).forEach(id => cycleIds.add(id))
        break
      }
      seen.add(current.id)
      path.push(current.id)
      current = byId.get(current.parentId)
      if (!current) {
        break
      }
    }
  }

  return cycleIds
}

export function flattenMenuTree(nodes: readonly SystemMenuTreeNode[]): SystemMenuTreeNode[] {
  return nodes.flatMap(node => [node, ...flattenMenuTree(node.children)])
}

export function buildMenuTree(items: readonly SystemMenu[]): SystemMenuTreeNode[] {
  const sorted = [...items].sort(compareMenu)
  const byId = new Map<string, SystemMenu>()
  sorted.forEach(item => {
    if (!byId.has(item.id)) {
      byId.set(item.id, item)
    }
  })

  const childrenByParent = new Map<string | null, SystemMenu[]>()
  for (const item of sorted) {
    const children = childrenByParent.get(item.parentId) ?? []
    children.push(item)
    childrenByParent.set(item.parentId, children)
  }
  const cycleIds = findCycles(sorted)
  const roots = sorted.filter(item => item.parentId === null
    || !byId.has(item.parentId)
    || cycleIds.has(item.id))
  const visited = new Set<string>()

  function attach(item: SystemMenu): SystemMenuTreeNode {
    visited.add(item.id)
    const children = (childrenByParent.get(item.id) ?? [])
      .filter(child => !visited.has(child.id))
      .sort(compareMenu)
      .map(attach)
    return { ...item, children }
  }

  const result: SystemMenuTreeNode[] = []
  for (const item of roots.sort(compareMenu)) {
    if (!visited.has(item.id)) {
      result.push(attach(item))
    }
  }
  for (const item of sorted) {
    if (!visited.has(item.id)) {
      result.push(attach(item))
    }
  }
  return result
}

export function filterMenuTree(
  nodes: readonly SystemMenuTreeNode[],
  keyword: string,
): SystemMenuTreeNode[] {
  const normalized = keyword.trim().toLocaleLowerCase()
  if (!normalized) {
    return cloneMenuTree(nodes)
  }

  return nodes.flatMap(node => {
    const values = [node.name, node.routePath, node.component, node.permissionCode]
    const matched = values.some(value => String(value ?? '').toLocaleLowerCase().includes(normalized))
    if (matched) {
      return [{ ...node, children: cloneMenuTree(node.children) }]
    }
    const children = filterMenuTree(node.children, normalized)
    return children.length > 0 ? [{ ...node, children }] : []
  })
}

export function collectMenuSubtreeIds(
  nodes: readonly SystemMenuTreeNode[],
  id: string,
): Set<string> {
  const target = flattenMenuTree(nodes).find(node => node.id === id)
  if (!target) {
    return new Set()
  }
  return new Set(flattenMenuTree([target]).map(node => node.id))
}

export function collectMenuSubtreeIdsFromFlat(
  items: readonly SystemMenu[],
  id: string,
): Set<string> {
  const childrenByParent = new Map<string | null, SystemMenu[]>()
  items.forEach(item => {
    const children = childrenByParent.get(item.parentId) ?? []
    children.push(item)
    childrenByParent.set(item.parentId, children)
  })
  const ids = new Set<string>()
  const visit = (currentId: string): void => {
    if (ids.has(currentId)) {
      return
    }
    ids.add(currentId)
    childrenByParent.get(currentId)?.forEach(child => visit(child.id))
  }
  visit(id)
  return ids
}

export function toMenuTreeOptions(
  nodes: readonly SystemMenuTreeNode[],
  excludedIds: ReadonlySet<string> = new Set(),
): MenuTreeOption[] {
  return nodes.flatMap(node => {
    if (excludedIds.has(node.id) || node.menuType === 'BUTTON') {
      return []
    }
    const children = toMenuTreeOptions(node.children, excludedIds)
    return [{
      value: node.id,
      label: `${node.name}（${getMenuTypeLabel(node.menuType)}）`,
      ...(!node.enabled ? { disabled: true } : {}),
      ...(children.length > 0 ? { children } : {}),
    }]
  })
}

export function createMenuForm(): SystemMenuForm {
  return {
    component: '',
    enabled: true,
    icon: null,
    isExternal: false,
    menuType: 'MENU',
    name: '',
    parentId: undefined,
    permissionCode: '',
    routePath: '',
    sortOrder: 0,
    visible: true,
  }
}

export function menuToForm(menu: SystemMenu): SystemMenuForm {
  return {
    component: normalizeMenuComponent(menu.component) ?? '',
    enabled: menu.enabled,
    icon: menu.icon,
    isExternal: menu.isExternal,
    menuType: menu.menuType,
    name: menu.name,
    parentId: menu.parentId ?? undefined,
    permissionCode: menu.permissionCode ?? '',
    routePath: menu.routePath ?? '',
    sortOrder: menu.sortOrder,
    visible: menu.visible,
  }
}

function trimToNull(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized || null
}

function normalizeMenuIcon(value: string | null | undefined): string | null {
  const normalized = trimToNull(value)
  return normalized ? canonicalizeMenuIcon(normalized) ?? normalized : null
}

function normalizeMenuComponent(value: string | null | undefined): string | null {
  const normalized = trimToNull(value)
  if (!normalized) {
    return null
  }
  return normalizeDynamicComponentKey(normalized) ?? normalized
}

export function normalizeMenuForm(form: SystemMenuForm): SystemMenuInput {
  const common = {
    enabled: form.enabled,
    name: form.name.trim(),
    parentId: form.parentId ?? null,
    permissionCode: trimToNull(form.permissionCode),
    sortOrder: Number(form.sortOrder),
    visible: form.visible,
  }

  if (form.menuType === 'BUTTON') {
    return {
      ...common,
      component: null,
      icon: null,
      isExternal: false,
      menuType: 'BUTTON',
      routePath: null,
    }
  }

  if (form.menuType === 'DIRECTORY') {
    return {
      ...common,
      component: null,
      icon: normalizeMenuIcon(form.icon),
      isExternal: false,
      menuType: 'DIRECTORY',
      routePath: trimToNull(form.routePath),
    }
  }

  return {
    ...common,
    component: form.isExternal ? null : normalizeMenuComponent(form.component),
    icon: normalizeMenuIcon(form.icon),
    isExternal: form.isExternal,
    menuType: 'MENU',
    routePath: trimToNull(form.routePath),
  }
}

function issue(nodeId: string, code: SystemMenuIssueCode, message: string, relatedId?: string): SystemMenuIssue {
  return { code, message, nodeId, ...(relatedId ? { relatedId } : {}) }
}

const permissionCodePattern = /^[a-z0-9]+(?:[.:][a-z0-9][a-z0-9_-]*)*$/

function permissionIssues(item: SystemMenu): SystemMenuIssue[] {
  const value = item.permissionCode ?? ''
  if (!value) {
    return item.menuType === 'BUTTON'
      ? [issue(item.id, 'INVALID_PERMISSION', '按钮必须填写权限码')]
      : []
  }
  if (value.length > 120) {
    return [issue(item.id, 'INVALID_PERMISSION', '权限码不能超过 120 个字符')]
  }
  if (value !== value.trim() || !permissionCodePattern.test(value)) {
    return [issue(item.id, 'INVALID_PERMISSION', '权限码只能使用小写字母、数字、下划线、短横线，并以冒号或点号分隔')]
  }
  return []
}

export function validateMenuConfiguration(
  items: readonly SystemMenu[],
): SystemMenuIssue[] {
  const issues: SystemMenuIssue[] = []
  const byId = new Map<string, SystemMenu>()
  const pathOwners = new Map<string, SystemMenu>()
  const routeNameOwners = new Map<string, SystemMenu>()
  const cycleIds = findCycles(items)

  for (const item of items) {
    if (!Number.isInteger(item.sortOrder)) {
      issues.push(issue(item.id, 'INVALID_SORT_ORDER', '排序值必须是整数'))
    }
    const previous = byId.get(item.id)
    if (previous) {
      issues.push(issue(item.id, 'DUPLICATE_ID', `菜单 ID 重复：${item.id}`, previous.id))
      continue
    }
    byId.set(item.id, item)
  }

  for (const item of items) {
    if (item.parentId && !byId.has(item.parentId)) {
      issues.push(issue(item.id, 'ORPHAN_PARENT', '上级菜单不存在', item.parentId))
    }
    if (cycleIds.has(item.id)) {
      issues.push(issue(item.id, 'PARENT_CYCLE', '菜单父子关系形成循环'))
    }
    const parent = item.parentId ? byId.get(item.parentId) : undefined
    if (parent?.menuType === 'BUTTON') {
      issues.push(issue(item.id, 'INVALID_PARENT_TYPE', '按钮不能作为其他菜单的父级', parent.id))
    }
    if (item.menuType === 'BUTTON' && !item.parentId) {
      issues.push(issue(item.id, 'BUTTON_ROOT', '按钮必须挂在目录或菜单下'))
    }

    issues.push(...permissionIssues(item))

    if (item.routePath) {
      const owner = pathOwners.get(item.routePath)
      if (owner) {
        issues.push(issue(item.id, 'DUPLICATE_PATH', `路由路径重复：${item.routePath}`, owner.id))
      }
      else {
        pathOwners.set(item.routePath, item)
      }
    }

    if (item.menuType === 'MENU' && !item.isExternal) {
      const routeName = deriveMenuRouteName(item.id)
      const owner = routeNameOwners.get(routeName)
      if (owner) {
        issues.push(issue(item.id, 'DUPLICATE_ROUTE_NAME', `派生路由名称重复：${routeName}`, owner.id))
      }
      else {
        routeNameOwners.set(routeName, item)
      }
    }

    if (item.menuType === 'DIRECTORY') {
      if (item.component || item.isExternal || (item.routePath && !isInternalRoutePath(item.routePath))) {
        issues.push(issue(item.id, 'INVALID_TYPE_FIELDS', '目录不能配置组件或外链，目录路径必须为空或以 / 开头'))
      }
    }

    if (item.menuType === 'BUTTON') {
      if (item.routePath || item.component || item.icon || item.isExternal) {
        issues.push(issue(item.id, 'INVALID_TYPE_FIELDS', '按钮只能配置名称、父级、权限码、排序和状态'))
      }
    }

    if (item.menuType === 'MENU') {
      if (item.isExternal) {
        if (!isHttpUrl(item.routePath)) {
          issues.push(issue(item.id, 'INVALID_EXTERNAL_URL', '外链菜单必须使用有效的 HTTP(S) 地址'))
        }
        if (item.component) {
          issues.push(issue(item.id, 'INVALID_TYPE_FIELDS', '外链菜单不能配置组件'))
        }
      }
      else {
        if (!item.routePath) {
          issues.push(issue(item.id, 'MISSING_PATH', '内部菜单必须配置路由路径'))
        }
        else if (!isInternalRoutePath(item.routePath)) {
          issues.push(issue(item.id, 'INVALID_PATH', '内部菜单路径必须以 / 开头且不能是协议相对地址'))
        }
        if (!item.component) {
          issues.push(issue(item.id, 'MISSING_COMPONENT', '内部菜单必须配置组件'))
        }
        else if (!isDynamicComponentKey(item.component)) {
          issues.push(issue(item.id, 'UNKNOWN_COMPONENT', `组件未进入白名单：${item.component}`))
        }
      }
    }
  }

  return issues
}

export function validateMenuForm(
  form: SystemMenuForm,
  items: readonly SystemMenu[],
  editingId: string | null,
): SystemMenuIssue[] {
  const input = normalizeMenuForm(form)
  const candidate: SystemMenu = {
    ...input,
    createdAt: '',
    id: editingId ?? '__new_menu__',
    updatedAt: '',
  }
  const currentItems = editingId
    ? items.map(item => item.id === editingId ? candidate : item)
    : [...items, candidate]
  return validateMenuConfiguration(currentItems)
    .filter(item => item.nodeId === candidate.id)
}

export function isDynamicComponentKey(value: string): boolean {
  return normalizeDynamicComponentKey(value) !== null
}
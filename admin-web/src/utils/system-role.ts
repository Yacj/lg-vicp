import type { CrudPermissionOption } from '@/types/crud'
import type {
  SystemDataScope,
  SystemDepartmentTreeNode,
  SystemMenuTreeNode,
  SystemPermissionResource,
  SystemRole,
} from '@/types/system-management'

/**
 * 数据范围枚举元数据，严格对齐后端 data_scope 枚举
 * （backend/src/db/schema.ts 的 dataScopeEnum）。
 */
export const DATA_SCOPE_META: Record<SystemDataScope, { label: string; description: string }> = {
  ALL: { description: '可访问平台全部业务数据', label: '全部数据' },
  CUSTOM: { description: '仅可访问指定部门的数据', label: '自定义部门' },
  DEPT: { description: '仅可访问本部门的数据', label: '本部门数据' },
  DEPT_AND_CHILDREN: { description: '可访问本部门及所有下级部门的数据', label: '本部门及以下' },
  PROJECT_OWNER: { description: '仅可访问本人创建的项目数据', label: '本人创建的项目' },
  SELF: { description: '仅可访问本人的数据', label: '仅本人数据' },
}

export const DATA_SCOPE_OPTIONS = (Object.keys(DATA_SCOPE_META) as SystemDataScope[]).map(
  (value) => ({
    label: DATA_SCOPE_META[value].label,
    value,
  }),
)

export function getDataScopeLabel(dataScope: SystemDataScope): string {
  return DATA_SCOPE_META[dataScope]?.label ?? dataScope
}

export type RoleStatusFilter = 'all' | 'enabled' | 'disabled'

export function matchesRoleFilter(role: SystemRole, keyword: string, status: RoleStatusFilter): boolean {
  const normalized = keyword.trim().toLocaleLowerCase()
  const matchesKeyword = !normalized
    || [role.name, role.code, role.description]
      .some(value => String(value ?? '').toLocaleLowerCase().includes(normalized))
  const matchesStatus = status === 'all'
    || (status === 'enabled' ? role.enabled : !role.enabled)
  return matchesKeyword && matchesStatus
}

/** 菜单分组节点的 value 前缀，用于与权限叶子节点区分，提交前过滤。 */
export const MENU_GROUP_VALUE_PREFIX = 'menu:'

/** 未挂载到菜单树的权限所在分组。 */
export const UNMOUNTED_MENU_GROUP_VALUE = `${MENU_GROUP_VALUE_PREFIX}__unmounted__`

export function isMenuGroupValue(value: string | number): boolean {
  return typeof value === 'string' && value.startsWith(MENU_GROUP_VALUE_PREFIX)
}

export function isPermissionValue(value: string | number): value is string {
  return typeof value === 'string' && !isMenuGroupValue(value)
}

export function toPermissionIds(values: readonly (string | number)[]): string[] {
  return [...new Set(values.filter(isPermissionValue))]
}

/**
 * 将权限码（权限树勾选值）映射为权限 ID（后端契约）。
 * 后端 role_permissions 关联 permissions.id，而权限树叶子 value 为权限码，
 * 提交前必须转换；无法映射的值（数据不一致）被忽略。
 */
export function mapPermissionCodesToIds(
  resources: readonly SystemPermissionResource[],
  values: readonly (string | number)[],
): string[] {
  const idByCode = new Map(resources.map((item) => [item.code, item.id]))
  return [...new Set(values
    .filter(isPermissionValue)
    .map((code) => idByCode.get(code))
    .filter((id): id is string => Boolean(id)))]
}

/** 将权限 ID（后端回显）映射为权限码（权限树勾选值），仅保留可映射项。 */
export function mapPermissionIdsToCodes(
  resources: readonly SystemPermissionResource[],
  ids: readonly string[],
): string[] {
  const codeById = new Map(resources.map((item) => [item.id, item.code]))
  return [...new Set(ids
    .map((id) => codeById.get(id))
    .filter((code): code is string => Boolean(code)))]
}

/**
 * 将菜单树与权限资源组装为权限配置树：
 * - 目录/菜单节点作为分组节点（value 带 menu: 前缀，勾选联动子级）；
 * - 按钮节点投影为权限叶子（value 为权限码）；
 * - 未挂载到菜单的权限资源追加到“其他权限”分组。
 */
export function buildPermissionTree(
  menuTree: readonly SystemMenuTreeNode[],
  resources: readonly SystemPermissionResource[],
): CrudPermissionOption[] {
  const mountedCodes = new Set<string>()
  const tree = menuTree.flatMap((node) => mapMenuNode(node, mountedCodes))
  const unmounted = resources.filter((resource) => !mountedCodes.has(resource.code))
  if (unmounted.length === 0) {
    return tree
  }
  return [
    ...tree,
    {
      label: '其他权限',
      value: UNMOUNTED_MENU_GROUP_VALUE,
      children: unmounted.map((resource) => permissionOption(resource)),
    },
  ]
}

function mapMenuNode(
  node: SystemMenuTreeNode,
  mountedCodes: Set<string>,
): CrudPermissionOption[] {
  const base = {
    label: node.name,
    value: `${MENU_GROUP_VALUE_PREFIX}${node.id}`,
    ...(!node.enabled ? { disabled: true } : {}),
  }

  if (node.menuType === 'BUTTON') {
    if (!node.permissionCode) {
      return []
    }
    mountedCodes.add(node.permissionCode)
    return [{
      ...base,
      description: `按钮：${node.name}`,
      value: node.permissionCode,
    }]
  }

  // 目录/菜单自身也可能带权限码（如列表权限），同样视为已挂载。
  if (node.permissionCode) {
    mountedCodes.add(node.permissionCode)
  }

  const children = node.children.flatMap((child) => mapMenuNode(child, mountedCodes))
  return [{
    ...base,
    children,
  }]
}

function permissionOption(resource: SystemPermissionResource): CrudPermissionOption {
  return {
    description: `${resource.resource} / ${resource.action}`,
    label: resource.name,
    value: resource.code,
  }
}

/** 权限树中全部可提交的权限码（用于全选与已选计数，不含停用节点）。 */
export function collectPermissionCodes(nodes: readonly CrudPermissionOption[]): string[] {
  return nodes.flatMap((node) => [
    ...(isPermissionValue(node.value) && !node.disabled ? [node.value] : []),
    ...collectPermissionCodes(node.children ?? []),
  ])
}

export function countPermissionTree(nodes: readonly CrudPermissionOption[]): number {
  return nodes.reduce(
    (total, node) => total
      + (node.disabled ? 0 : 1)
      + countPermissionTree(node.children ?? []),
    0,
  )
}

/** 权限树中已选权限码数量（不含菜单分组节点）。 */
export function countSelectedPermissions(
  selected: readonly (string | number)[],
  nodes: readonly CrudPermissionOption[],
): number {
  const selectable = new Set(collectPermissionCodes(nodes))
  return new Set(selected.filter(isPermissionValue).filter(code => selectable.has(code))).size
}

/** 部门树投影为通用选择器选项（用于 CUSTOM 数据范围配置）。 */
export function toDepartmentPermissionOptions(
  nodes: readonly SystemDepartmentTreeNode[],
): CrudPermissionOption[] {
  return nodes.map((node) => ({
    children: toDepartmentPermissionOptions(node.children),
    ...(!node.enabled ? { disabled: true } : {}),
    description: node.code,
    label: node.name,
    value: node.id,
  }))
}
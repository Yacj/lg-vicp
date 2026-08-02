import { describe, expect, it } from 'vitest'
import type { CrudPermissionOption } from '@/types/crud'
import type {
  SystemDataScope,
  SystemDepartmentTreeNode,
  SystemMenuTreeNode,
  SystemPermissionResource,
  SystemRole,
} from '@/types/system-management'
import {
  buildPermissionTree,
  collectPermissionCodes,
  countPermissionTree,
  countSelectedPermissions,
  DATA_SCOPE_META,
  DATA_SCOPE_OPTIONS,
  getDataScopeLabel,
  isMenuGroupValue,
  isPermissionValue,
  mapPermissionCodesToIds,
  mapPermissionIdsToCodes,
  matchesRoleFilter,
  MENU_GROUP_VALUE_PREFIX,
  toDepartmentPermissionOptions,
  toPermissionIds,
} from './system-role'

function menuNode(overrides: Partial<SystemMenuTreeNode>): SystemMenuTreeNode {
  return {
    children: [],
    component: null,
    createdAt: '',
    enabled: true,
    icon: null,
    id: 'menu-id',
    isExternal: false,
    menuType: 'MENU',
    name: '菜单',
    parentId: null,
    permissionCode: null,
    routePath: '/menu',
    sortOrder: 0,
    updatedAt: '',
    visible: true,
    ...overrides,
  }
}

function permission(code: string, name = code): SystemPermissionResource {
  return {
    action: 'list',
    code,
    createdAt: '',
    description: null,
    id: `perm-${code}`,
    name,
    resource: 'resource',
    updatedAt: '',
  }
}

const resource: SystemPermissionResource = {
  action: 'list',
  code: 'system:role:list',
  createdAt: '',
  description: null,
  id: 'perm-1',
  name: '查看角色',
  resource: 'role',
  updatedAt: '',
}

describe('system-role utils', () => {
  it('keeps data scope metadata aligned with the backend enum', () => {
    const codes = Object.keys(DATA_SCOPE_META) as SystemDataScope[]
    expect(codes.sort()).toEqual([
      'ALL',
      'CUSTOM',
      'DEPT',
      'DEPT_AND_CHILDREN',
      'PROJECT_OWNER',
      'SELF',
    ])
    expect(DATA_SCOPE_OPTIONS).toHaveLength(6)
    expect(DATA_SCOPE_OPTIONS.map(option => option.value)).toEqual(codes)
    expect(getDataScopeLabel('CUSTOM')).toBe('自定义部门')
    expect(getDataScopeLabel('ALL')).toBe('全部数据')
  })

  it('projects menu tree nodes and mounted button permissions into a permission tree', () => {
    const tree = [
      menuNode({
        children: [
          menuNode({
            id: 'button-1',
            menuType: 'BUTTON',
            name: '新增角色',
            parentId: 'menu-id',
            permissionCode: 'system:role:add',
          }),
        ],
        id: 'system-menu',
        name: '系统管理',
        permissionCode: 'system:role:list',
      }),
    ]

    const options = buildPermissionTree(tree, [resource])

    expect(options).toHaveLength(1)
    const root = options[0]
    expect(root.label).toBe('系统管理')
    expect(root.value).toBe(`${MENU_GROUP_VALUE_PREFIX}system-menu`)
    expect(root.children).toHaveLength(1)
    expect(root.children?.[0]).toMatchObject({
      description: '按钮：新增角色',
      label: '新增角色',
      value: 'system:role:add',
    })
  })

  it('appends unmounted permissions into the other-permissions group', () => {
    const tree: SystemMenuTreeNode[] = []
    const options = buildPermissionTree(tree, [resource, permission('system:ai:provider:list')])

    expect(options).toHaveLength(1)
    expect(options[0].label).toBe('其他权限')
    expect(options[0].children).toHaveLength(2)
  })

  it('drops button nodes without permission code', () => {
    const tree = [
      menuNode({
        children: [
          menuNode({
            id: 'button-1',
            menuType: 'BUTTON',
            name: '无权限按钮',
            parentId: 'menu-id',
            permissionCode: null,
          }),
        ],
        id: 'system-menu',
        name: '系统管理',
      }),
    ]

    const options = buildPermissionTree(tree, [])
    expect(options[0]?.children).toHaveLength(0)
  })

  it('keeps disabled menu subtrees selectable but visible', () => {
    const tree = [
      menuNode({
        enabled: false,
        id: 'disabled-menu',
        name: '停用菜单',
        children: [
          menuNode({
            id: 'button-1',
            menuType: 'BUTTON',
            name: '删除',
            parentId: 'disabled-menu',
            permissionCode: 'system:role:remove',
          }),
        ],
      }),
    ]

    const options = buildPermissionTree(tree, [])
    expect(options[0]?.disabled).toBe(true)
    expect(options[0]?.children?.[0]?.value).toBe('system:role:remove')
  })

  it('distinguishes menu group values from permission values', () => {
    expect(isMenuGroupValue(`${MENU_GROUP_VALUE_PREFIX}abc`)).toBe(true)
    expect(isMenuGroupValue('system:role:list')).toBe(false)
    expect(isPermissionValue('system:role:list')).toBe(true)
    expect(isPermissionValue(`${MENU_GROUP_VALUE_PREFIX}abc`)).toBe(false)

    expect(toPermissionIds(['system:role:list', `${MENU_GROUP_VALUE_PREFIX}abc`])).toEqual([
      'system:role:list',
    ])
    expect(toPermissionIds(['a', 'a', 'b'])).toEqual(['a', 'b'])
  })

  it('maps permission codes to backend ids and back', () => {
    const resources = [
      resource,
      permission('system:role:add'),
    ]

    expect(mapPermissionCodesToIds(resources, [
      'system:role:list',
      'system:role:add',
      'system:role:add',
      `${MENU_GROUP_VALUE_PREFIX}group`,
      'unknown:code',
    ])).toEqual(['perm-1', 'perm-system:role:add'])
    expect(mapPermissionCodesToIds(resources, [])).toEqual([])

    expect(mapPermissionIdsToCodes(resources, ['perm-1', 'perm-system:role:add', 'perm-missing']))
      .toEqual(['system:role:list', 'system:role:add'])
  })

  it('collects selectable permission codes and counts selected ones', () => {
    const options: CrudPermissionOption[] = [
      {
        children: [
          { label: '新增', value: 'system:role:add' },
          { label: '删除', value: 'system:role:remove' },
        ],
        label: '角色',
        value: `${MENU_GROUP_VALUE_PREFIX}role`,
      },
      {
        children: [
          { disabled: true, label: '停用按钮', value: 'system:role:export' },
        ],
        label: '导出',
        value: `${MENU_GROUP_VALUE_PREFIX}export`,
      },
    ]

    expect(collectPermissionCodes(options)).toEqual([
      'system:role:add',
      'system:role:remove',
    ])
    expect(countPermissionTree(options)).toBe(4)

    const selected = [
      'system:role:add',
      'system:role:remove',
      'system:role:export',
      `${MENU_GROUP_VALUE_PREFIX}role`,
      'unknown:code',
    ]
    expect(countSelectedPermissions(selected, options)).toBe(2)
  })

  it('filters roles by keyword and enabled status', () => {
    const role: SystemRole = {
      code: 'channel_operator',
      createdAt: '',
      dataScope: 'PROJECT_OWNER',
      description: '管理本人创建的项目',
      enabled: true,
      id: 'role-1',
      name: '渠道业务人员',
      updatedAt: '',
    }

    expect(matchesRoleFilter(role, '', 'all')).toBe(true)
    expect(matchesRoleFilter(role, '渠道', 'all')).toBe(true)
    expect(matchesRoleFilter(role, 'channel', 'all')).toBe(true)
    expect(matchesRoleFilter(role, '管理本人', 'all')).toBe(true)
    expect(matchesRoleFilter(role, '平台', 'all')).toBe(false)
    expect(matchesRoleFilter(role, '', 'enabled')).toBe(true)
    expect(matchesRoleFilter(role, '', 'disabled')).toBe(false)
    expect(matchesRoleFilter({ ...role, enabled: false }, '', 'disabled')).toBe(true)
  })

  it('projects department trees into selector options', () => {
    const tree: SystemDepartmentTreeNode[] = [{
      children: [{
        children: [],
        code: 'rd-bj',
        createdAt: '',
        deletedAt: null,
        email: null,
        enabled: true,
        id: 'dept-child',
        leader: null,
        name: '北京研发',
        parentId: 'dept-root',
        phone: null,
        sortOrder: 0,
        updatedAt: '',
      }],
      code: 'rd',
      createdAt: '',
      deletedAt: null,
      email: null,
      enabled: false,
      id: 'dept-root',
      leader: null,
      name: '研发部',
      parentId: null,
      phone: null,
      sortOrder: 0,
      updatedAt: '',
    }]

    const options = toDepartmentPermissionOptions(tree)
    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({
      description: 'rd',
      disabled: true,
      label: '研发部',
      value: 'dept-root',
    })
    expect(options[0]?.children).toEqual([{
      children: [],
      description: 'rd-bj',
      label: '北京研发',
      value: 'dept-child',
    }])
  })
})
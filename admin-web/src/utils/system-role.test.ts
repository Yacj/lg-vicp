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
  collectSubmitPermissionCodes,
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

  it('projects menu tree nodes, page access codes and button permissions into a permission tree', () => {
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

    const options = buildPermissionTree(tree, [resource, permission('system:role:add')])

    expect(options).toHaveLength(1)
    const root = options[0]
    expect(root.label).toBe('系统管理')
    expect(root.value).toBe(`${MENU_GROUP_VALUE_PREFIX}system-menu`)
    // 菜单自身的页面访问权限码必须渲染为可选叶子，否则“全选”无法授予页面访问权限
    expect(root.children).toHaveLength(2)
    expect(root.children?.[0]).toMatchObject({
      description: '页面访问权限',
      label: '查看角色',
      value: 'system:role:list',
    })
    expect(root.children?.[1]).toMatchObject({
      description: '按钮：新增角色',
      label: '新增角色',
      value: 'system:role:add',
    })
  })

  it('collects menu-level page access codes for select-all submission and echo', () => {
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
    const resources = [resource, permission('system:role:add')]

    const options = buildPermissionTree(tree, resources)
    const codes = collectPermissionCodes(options)
    expect(codes).toContain('system:role:list')
    expect(codes).toContain('system:role:add')

    // 模拟“全选”：提交值为全部勾选值（含 menu: 分组值），映射后必须包含页面访问权限 ID
    const selectAllValues = [...codes, `${MENU_GROUP_VALUE_PREFIX}system-menu`]
    const ids = mapPermissionCodesToIds(resources, selectAllValues)
    expect(ids).toEqual(['perm-1', 'perm-system:role:add'])

    // 回显：ID → 码，页面访问码可重新勾选并计入已选数
    expect(mapPermissionIdsToCodes(resources, ids)).toEqual(['system:role:list', 'system:role:add'])
    expect(countSelectedPermissions(selectAllValues, options)).toBe(2)
  })

  it('completes ancestor page access codes when only a child page is selected', () => {
    const tree = [
      menuNode({
        children: [
          menuNode({
            children: [
              menuNode({
                id: 'button-1',
                menuType: 'BUTTON',
                name: '新增用户',
                parentId: 'user-menu',
                permissionCode: 'system:user:add',
              }),
            ],
            id: 'user-menu',
            name: '用户管理',
            parentId: 'system-menu',
            permissionCode: 'system:user:list',
          }),
        ],
        id: 'system-menu',
        menuType: 'DIRECTORY',
        name: '系统管理',
        permissionCode: 'platform.manage',
      }),
    ]
    const resources = [
      permission('platform.manage', '平台管理'),
      permission('system:user:list', '查看用户'),
      permission('system:user:add', '新增用户'),
    ]

    const options = buildPermissionTree(tree, resources)
    // 模拟只勾选“用户管理”分组（级联勾选其页面访问码与按钮码）：
    // 后端按菜单行逐行过滤，父目录“系统管理”的 platform.manage 缺失时整个目录被隐藏，
    // 因此提交集合必须自动补全祖先分组的页面访问权限码。
    const selected = [
      `${MENU_GROUP_VALUE_PREFIX}user-menu`,
      'system:user:list',
      'system:user:add',
    ]
    const codes = collectSubmitPermissionCodes(options, selected)
    expect(codes.sort()).toEqual([
      'platform.manage',
      'system:user:add',
      'system:user:list',
    ])
  })

  it('grants the page access code when a deduped shared page group is checked alone', () => {
    const tree = [
      menuNode({
        children: [
          menuNode({
            id: 'series-add',
            menuType: 'BUTTON',
            name: '产品数据新增',
            parentId: 'series-menu',
            permissionCode: 'system:md:product:add',
          }),
        ],
        id: 'series-menu',
        name: '产品系列',
        permissionCode: 'system:md:product:list',
      }),
      menuNode({
        id: 'specs-menu',
        name: '产品规格',
        permissionCode: 'system:md:product:list',
      }),
    ]
    const resources = [
      permission('system:md:product:list', '查看产品数据'),
      permission('system:md:product:add', '新增产品数据'),
    ]

    const options = buildPermissionTree(tree, resources)
    // 产品规格 的叶子已被去重合并到 产品系列 下，直接勾选该分组也要授予其页面访问码
    const codes = collectSubmitPermissionCodes(options, [`${MENU_GROUP_VALUE_PREFIX}specs-menu`])
    expect(codes).toEqual(['system:md:product:list'])
  })

  it('skips disabled nodes when collecting submit codes', () => {
    const tree = [
      menuNode({
        enabled: false,
        id: 'disabled-menu',
        name: '停用菜单',
        permissionCode: 'system:role:list',
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

    const options = buildPermissionTree(tree, [resource, permission('system:role:remove')])
    // 停用分组的页面访问码、按钮码都不参与提交，也不向上传播选中状态
    const selected = [
      'system:role:list',
      'system:role:remove',
      `${MENU_GROUP_VALUE_PREFIX}disabled-menu`,
    ]
    expect(collectSubmitPermissionCodes(options, selected)).toEqual([])
  })

  it('renders a shared permission code only once across menus and buttons', () => {
    const tree = [
      menuNode({
        children: [
          menuNode({
            id: 'series-add',
            menuType: 'BUTTON',
            name: '产品数据新增',
            parentId: 'series-menu',
            permissionCode: 'system:md:product:add',
          }),
        ],
        id: 'series-menu',
        name: '产品系列',
        permissionCode: 'system:md:product:list',
      }),
      menuNode({
        children: [
          menuNode({
            id: 'specs-add',
            menuType: 'BUTTON',
            name: '产品数据新增',
            parentId: 'specs-menu',
            permissionCode: 'system:md:product:add',
          }),
        ],
        id: 'specs-menu',
        name: '产品规格',
        permissionCode: 'system:md:product:list',
      }),
    ]
    const resources = [
      permission('system:md:product:list', '查看产品数据'),
      permission('system:md:product:add', '新增产品数据'),
    ]

    const options = buildPermissionTree(tree, resources)
    const values: string[] = []
    const walk = (nodes: readonly CrudPermissionOption[]): void => {
      nodes.forEach((node) => {
        values.push(String(node.value))
        walk(node.children ?? [])
      })
    }
    walk(options)
    // TDesign 树以 value 为节点标识，同一权限码重复渲染会破坏勾选联动
    expect(new Set(values).size).toBe(values.length)

    const series = options[0]
    expect(series.children?.map(node => node.value)).toEqual([
      'system:md:product:list',
      'system:md:product:add',
    ])
    // 共享同一权限码的第二个页面与按钮不再重复渲染叶子，授予权限码即覆盖全部共享页面
    expect(options[1]?.children).toHaveLength(0)
    expect(collectPermissionCodes(options)).toEqual([
      'system:md:product:list',
      'system:md:product:add',
    ])
  })

  it('disables the page access leaf for disabled menus', () => {
    const tree = [
      menuNode({
        enabled: false,
        id: 'disabled-menu',
        name: '停用菜单',
        permissionCode: 'system:role:list',
      }),
    ]

    const options = buildPermissionTree(tree, [resource])
    expect(options[0]?.disabled).toBe(true)
    expect(options[0]?.children?.[0]).toMatchObject({
      disabled: true,
      label: '查看角色',
      value: 'system:role:list',
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
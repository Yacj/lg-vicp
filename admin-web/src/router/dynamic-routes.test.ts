import type { BackendMenuNode, SidebarMenuItem } from '@/types/menu'
import { describe, expect, it, vi } from 'vitest'
import {
  findMenuGroup,
  findMenuPath,
  firstNavigablePath,
  flattenMenuItems,
  navigateMenuTarget,
  projectContextMenus,
  projectDynamicMenus,
  projectPrimaryMenus,
  withStaticSidebarExtras,
} from './dynamic-routes'

function menu(overrides: Partial<BackendMenuNode>): BackendMenuNode {
  return {
    children: [],
    component: null,
    icon: null,
    id: 'menu-id',
    isExternal: false,
    menuType: 'MENU',
    name: '菜单',
    parentId: null,
    permissionCode: null,
    routePath: '/menu',
    sortOrder: 1,
    visible: true,
    ...overrides,
  }
}

describe('dynamic menu projection', () => {
  it('projects directories, known pages and button permissions by responsibility', () => {
    const projection = projectDynamicMenus([
      menu({
        children: [
          menu({ component: 'home/index', id: 'home', name: '工作台', parentId: 'directory', permissionCode: 'home:view', routePath: '/workspace-home' }),
          menu({ id: 'button', menuType: 'BUTTON', parentId: 'directory', permissionCode: 'home:edit', routePath: null }),
        ],
        id: 'directory',
        menuType: 'DIRECTORY',
        name: '基础能力',
        routePath: '/foundation',
      }),
    ])

    expect(projection.routes).toHaveLength(1)
    expect(projection.routes[0]).toMatchObject({
      path: '/workspace-home',
      meta: { permissions: ['home:view'], title: '工作台' },
    })
    expect(projection.sidebarMenus[0]).toMatchObject({
      path: '/foundation',
      title: '基础能力',
    })
    expect(projection.sidebarMenus[0]?.children).toHaveLength(1)
    expect(projection.buttonPermissions).toEqual(['home:edit'])
    expect(projection.issues).toEqual([])
  })

  it('projects backend-owned primary navigation and current mixed-layout children', () => {
    const projection = projectDynamicMenus([
      menu({
        children: [
          menu({ component: 'home/index', id: 'child', name: '工作台', parentId: 'primary', routePath: '/workspace-home' }),
        ],
        icon: 'unregistered-building-icon',
        id: 'primary',
        menuType: 'DIRECTORY',
        name: '项目工作台',
        routePath: '/workspace',
      }),
      menu({
        component: 'home/index',
        id: 'knowledge',
        name: '知识中心',
        routePath: '/knowledge',
      }),
    ])
    const primaryMenus = projectPrimaryMenus(projection.sidebarMenus)

    expect(primaryMenus.map(item => item.id)).toEqual(['knowledge', 'primary'])
    expect(primaryMenus.find(item => item.id === 'primary')).toMatchObject({
      icon: 'unregistered-building-icon',
      path: '/workspace',
      title: '项目工作台',
    })
    expect(findMenuGroup(primaryMenus, '/workspace-home')?.id).toBe('primary')
    expect(projectContextMenus(primaryMenus, '/workspace-home')).toMatchObject([
      { id: 'child', path: '/workspace-home', title: '工作台' },
    ])
    expect(projectContextMenus(primaryMenus, '/missing')).toEqual([])
  })

  it('keeps display-only directories and removes empty context branches', () => {
    const projection = projectDynamicMenus([
      menu({
        id: 'empty-directory',
        menuType: 'DIRECTORY',
        name: '空模块',
        routePath: '/empty-module',
      }),
      menu({
        children: [
          menu({
            component: 'unknown/component',
            id: 'filtered-child',
            name: '不可用页面',
            parentId: 'filtered-directory',
          }),
        ],
        id: 'filtered-directory',
        menuType: 'DIRECTORY',
        name: '无可用页面',
        routePath: null,
      }),
      menu({
        children: [
          menu({
            component: 'home/index',
            id: 'valid-child',
            name: '有效页面',
            parentId: 'valid-directory',
            routePath: '/valid-page',
          }),
          menu({
            id: 'empty-child',
            menuType: 'DIRECTORY',
            name: '空子模块',
            parentId: 'valid-directory',
            routePath: null,
          }),
        ],
        id: 'valid-directory',
        menuType: 'DIRECTORY',
        name: '有效模块',
        routePath: '/valid-module',
      }),
    ])
    const primaryMenus = projectPrimaryMenus(projection.sidebarMenus)
    const emptyDirectory = primaryMenus.find(item => item.id === 'empty-directory')
    const filteredDirectory = primaryMenus.find(item => item.id === 'filtered-directory')
    const validDirectory = primaryMenus.find(item => item.id === 'valid-directory')

    expect(emptyDirectory).toMatchObject({ children: [], path: '/empty-module' })
    expect(filteredDirectory).toMatchObject({ children: [], path: null })
    expect(firstNavigablePath(emptyDirectory!)).toBeNull()
    expect(firstNavigablePath(validDirectory!)).toBe('/valid-page')
    expect(projectContextMenus(primaryMenus, '/empty-module')).toEqual([])
    expect(projectContextMenus(primaryMenus, '/valid-page').map(item => item.id)).toEqual(['valid-child'])
  })

  it('projects HTTP(S) external menus without registering Vue routes', () => {
    const projection = projectDynamicMenus([
      menu({
        component: 'home/index',
        id: 'external',
        isExternal: true,
        name: '外部文档',
        routePath: 'https://docs.example.com/guide',
      }),
    ])

    expect(projection.routes).toEqual([])
    expect(projection.sidebarMenus[0]).toMatchObject({
      path: null,
      target: { href: 'https://docs.example.com/guide', kind: 'external' },
    })
    expect(projection.issues).toEqual([])
  })

  it('opens external targets only after HTTP(S) validation', () => {
    const open = vi.spyOn(globalThis.window, 'open').mockImplementation(() => null)
    const push = vi.fn()
    const router = { push }

    navigateMenuTarget({ href: 'https://docs.example.com', kind: 'external' }, router)
    navigateMenuTarget({ href: 'javascript:blocked', kind: 'external' }, router)

    expect(open).toHaveBeenCalledWith('https://docs.example.com', '_blank', 'noopener,noreferrer')
    expect(open).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('refuses unknown component keys instead of executing backend paths', () => {
    const projection = projectDynamicMenus([
      menu({ component: '../../views/system/users.vue', id: 'unknown', name: '未知页面' }),
    ])

    expect(projection.routes).toEqual([])
    expect(projection.sidebarMenus).toEqual([])
    expect(projection.issues).toEqual([{
      component: '../../views/system/users.vue',
      menuId: 'unknown',
      menuName: '未知页面',
      reason: 'UNKNOWN_COMPONENT',
    }])
  })

  it.each([
    [{ component: 'home/index', isExternal: true }, 'INVALID_EXTERNAL_URL'],
    [{ component: 'home/index', routePath: 'relative' }, 'INVALID_PATH'],
    [{ component: null }, 'MISSING_COMPONENT'],
  ] as const)('rejects invalid route input %#', (overrides, reason) => {
    const projection = projectDynamicMenus([menu(overrides)])
    expect(projection.routes).toEqual([])
    expect(projection.issues[0]?.reason).toBe(reason)
  })

  it('registers hidden menus as accessible routes without sidebar entries', () => {
    const projection = projectDynamicMenus([
      menu({
        children: [
          menu({
            component: 'thermal/calc-records/index',
            id: 'hidden-records',
            name: '计算记录',
            parentId: 'projects',
            permissionCode: 'system:thermal:list',
            routePath: '/thermal/calc-records',
            visible: false,
          }),
        ],
        id: 'projects',
        menuType: 'MENU',
        name: '项目管理',
        routePath: '/project',
      }),
    ])

    expect(projection.sidebarMenus).toHaveLength(1)
    expect(projection.sidebarMenus[0]?.children).toEqual([])
    expect(projection.sidebarMenus[0]).toMatchObject({
      path: '/projects',
      target: { kind: 'internal', path: '/projects' },
    })
    // 子节点先注册：隐藏子菜单注册可直达路由；旧路径 /project 注册 redirect
    expect(projection.routes).toHaveLength(2)
    expect(projection.routes[0]).toMatchObject({
      meta: { hidden: true, permissions: ['system:thermal:list'] },
      path: '/thermal/calc-records',
    })
    expect(projection.routes[1]).toMatchObject({
      path: '/project',
      redirect: '/projects',
    })
    expect(projection.issues).toEqual([])
  })

  it('silently skips hidden menus whose component is not implemented yet', () => {
    const projection = projectDynamicMenus([
      menu({
        component: 'monitor/audit/index',
        id: 'hidden-monitor',
        name: '操作日志',
        routePath: '/monitor/audit',
        visible: false,
      }),
    ])

    expect(projection.routes).toEqual([])
    expect(projection.sidebarMenus).toEqual([])
    expect(projection.issues).toEqual([])
  })

  it('rewrites legacy menu paths to new entries and registers redirect routes', () => {
    const projection = projectDynamicMenus([
      menu({
        component: 'reports/center/index',
        id: 'report-list',
        name: '报告列表',
        permissionCode: 'system:report:generate',
        routePath: '/reports/center',
      }),
    ])

    expect(projection.routes).toHaveLength(1)
    expect(projection.routes[0]).toMatchObject({
      meta: { dynamic: true, title: '报告列表' },
      name: expect.any(String),
      path: '/reports/center',
      redirect: '/reports',
    })
    expect(projection.sidebarMenus[0]).toMatchObject({
      path: '/reports',
      target: { kind: 'internal', path: '/reports' },
    })
    expect(projection.issues).toEqual([])
  })

  it('reuses static-owned paths instead of double registering routes', () => {
    const projection = projectDynamicMenus([
      menu({
        component: 'knowledge/public-library/index',
        id: 'public-library',
        name: '公开文库',
        permissionCode: 'system:knowledge:doc:list',
        routePath: '/knowledge/public-library',
      }),
    ])

    expect(projection.routes).toEqual([])
    expect(projection.sidebarMenus[0]).toMatchObject({
      path: '/knowledge/public-library',
      target: { kind: 'internal', path: '/knowledge/public-library' },
    })
    expect(projection.issues).toEqual([])
  })

  it('reuses report settings static route and keeps hidden templates out of the sidebar', () => {
    const projection = projectDynamicMenus([
      menu({
        component: 'reports/settings/index',
        id: 'report-settings',
        name: '报告设置',
        permissionCode: 'system:report:settings',
        routePath: '/reports/settings',
      }),
      menu({
        component: 'reports/templates/index',
        id: 'report-templates',
        name: '报告模板',
        permissionCode: 'system:report:template:list',
        routePath: '/reports/templates',
        visible: false,
      }),
    ])

    expect(projection.routes).toEqual([])
    expect(projection.sidebarMenus).toEqual([
      expect.objectContaining({
        path: '/reports/settings',
        target: { kind: 'internal', path: '/reports/settings' },
        title: '报告设置',
      }),
    ])
    expect(projection.sidebarMenus.some(item => item.path === '/reports/templates')).toBe(false)
    expect(projection.issues).toEqual([])
  })

  it('collapses enterprise subpages into a single system menu entry', () => {
    const projection = projectDynamicMenus([
      menu({
        children: [
          menu({
            children: [
              menu({
                component: 'content/profile/index',
                id: 'enterprise-profile',
                name: '企业简介',
                parentId: 'enterprise',
                permissionCode: 'system:md:enterprise:list',
                routePath: '/content/profile',
              }),
              menu({
                component: 'content/certificates/index',
                id: 'enterprise-certificates',
                name: '企业资质',
                parentId: 'enterprise',
                permissionCode: 'system:md:enterprise:list',
                routePath: '/content/certificates',
              }),
              menu({
                id: 'enterprise-edit',
                menuType: 'BUTTON',
                name: '编辑企业信息',
                parentId: 'enterprise',
                permissionCode: 'system:md:enterprise:edit',
                routePath: '/content/edit',
              }),
            ],
            id: 'enterprise',
            menuType: 'DIRECTORY',
            name: '企业信息',
            parentId: 'system',
            routePath: '/system/enterprise',
          }),
        ],
        id: 'system',
        menuType: 'DIRECTORY',
        name: '系统管理',
        routePath: '/system',
      }),
    ])

    expect(projection.sidebarMenus).toEqual([
      expect.objectContaining({
        children: [
          expect.objectContaining({
            children: [],
            path: '/system/enterprise',
            target: { kind: 'internal', path: '/system/enterprise' },
            title: '企业信息',
            type: 'MENU',
          }),
        ],
        title: '系统管理',
      }),
    ])
    expect(projection.buttonPermissions).toEqual(['system:md:enterprise:edit'])
    expect(projection.routes.every(route => route.path !== '/content/profile')).toBe(true)
    expect(projection.routes.every(route => route.path !== '/content/certificates')).toBe(true)
    expect(projection.issues).toEqual([])
  })

  it('hides product center and old crawler menus from the ordinary sidebar without dropping routes', () => {
    const projection = projectDynamicMenus([
      menu({
        children: [
          menu({
            component: 'products/series/index',
            id: 'product-series',
            name: '产品系列',
            parentId: 'products',
            permissionCode: 'system:md:product:list',
            routePath: '/products/series',
          }),
          menu({
            component: 'masterdata/materials/index',
            id: 'materials',
            name: '材料参数',
            parentId: 'products',
            permissionCode: 'system:md:material:list',
            routePath: '/masterdata/materials',
          }),
        ],
        id: 'products',
        menuType: 'DIRECTORY',
        name: '产品中心',
        routePath: '/products',
      }),
      menu({
        children: [
          menu({
            component: 'knowledge/documents/index',
            id: 'knowledge-docs',
            name: '知识库',
            parentId: 'knowledge',
            permissionCode: 'system:knowledge:doc:list',
            routePath: '/knowledge/documents',
          }),
          menu({
            component: 'knowledge/crawlers/index',
            id: 'knowledge-crawlers',
            name: '资料采集源',
            parentId: 'knowledge',
            permissionCode: 'system:knowledge:crawler:list',
            routePath: '/knowledge/crawlers',
          }),
        ],
        id: 'knowledge',
        menuType: 'DIRECTORY',
        name: '知识中心',
        routePath: '/knowledge',
      }),
    ])

    expect(projection.sidebarMenus.map(item => item.title)).toEqual(['产品与计算', '知识中心'])
    expect(projection.sidebarMenus[0]?.children.map(item => item.title)).toEqual([])
    expect(projection.sidebarMenus[1]?.children.map(item => item.title)).toEqual(['知识库'])
    expect(projection.routes.some(route => route.path === '/products/series')).toBe(true)
    expect(projection.routes.some(route => route.path === '/masterdata/materials')).toBe(true)
    expect(projection.routes.some(route => route.path === '/knowledge/crawlers')).toBe(true)
  })

  it('keeps product management, thermal calc and compare as 产品与计算 children', () => {
    const projection = projectDynamicMenus([
      menu({
        children: [
          menu({
            component: 'products/manage/index',
            id: 'products-manage',
            name: '产品管理',
            parentId: 'products',
            permissionCode: 'system:product:list',
            routePath: '/products/manage',
          }),
          menu({
            component: 'thermal/calc/index',
            id: 'thermal-calc',
            name: '热工计算',
            parentId: 'products',
            permissionCode: 'system:thermal:calc',
            routePath: '/thermal/calc',
          }),
          menu({
            component: 'products/compare/index',
            id: 'products-compare',
            name: '产品对比',
            parentId: 'products',
            permissionCode: 'system:product:compare',
            routePath: '/products/compare',
          }),
          menu({
            component: 'products/series/index',
            id: 'products-series',
            name: '产品系列',
            parentId: 'products',
            permissionCode: 'system:product:series:list',
            routePath: '/products/series',
          }),
        ],
        id: 'products',
        menuType: 'DIRECTORY',
        name: '产品中心',
        routePath: '/products',
      }),
    ])

    expect(projection.sidebarMenus.map(item => item.title)).toEqual(['产品与计算'])
    expect(projection.sidebarMenus[0]?.children.map(item => item.title)).toEqual([
      '产品管理',
      '产品对比',
      '热工计算',
    ])
  })

  it('keeps AI 运营 visible and hides the merged 超级管理员 entry', () => {
    const projection = projectDynamicMenus([
      menu({
        children: [
          menu({
            component: 'ai-ops/conversations/index',
            id: 'ai-ops-conversations',
            name: '会话运营',
            parentId: 'ai-ops',
            permissionCode: 'system:ai:conversation:list',
            routePath: '/ai-ops/conversations',
          }),
        ],
        id: 'ai-ops',
        menuType: 'DIRECTORY',
        name: 'AI 运营',
        routePath: '/ai-ops',
      }),
      menu({
        children: [
          menu({
            component: 'system/user/index',
            id: 'system-user',
            name: '用户管理',
            parentId: 'system',
            permissionCode: 'system:user:list',
            routePath: '/system/user',
          }),
          menu({
            component: 'system/admins/index',
            id: 'system-admins',
            name: '超级管理员',
            parentId: 'system',
            permissionCode: 'system:user:list',
            routePath: '/system/admins',
          }),
        ],
        id: 'system',
        menuType: 'DIRECTORY',
        name: '系统管理',
        routePath: '/system',
      }),
    ])

    expect(projection.sidebarMenus.map(item => item.title)).toEqual(['用户管理', 'AI 运营', '系统管理'])
    expect(projection.sidebarMenus.find(item => item.path === '/ai-ops')?.children.map(item => item.title)).toEqual(['会话运营'])
    expect(projection.sidebarMenus.find(item => item.path === '/system')?.children.map(item => item.title)).toEqual([])
    expect(flattenMenuItems(projection.sidebarMenus).some(item => item.path === '/system/admins')).toBe(false)
  })

  it('collapses collection into a single ordinary menu while keeping child paths compatible', () => {
    const projection = projectDynamicMenus([
      menu({
        children: [
          menu({
            component: 'collection/manual/index',
            id: 'collection-manual',
            name: '手动采集',
            parentId: 'collection',
            permissionCode: 'system:collection:manual:create',
            routePath: '/collection/manual',
          }),
          menu({
            component: 'collection/sources/index',
            id: 'collection-sources',
            name: '自动采集源',
            parentId: 'collection',
            permissionCode: 'system:collection:auto:list',
            routePath: '/collection/sources',
          }),
          menu({
            component: 'collection/tasks/index',
            id: 'collection-tasks',
            name: '采集任务',
            parentId: 'collection',
            permissionCode: 'system:collection:list',
            routePath: '/collection/tasks',
          }),
        ],
        id: 'collection',
        menuType: 'DIRECTORY',
        name: '采集管理',
        routePath: '/collection',
      }),
    ])

    expect(projection.sidebarMenus).toEqual([
      expect.objectContaining({
        children: [],
        path: '/collection',
        target: { kind: 'internal', path: '/collection' },
        title: '采集管理',
        type: 'MENU',
      }),
    ])
    expect(projection.routes.every(route => !['/collection/manual', '/collection/sources', '/collection/tasks'].includes(String(route.path)))).toBe(true)
    expect(projection.issues).toEqual([])
  })
})

describe('findMenuPath breadcrumb chain', () => {
  const leaf: SidebarMenuItem = {
    children: [],
    icon: null,
    id: 'leaf',
    path: '/system/users',
    target: { kind: 'internal', path: '/system/users' },
    title: '用户管理',
    type: 'MENU',
  }
  const group: SidebarMenuItem = {
    children: [leaf],
    icon: null,
    id: 'group',
    path: '/system',
    target: null,
    title: '系统管理',
    type: 'DIRECTORY',
  }
  const home: SidebarMenuItem = {
    children: [],
    icon: 'home',
    id: 'home',
    path: '/',
    target: { kind: 'internal', path: '/' },
    title: '工作台',
    type: 'MENU',
  }

  it('returns the full chain from root menu to the matching leaf', () => {
    const chain = findMenuPath([home, group], '/system/users')
    expect(chain.map(item => item.title)).toEqual(['系统管理', '用户管理'])
  })

  it('matches a top-level menu by its own path', () => {
    const chain = findMenuPath([home, group], '/system')
    expect(chain.map(item => item.id)).toEqual(['group'])
  })

  it('matches the home menu on the root path', () => {
    const chain = findMenuPath([home, group], '/')
    expect(chain.map(item => item.id)).toEqual(['home'])
  })

  it('returns an empty chain when no menu matches', () => {
    expect(findMenuPath([home, group], '/missing')).toEqual([])
  })

  it('keeps the chain when the matched ancestor is a display-only directory without path', () => {
    const pathless: SidebarMenuItem = {
      children: [leaf],
      icon: null,
      id: 'pathless',
      path: null,
      target: null,
      title: '无路径模块',
      type: 'DIRECTORY',
    }
    const chain = findMenuPath([home, pathless], '/system/users')
    expect(chain.map(item => item.id)).toEqual(['pathless', 'leaf'])
  })

  it('selects the longest sibling path so /reports/settings is not captured by /reports', () => {
    const reportList: SidebarMenuItem = {
      children: [],
      icon: null,
      id: 'report-list',
      path: '/reports',
      target: { kind: 'internal', path: '/reports' },
      title: '报告列表',
      type: 'MENU',
    }
    const reportSettings: SidebarMenuItem = {
      children: [],
      icon: null,
      id: 'report-settings',
      path: '/reports/settings',
      target: { kind: 'internal', path: '/reports/settings' },
      title: '报告设置',
      type: 'MENU',
    }
    const reportGroup: SidebarMenuItem = {
      children: [reportList, reportSettings],
      icon: null,
      id: 'report-group',
      path: '/reports',
      target: null,
      title: '报告管理',
      type: 'DIRECTORY',
    }

    expect(findMenuPath([home, reportGroup], '/reports/settings').map(item => item.id))
      .toEqual(['report-group', 'report-settings'])
    expect(findMenuPath([home, reportGroup], '/reports').map(item => item.id))
      .toEqual(['report-group', 'report-list'])
    expect(findMenuPath([home, reportGroup], '/reports/report-1').map(item => item.id))
      .toEqual(['report-group', 'report-list'])
    expect(findMenuPath([reportList, reportSettings], '/reports/settings').map(item => item.id))
      .toEqual(['report-settings'])
  })
})

describe('withStaticSidebarExtras', () => {
  const models: SidebarMenuItem = {
    children: [],
    icon: null,
    id: 'models',
    path: '/ai-config/models',
    target: { kind: 'internal', path: '/ai-config/models' },
    title: '模型管理',
    type: 'MENU',
  }
  const quickPrompts: SidebarMenuItem = {
    children: [],
    icon: null,
    id: 'quick-prompts',
    path: '/ai-config/quick-prompts',
    target: { kind: 'internal', path: '/ai-config/quick-prompts' },
    title: '快捷提问',
    type: 'MENU',
  }
  const aiConfig: SidebarMenuItem = {
    children: [models, quickPrompts],
    icon: null,
    id: 'ai-config',
    path: '/ai-config',
    target: null,
    title: 'AI 配置',
    type: 'DIRECTORY',
  }
  const aiOps: SidebarMenuItem = {
    children: [],
    icon: null,
    id: 'ai-ops',
    path: '/ai-ops',
    target: null,
    title: 'AI 运营',
    type: 'DIRECTORY',
  }

  it('injects 高级设置 under AI 配置 for advanced admins', () => {
    const menus = withStaticSidebarExtras(
      [aiConfig],
      ['system:ai:model:edit', 'system:ai:conversation:list'],
    )
    expect(menus[0]?.children.map(item => item.title)).toEqual([
      '模型管理',
      '快捷提问',
      '高级设置',
    ])
  })

  it('keeps ordinary AI admins from seeing advanced entries', () => {
    const menus = withStaticSidebarExtras(
      [aiConfig],
      ['system:ai:quick-prompt:list', 'system:ai:model:list'],
    )
    expect(menus[0]?.children.map(item => item.title)).toEqual(['模型管理', '快捷提问'])
  })

  it('does not duplicate leaves already returned by the backend', () => {
    const backendAdvanced: SidebarMenuItem = {
      children: [],
      icon: null,
      id: 'backend-advanced',
      path: '/ai-config/advanced',
      target: { kind: 'internal', path: '/ai-config/advanced' },
      title: 'Agent设置',
      type: 'MENU',
    }
    const menus = withStaticSidebarExtras(
      [{ ...aiConfig, children: [...aiConfig.children, backendAdvanced] }],
      ['system:ai:model:edit', 'system:ai:conversation:list'],
    )
    expect(menus[0]?.children.filter(item => item.path === '/ai-config/advanced')).toHaveLength(1)
    expect(menus[0]?.children.map(item => item.title)).toEqual([
      '模型管理',
      '快捷提问',
      'Agent设置',
    ])
  })

  it('creates AI 配置 and 产品与计算 when the parent is missing, without a duplicate 超级管理员 entry', () => {
    const menus = withStaticSidebarExtras([aiOps], [], true)
    expect(menus.map(item => item.title)).toEqual(['AI 运营', '产品与计算', 'AI 配置'])
    expect(menus.find(item => item.path === '/products')?.children.map(item => item.title)).toEqual([
      '产品管理',
      '产品对比',
      '热工计算',
    ])
    expect(menus.find(item => item.path === '/ai-config')?.children.map(item => item.title)).toEqual([
      '提示词配置',
      '高级设置',
    ])
    expect(menus.find(item => item.path === '/system')).toBeUndefined()
    expect(flattenMenuItems(menus).some(item => item.title === '超级管理员' || item.path === '/system/admins')).toBe(false)
  })
})

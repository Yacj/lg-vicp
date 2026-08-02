import type { BackendMenuNode, SidebarMenuItem } from '@/types/menu'
import { describe, expect, it, vi } from 'vitest'
import {
  findMenuGroup,
  findMenuPath,
  firstNavigablePath,
  navigateMenuTarget,
  projectContextMenus,
  projectDynamicMenus,
  projectPrimaryMenus,
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

    expect(primaryMenus.map(item => item.id)).toEqual(['primary', 'knowledge'])
    expect(primaryMenus[0]).toMatchObject({
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
})

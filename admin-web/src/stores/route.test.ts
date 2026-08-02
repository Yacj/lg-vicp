import type { RouterMenuResult } from '@/types/menu'
import type { RouteRecordRaw, Router } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fetchDynamicRouters } from '@/api/modules/menus'
import { projectDynamicMenus } from '@/router/dynamic-routes'
import { useRouteStore } from './route'
import { useTabsStore } from './tabs'

vi.mock('@/api/modules/menus', () => ({
  fetchDynamicRouters: vi.fn(),
}))

const mockedFetchDynamicRouters = vi.mocked(fetchDynamicRouters)

function menu(overrides: Partial<RouterMenuResult['routers'][number]> = {}): RouterMenuResult['routers'][number] {
  return {
    children: [],
    component: 'home/index',
    icon: null,
    id: 'menu-1',
    isExternal: false,
    menuType: 'MENU',
    name: '菜单',
    parentId: null,
    permissionCode: null,
    routePath: '/menu',
    sortOrder: 0,
    visible: true,
    ...overrides,
  }
}

function result(routers: RouterMenuResult['routers']): RouterMenuResult {
  return { permissions: [], routers }
}

function createTestRouter(): Router {
  const currentRoute = {
    fullPath: '/',
    name: 'Home' as string,
    path: '/',
  }
  const routes: RouteRecordRaw[] = []
  return {
    addRoute: (_parent: string, route: RouteRecordRaw) => {
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index >= 0) {
          routes.splice(index, 1)
        }
      }
    },
    currentRoute: { value: currentRoute },
    getRoutes: () => [
      { name: 'AdminRoot', path: '/' } as RouteRecordRaw,
      { name: 'Home', path: '/' } as RouteRecordRaw,
      ...routes,
    ],
    hasRoute: (name: string) => routes.some(route => route.name === name),
    replace: async (path: string) => {
      currentRoute.fullPath = path
      currentRoute.name = path === '/new' ? 'Dynamic_new' : 'Home'
      currentRoute.path = path
    },
  } as unknown as Router
}

describe('route store refresh', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockedFetchDynamicRouters.mockReset()
  })

  it('replaces dynamic routes, prunes stale tabs and falls back after current route removal', async () => {
    const router = createTestRouter()
    const oldMenu = menu({ id: 'old', name: '旧菜单', routePath: '/old' })
    const newMenu = menu({ id: 'new', name: '新菜单', routePath: '/new' })
    mockedFetchDynamicRouters
      .mockResolvedValueOnce(result([oldMenu]))
      .mockResolvedValueOnce(result([newMenu]))

    const routeStore = useRouteStore()
    await routeStore.initialize(router)
    const currentRoute = router.currentRoute.value as unknown as { fullPath: string, name: string, path: string }
    currentRoute.fullPath = '/old'
    currentRoute.name = 'Dynamic_old'
    currentRoute.path = '/old'
    const tabsStore = useTabsStore()
    tabsStore.open({
      affix: true,
      closable: false,
      fullPath: '/',
      keepAlive: true,
      name: 'Home',
      pinned: false,
      title: '工作台',
    })
    tabsStore.open({
      affix: false,
      closable: true,
      fullPath: '/old',
      keepAlive: true,
      name: 'Dynamic_old',
      pinned: false,
      title: '旧菜单',
    })

    const refresh = await routeStore.refresh(router)

    expect(refresh).toMatchObject({ currentRouteRemoved: true, fallbackPath: '/new' })
    expect(router.currentRoute.value.path).toBe('/new')
    expect(router.hasRoute('Dynamic_old')).toBe(false)
    expect(router.hasRoute('Dynamic_new')).toBe(true)
    expect(tabsStore.tabs.map(tab => tab.fullPath)).toEqual(['/'])
  })

  it('falls back when a dynamic route keeps its name but changes path', async () => {
    const router = createTestRouter()
    const oldMenu = menu({ id: 'same', name: '旧地址', routePath: '/old' })
    const movedMenu = menu({ id: 'same', name: '新地址', routePath: '/new-path' })
    mockedFetchDynamicRouters
      .mockResolvedValueOnce(result([oldMenu]))
      .mockResolvedValueOnce(result([movedMenu]))

    const routeStore = useRouteStore()
    await routeStore.initialize(router)
    const currentRoute = router.currentRoute.value as unknown as { fullPath: string, name: string, path: string }
    currentRoute.fullPath = '/old'
    currentRoute.name = 'Dynamic_same'
    currentRoute.path = '/old'

    const refresh = await routeStore.refresh(router)

    expect(refresh).toMatchObject({ currentRouteRemoved: true, fallbackPath: '/new-path' })
    expect(router.currentRoute.value.path).toBe('/new-path')
    expect(router.hasRoute('Dynamic_same')).toBe(true)
  })

  it('keeps external menus out of the route registry while retaining projection metadata', () => {
    const projection = projectDynamicMenus([
      menu({
        component: null,
        id: 'external',
        isExternal: true,
        name: '外部资源',
        routePath: 'https://example.com',
      }),
    ])

    expect(projection.routes).toHaveLength(0)
    expect(projection.sidebarMenus[0]?.target).toEqual({
      href: 'https://example.com',
      kind: 'external',
    })
  })
})
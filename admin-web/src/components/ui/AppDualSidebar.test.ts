import type { SidebarMenuItem } from '@/types/menu'
import { createPinia, setActivePinia } from 'pinia'
import TDesign from 'tdesign-vue-next'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppDualSidebar from './AppDualSidebar.vue'

let app: ReturnType<typeof createApp> | null = null

interface AppDualSidebarProps {
  activeId?: string
  collapsed: boolean
  contextMenus: SidebarMenuItem[]
  moduleTitle?: string
  primaryMenus: SidebarMenuItem[]
}

function menu(overrides: Partial<SidebarMenuItem>): SidebarMenuItem {
  return {
    children: [],
    icon: 'building',
    id: 'menu-id',
    path: null,
    title: '菜单',
    type: 'DIRECTORY',
    ...overrides,
  }
}

async function mountSidebar(props: AppDualSidebarProps) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'Home', component: { render: () => h('div') } }],
  })
  await router.push('/')
  await router.isReady()

  const container = document.createElement('div')
  document.body.append(container)
  app = createApp({
    render: () => h(AppDualSidebar, props),
  })
  app.use(pinia)
  app.use(router)
  app.use(TDesign)
  app.mount(container)
  await nextTick()

  return { container }
}

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

describe('app dual sidebar', () => {
  it('renders display-only primary items vertically without an empty secondary sidebar', async () => {
    const { container } = await mountSidebar({
      collapsed: false,
      contextMenus: [],
      primaryMenus: [menu({ id: 'empty-module', title: '空模块' })],
    })

    const item = container.querySelector('.app-dual-sidebar__primary-item')

    expect(item?.querySelector('.app-dual-sidebar__primary-icon')).not.toBeNull()
    expect(item?.querySelector('.app-dual-sidebar__primary-icon')?.parentElement).toBe(item)
    expect(item?.querySelector('.t-button__text')?.textContent).toBe('空模块')
    expect(item?.querySelector('.t-button__text')?.parentElement).toBe(item)
    expect(item?.hasAttribute('disabled')).toBe(true)
    expect(container.querySelector('.app-dual-sidebar__secondary')).toBeNull()
    expect(container.querySelector('.app-dual-sidebar__primary-toggle')).toBeNull()
    expect(container.querySelector('.app-dual-sidebar')?.classList.contains('has-secondary')).toBe(false)
  })

  it('keeps primary labels visible while the dual sidebar is collapsed', async () => {
    const { container } = await mountSidebar({
      collapsed: true,
      contextMenus: [menu({ id: 'context-page', path: '/context-page', title: '上下文页面', type: 'MENU' })],
      primaryMenus: [menu({ id: 'project', path: '/project', title: '项目工作台' })],
    })

    expect(container.querySelector('.app-dual-sidebar__primary-label')?.textContent).toBe('项目工作台')
    expect(container.querySelector('.app-dual-sidebar__secondary')).toBeNull()
    expect(container.querySelector('.app-dual-sidebar__primary-toggle')).not.toBeNull()
    expect(container.querySelector('.app-dual-sidebar')?.classList.contains('is-collapsed')).toBe(true)
  })
})

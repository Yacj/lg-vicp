import { createPinia, setActivePinia } from 'pinia'
import TDesign from 'tdesign-vue-next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { B_ADMIN_CLIENT } from '@/types/auth'
import AppHeader from './AppHeader.vue'

let app: ReturnType<typeof createApp> | null = null

async function mountHeader(props: Record<string, unknown> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const userStore = useUserStore(pinia)
  userStore.applyUserInfo({
    dataScopes: [],
    departments: [{ code: 'HQ', id: 'department-hq', isPrimary: true, name: '总部' }],
    permissions: [],
    roles: ['平台管理员'],
    user: {
      channelType: null,
      clientType: B_ADMIN_CLIENT,
      displayName: '林管理员',
      email: null,
      id: 'user-1',
      phone: null,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  })

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', name: 'Home', component: { render: () => h('div') } }],
  })
  await router.push('/')
  await router.isReady()

  const container = document.createElement('div')
  document.body.append(container)
  app = createApp({
    render: () => h(AppHeader, props),
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

describe('app header', () => {
  it('keeps the desktop action order and exposes the real user summary', async () => {
    const { container } = await mountHeader()
    const actionLabels = [...container.querySelectorAll('.app-header__actions [aria-label]')]
      .map(element => element.getAttribute('aria-label'))

    expect(actionLabels).toEqual([
      '全局搜索',
      '刷新当前页',
      '全屏',
      '切换为深色',
      '通知',
      '筑小格 AI',
      '外观设置',
    ])
    expect(container.querySelector('.app-header__user')?.textContent).toContain('林管理员')

    container.querySelector('[aria-label="用户菜单"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(document.body.textContent).toContain('平台管理员')
    expect(document.body.textContent).toContain('总部')
    expect(document.body.textContent).toContain('个人信息')
  })

  it('emits the navigation toggle as a shell intent', async () => {
    const onToggleNavigation = vi.fn()
    const { container } = await mountHeader({
      navigationCollapsed: true,
      onToggleNavigation,
      showNavigationToggle: true,
    })

    container.querySelector('[aria-label="展开侧边栏"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    await nextTick()

    expect(onToggleNavigation).toHaveBeenCalledOnce()
  })
})

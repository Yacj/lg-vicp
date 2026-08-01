import type { AppTab } from '@/stores/tabs'
import { createPinia, setActivePinia } from 'pinia'
import TDesign from 'tdesign-vue-next'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'
import AppTabs from './AppTabs.vue'

let app: ReturnType<typeof createApp> | null = null

const home: AppTab = {
  affix: true,
  closable: false,
  fullPath: '/',
  keepAlive: true,
  name: 'Home',
  pinned: false,
  title: '工作台',
}

function createTab(path: string, name: string, title: string): AppTab {
  return {
    affix: false,
    closable: true,
    fullPath: path,
    keepAlive: true,
    name,
    pinned: false,
    title,
  }
}

async function mountTabs(path = '/page-1') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const tabsStore = useTabsStore(pinia)
  tabsStore.open(home)
  tabsStore.open(createTab('/page-1', 'Page1', '页面一'))
  tabsStore.open(createTab('/page-2', 'Page2', '页面二'))

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'Home', component: { render: () => h('div') } },
      { path: '/page-1', name: 'Page1', component: { render: () => h('div') } },
      { path: '/page-2', name: 'Page2', component: { render: () => h('div') } },
    ],
  })
  await router.push(path)
  await router.isReady()

  const container = document.createElement('div')
  document.body.append(container)
  app = createApp(AppTabs)
  app.use(pinia)
  app.use(router)
  app.use(TDesign)
  app.mount(container)
  await nextTick()

  return { container, router, tabsStore }
}

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

describe('app tabs', () => {
  it('renders the active tab and switches routes by clicking a target tab', async () => {
    const { container, router } = await mountTabs()

    expect(container.querySelector('.app-tabs.is-line')).not.toBeNull()
    expect(container.querySelector('[aria-selected="true"]')?.textContent).toContain('页面一')

    container.querySelectorAll('.app-tabs__tab')[2]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(router.currentRoute.value.fullPath).toBe('/page-2')
  })

  it('closes the active tab and navigates to the adjacent route', async () => {
    const { container, router, tabsStore } = await mountTabs('/page-1')

    container.querySelector('.app-tabs__tab .app-tabs__close')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(tabsStore.tabs.map(tab => tab.fullPath)).toEqual(['/', '/page-2'])
    expect(router.currentRoute.value.fullPath).toBe('/page-2')
  })

  it('keeps the selected tab style independent from layout theme', async () => {
    const { container } = await mountTabs()
    const settingsStore = useSettingsStore()

    settingsStore.patchSetting('tabsStyle', 'chrome')
    await nextTick()

    expect(container.querySelector('.app-tabs.is-chrome')).not.toBeNull()
  })
})

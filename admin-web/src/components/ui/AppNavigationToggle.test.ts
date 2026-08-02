import { createPinia, setActivePinia } from 'pinia'
import TDesign from 'tdesign-vue-next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import AppNavigationToggle from './AppNavigationToggle.vue'

let app: ReturnType<typeof createApp> | null = null

async function mountToggle(props: Record<string, unknown> = {}) {
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
    render: () => h(AppNavigationToggle, props),
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

describe('app navigation toggle', () => {
  it('labels expand when collapsed', async () => {
    const { container } = await mountToggle({ collapsed: true })
    expect(container.querySelector('[aria-label="展开侧边栏"]')).not.toBeNull()
  })

  it('labels collapse when expanded', async () => {
    const { container } = await mountToggle({ collapsed: false })
    expect(container.querySelector('[aria-label="收起侧边栏"]')).not.toBeNull()
  })

  it('emits click as a shell intent', async () => {
    const onClick = vi.fn()
    const { container } = await mountToggle({ collapsed: true, onClick })

    container.querySelector('[aria-label="展开侧边栏"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    )
    await nextTick()

    expect(onClick).toHaveBeenCalledOnce()
  })
})
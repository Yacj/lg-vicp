import TDesign from 'tdesign-vue-next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import AppEmptyState from './AppEmptyState.vue'
import AppErrorState from './AppErrorState.vue'

const mountedApps: Array<ReturnType<typeof createApp>> = []

function mount(component: typeof AppEmptyState | typeof AppErrorState, props: Record<string, unknown>) {
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp(component, props)
  app.use(TDesign)
  app.mount(container)
  mountedApps.push(app)
  return container
}

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.innerHTML = ''
})

describe('app empty and error states', () => {
  it('uses TDesign Empty for data absence', () => {
    const container = mount(AppEmptyState, { description: '数据接口待接入', title: '暂无数据' })
    expect(container.querySelector('.t-empty')).not.toBeNull()
    expect(container.textContent).toContain('数据接口待接入')
  })

  it('supports inline retry and full-page error variants', async () => {
    const onAction = vi.fn()
    const inline = mount(AppErrorState, { onAction })
    inline.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    expect(onAction).toHaveBeenCalledOnce()
    expect(inline.querySelector('.is-inline')).not.toBeNull()

    const page = mount(AppErrorState, { code: '404', variant: 'page' })
    expect(page.querySelector('.is-page')).not.toBeNull()
    expect(page.textContent).toContain('404')
    expect(page.textContent).toContain('返回工作台')
  })
})
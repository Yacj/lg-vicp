import TDesign from 'tdesign-vue-next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import AppSearchPanel from './AppSearchPanel.vue'

const mountedApps: Array<ReturnType<typeof createApp>> = []

function mountSearchPanel(props: Record<string, unknown> = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({
    render: () => h(AppSearchPanel, props, {
      default: () => h('input', { class: 'search-fixture' }),
      advanced: () => h('span', { class: 'advanced-fixture' }, '高级条件'),
    }),
  })
  app.use(TDesign)
  app.mount(container)
  mountedApps.push(app)
  return container
}

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.innerHTML = ''
})

describe('app search panel', () => {
  it('emits search from form submit and Enter through the same intent', async () => {
    const onSearch = vi.fn()
    const container = mountSearchPanel({ onSearch })
    const searchButton = [...container.querySelectorAll('button')]
      .find(button => button.textContent?.includes('查询'))

    searchButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const enterEvent = new Event('keydown', { bubbles: true, cancelable: true })
    Object.defineProperty(enterEvent, 'key', { value: 'Enter' })
    container.querySelector('.app-search-panel')
      ?.dispatchEvent(enterEvent)
    await nextTick()

    expect(onSearch).toHaveBeenCalledTimes(2)
  })

  it('emits reset without owning the caller query model', async () => {
    const onReset = vi.fn()
    const container = mountSearchPanel({ onReset })

    container.querySelector('form')?.dispatchEvent(new Event('reset', { bubbles: true, cancelable: true }))
    await nextTick()

    expect(onReset).toHaveBeenCalledOnce()
  })

  it('controls advanced fields with the expanded model', async () => {
    const onExpanded = vi.fn()
    const collapsed = mountSearchPanel({
      collapsible: true,
      expanded: false,
      'onUpdate:expanded': onExpanded,
    })

    expect(collapsed.querySelector('.advanced-fixture')).toBeNull()
    const expandButton = [...collapsed.querySelectorAll('button')]
      .find(button => button.textContent?.includes('展开'))
    expandButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    expect(onExpanded).toHaveBeenCalledWith(true)
  })
})
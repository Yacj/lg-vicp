import TDesign from 'tdesign-vue-next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import AppSearchPanel from './AppSearchPanel.vue'

const mountedApps: Array<ReturnType<typeof createApp>> = []

function mountSearchPanel(props: Record<string, unknown> = {}, fieldCount = 1) {
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({
    render: () => h(AppSearchPanel, props, {
      default: () => Array.from({ length: fieldCount }, (_, index) => h('input', {
        class: 'search-fixture',
        'data-field-index': index,
      })),
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
  it('keeps the action group in the same grid flow as three search fields', () => {
    const container = mountSearchPanel({}, 3)
    const grid = container.querySelector('.app-search-panel__fields')
    const directChildren = [...(grid?.children ?? [])]

    expect(directChildren.filter(child => child.classList.contains('search-fixture'))).toHaveLength(3)
    expect(directChildren.at(-1)?.classList.contains('app-search-panel__actions')).toBe(true)
  })

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
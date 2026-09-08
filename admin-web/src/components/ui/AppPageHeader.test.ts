import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, type VNode } from 'vue'
import AppPageHeader from './AppPageHeader.vue'

type PageHeaderProps = {
  title: string
  description?: string
  eyebrow?: string
}

const mountedApps: Array<ReturnType<typeof createApp>> = []

function mountPageHeader(props: PageHeaderProps, slots: Record<string, () => VNode> = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp({
    render: () => h(AppPageHeader, props, slots),
  })
  app.mount(container)
  mountedApps.push(app)
  return container
}

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.innerHTML = ''
})

describe('app page header', () => {
  it('renders title, eyebrow and description inside the surface bar', () => {
    const container = mountPageHeader({
      title: '运单详情: WB202604010001',
      eyebrow: '调度中心',
      description: '查看运单执行进度与节点记录',
    })

    expect(container.querySelector('h1')?.textContent).toBe('运单详情: WB202604010001')
    expect(container.querySelector('.app-page-header__eyebrow')?.textContent?.trim()).toBe('调度中心')
    expect(container.querySelector('.app-page-header__description')?.textContent?.trim()).toBe('查看运单执行进度与节点记录')
  })

  it('keeps the navigation divider only when a title exists', () => {
    const slots = { navigation: () => h('button', { class: 'back-fixture' }, '返回列表') }

    const titled = mountPageHeader({ title: '文档详情' }, slots)
    expect(titled.querySelector('.app-page-header__navigation--divided')).not.toBeNull()

    const untitled = mountPageHeader({ title: '' }, slots)
    expect(untitled.querySelector('h1')).toBeNull()
    expect(untitled.querySelector('.app-page-header__navigation--divided')).toBeNull()
    expect(untitled.querySelector('.back-fixture')?.textContent).toBe('返回列表')
  })

  it('renders actions slot content on the trailing side', () => {
    const container = mountPageHeader({ title: '项目详情' }, {
      actions: () => h('button', { class: 'action-fixture' }, '编辑项目'),
    })

    const actions = container.querySelector('.app-page-header__actions')
    expect(actions?.querySelector('.action-fixture')?.textContent).toBe('编辑项目')
  })
})

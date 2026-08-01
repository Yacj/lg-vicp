import { createPinia } from 'pinia'
import TDesign from 'tdesign-vue-next'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import Home from './index.vue'

let app: ReturnType<typeof createApp> | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

describe('dashboard', () => {
  it('renders business modules with honest empty states, without dev placeholders', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'Home', component: Home }],
    })
    await router.push('/')
    await router.isReady()

    app = createApp(Home)
    app.use(createPinia())
    app.use(router)
    app.use(TDesign)
    app.mount(container)

    for (const title of [
      '待处理事项',
      '资料处理状态',
      '最近项目',
      '最近动态',
      '业务处理趋势',
      '任务状态分布',
      '项目总数',
      '待处理资料',
      '待复核数据',
      '报告任务',
    ]) {
      expect(container.textContent).toContain(title)
    }

    // 无数据时的诚实表达：-- 与空状态
    expect(container.textContent).toContain('--')
    expect(container.textContent).toContain('当前没有需要处理的事项')
    expect(container.textContent).toContain('暂无最近项目')
    expect(container.textContent).toContain('暂无趋势数据')
    expect(container.textContent).toContain('暂无任务数据')

    // 禁止保留开发占位文案
    for (const placeholder of [
      '数据接口待接入',
      '功能路由待接入',
      '统计契约待接入',
      '今日业务数据将在统计接口接入后自动更新',
      '仅展示当前账号可访问的真实路由',
    ]) {
      expect(container.textContent).not.toContain(placeholder)
    }
    expect(container.textContent).not.toContain('UI 体系')
    expect(container.textContent).not.toContain('当前布局')
  })

  it('keeps module order for single-column rendering (mobile)', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'Home', component: Home }],
    })
    await router.push('/')
    await router.isReady()

    app = createApp(Home)
    app.use(createPinia())
    app.use(router)
    app.use(TDesign)
    app.mount(container)

    const text = container.textContent ?? ''
    const indexes = [
      '工作台',
      '项目总数',
      '待处理事项',
      '资料处理状态',
      '最近项目',
      '最近动态',
      '业务处理趋势',
      '任务状态分布',
    ].map(title => text.indexOf(title))

    expect(indexes.every(index => index >= 0)).toBe(true)
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes)
  })

  it('keeps metrics non-clickable without real routes', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'Home', component: Home }],
    })
    await router.push('/')
    await router.isReady()

    app = createApp(Home)
    app.use(createPinia())
    app.use(router)
    app.use(TDesign)
    app.mount(container)

    // 路由表只有工作台本身，指标没有可跳转的真实路由，禁止生成假跳转
    expect(container.querySelectorAll('.app-metric-card.is-clickable')).toHaveLength(0)
  })
})
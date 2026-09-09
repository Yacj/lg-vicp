import { createPinia } from 'pinia'
import TDesign from 'tdesign-vue-next'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h } from 'vue'
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router'
import Home from './index.vue'

let app: ReturnType<typeof createApp> | null = null

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

/** 工作台待办与跳转依赖的承载路由（模拟菜单投影后已注册的静态/动态路由）。 */
function workspaceRoutes(): RouteRecordRaw[] {
  const placeholder = { render: () => h('div') }
  return [
    { path: '/', name: 'Home', component: Home },
    { path: '/projects', name: 'ProjectList', component: placeholder },
    { path: '/reports', name: 'ReportCenter', component: placeholder },
    { path: '/knowledge/documents', name: 'KnowledgeDocuments', component: placeholder },
    { path: '/knowledge/parsing-jobs', name: 'KnowledgeParsingJobs', component: placeholder },
    { path: '/products/series', name: 'ProductSeries', component: placeholder },
    { path: '/masterdata/materials', name: 'MaterialLibrary', component: placeholder },
    { path: '/standard/documents', name: 'StandardDocuments', component: placeholder },
    { path: '/standard/indicators', name: 'StandardIndicators', component: placeholder },
    { path: '/review-center/queue', name: 'ReviewQueue', component: placeholder },
  ]
}

async function flushAsync(rounds = 6): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

async function mountHome(routes: RouteRecordRaw[]): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  await router.isReady()

  app = createApp(Home)
  app.use(createPinia())
  app.use(router)
  app.use(TDesign)
  app.mount(container)
  await flushAsync()
  return container
}

describe('dashboard', () => {
  it('renders task workspaces with honest empty states, without dev placeholders', async () => {
    const container = await mountHome(workspaceRoutes())
    const text = container.textContent ?? ''

    for (const title of ['我的待办', '最近项目', '最近报告', '资料异常']) {
      expect(text).toContain(title)
    }

    // 待办分类入口按菜单投影路由渲染
    for (const label of ['知识资料', '产品数据', '标准指标', '报告']) {
      expect(text).toContain(label)
    }

    // 无数据时的诚实表达：接口不可用即空状态，不使用随机或假数据
    expect(text).toContain('暂无最近项目')
    expect(text).toContain('暂无资料异常')

    // 禁止保留开发占位文案
    for (const placeholder of [
      '数据接口待接入',
      '功能路由待接入',
      '统计契约待接入',
      '今日业务数据将在统计接口接入后自动更新',
    ]) {
      expect(text).not.toContain(placeholder)
    }
    expect(text).not.toContain('UI 体系')
  })

  it('keeps module order for single-column rendering (mobile)', async () => {
    const container = await mountHome(workspaceRoutes())
    const text = container.textContent ?? ''

    const indexes = [
      '工作台',
      '我的待办',
      '最近项目',
      '最近报告',
      '资料异常',
    ].map(title => text.indexOf(title))

    expect(indexes.every(index => index >= 0)).toBe(true)
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes)
  })

  it('hides todo entries when their routes are not projected for the user', async () => {
    const container = await mountHome([
      { path: '/', name: 'Home', component: Home },
    ])
    const text = container.textContent ?? ''

    // 路由表只有工作台本身：不渲染假跳转入口
    expect(container.querySelectorAll('.dashboard-todo-card')).toHaveLength(0)
    expect(text).toContain('暂无可进入的待办分类')
  })
})

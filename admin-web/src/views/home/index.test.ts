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

/** 工作台指标、待办与跳转依赖的承载路由（模拟菜单投影后已注册的静态/动态路由）。 */
function workspaceRoutes(): RouteRecordRaw[] {
  const placeholder = { render: () => h('div') }
  return [
    { path: '/', name: 'Home', component: Home },
    { path: '/projects', name: 'ProjectList', component: placeholder },
    { path: '/reports', name: 'ReportCenter', component: placeholder },
    { path: '/knowledge/documents', name: 'KnowledgeDocuments', component: placeholder },
    { path: '/knowledge/parsing-jobs', name: 'KnowledgeParsingJobs', component: placeholder },
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
  it('renders dashboard modules with honest empty states, without dev placeholders', async () => {
    const container = await mountHome(workspaceRoutes())
    const text = container.textContent ?? ''

    for (const title of ['待处理事项', '快捷入口', '最近项目', '最近报告', '资料异常']) {
      expect(text).toContain(title)
    }

    // 核心指标卡按可达路由渲染；测试环境无后端，计数保持 "--" 而非假数据
    for (const label of ['项目总数', '待处理知识文档', '待审核事项', '解析失败任务']) {
      expect(text).toContain(label)
    }

    // 无数据时的诚实表达：接口不可用即空状态，不使用随机或假数据
    expect(text).toContain('暂无待处理事项')
    expect(text).toContain('暂无最近项目')

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
      '待处理事项',
      '快捷入口',
      '最近项目',
      '最近报告',
    ].map(title => text.indexOf(title))

    expect(indexes.every(index => index >= 0)).toBe(true)
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes)
  })

  it('hides metric cards and quick actions when their routes are not projected for the user', async () => {
    const container = await mountHome([
      { path: '/', name: 'Home', component: Home },
    ])
    const text = container.textContent ?? ''

    // 路由表只有工作台本身：不渲染假跳转入口与空指标卡
    expect(container.querySelectorAll('.app-metric-card')).toHaveLength(0)
    expect(text).toContain('暂无可用入口')
    expect(text).toContain('暂无待处理事项')
  })
})

import type { ApiPage, MyReportItem } from '@/api/types'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test as nodeTest } from 'node:test'
import { runInNewContext } from 'node:vm'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import { reportResult } from '../../test/fixtures/report'
import * as reportTask from '../../utils/aiReportTask'

interface HostNode { text: string, children: HostNode[], parent: HostNode | null }
function node(text = ''): HostNode {
  return { text, children: [], parent: null }
}

function insert(item: HostNode, parent: HostNode, anchor: HostNode | null = null) {
  if (item.parent)
    item.parent.children.splice(item.parent.children.indexOf(item), 1)
  item.parent = parent
  const index = anchor ? parent.children.indexOf(anchor) : -1
  if (index >= 0)
    parent.children.splice(index, 0, item)
  else
    parent.children.push(item)
}

function fixture(page: number): ApiPage<MyReportItem> {
  return { page, pageSize: 20, total: 4, items: [0, 1].map(index => ({ id: `${page}-${index}`, title: '技术报告', reportType: 'technical_scheme', status: 'READY', createdAt: '2026-10-14', project: null })) }
}

async function setup(request: (page: number) => Promise<ApiPage<MyReportItem>> = async page => fixture(page)) {
  const show: Array<() => void> = []
  const hide: Array<() => void> = []
  const bottom: Array<() => void> = []
  const pull: Array<() => Promise<void>> = []
  const queries: Record<string, unknown>[] = []
  const details: string[] = []
  const route = vue.reactive({ query: { projectId: 'project-1' }, params: {} })
  const auth = vue.reactive({ user: { id: 'user-1' } })
  let refreshStops = 0
  const { descriptor } = parse(readFileSync(new URL('./index.vue', import.meta.url), 'utf8'))
  const source = compileScript(descriptor, { id: 'reports-test', inlineTemplate: true, templateOptions: { compilerOptions: { isCustomElement: tag => ['view', 'text'].includes(tag) } } }).content
  const exports: Record<string, any> = {}
  const modules: Record<string, any> = {
    'vue': vue,
    '@/api/modules/reports': { reportApi: {
      listMy: (params: Record<string, unknown>) => ({ send: async () => {
        queries.push({ ...params })
        return { data: await request(params.page as number) }
      } }),
      getDetail: (id: string) => ({ send: async () => {
        details.push(id)
        return { data: { report: { ...reportResult().report, id, publishedAt: null }, sources: [], availableFormats: [] } }
      } }),
    } },
    '@/components/report/ReportListCard.vue': { default: { render: () => vue.h('div') } },
    '@/composables/useAuthGate': { useAuthGate: () => ({ requireLogin: () => true }) },
    '@/composables/useBackNavigation': { useBackNavigation: () => ({ goBack: () => {} }) },
    '@/store/reportTypes': { useReportTypeStore: () => ({ ensureLoaded: async () => {} }) },
    '@/store/auth': { useAuthStore: () => auth },
    '@/utils/aiReportTask': reportTask,
  }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    ...vue,
    exports,
    require: (id: string) => modules[id] ?? {},
    definePage: () => {},
    useRoute: () => route,
    useRouter: () => ({ push: () => {} }),
    onShow: (callback: () => void) => show.push(callback),
    onHide: (callback: () => void) => hide.push(callback),
    onUnload: () => {},
    onReachBottom: (callback: () => void) => bottom.push(callback),
    onPullDownRefresh: (callback: () => Promise<void>) => pull.push(callback),
    uni: { stopPullDownRefresh: () => { refreshStops++ } },
  })
  // 生命周期/响应式竞态必须使用持续挂载的 Vue host；SSR 完成后 computed 不再参与页面更新。
  const renderer = vue.createRenderer<HostNode, HostNode>({
    createElement: () => node(),
    createText: text => node(text),
    createComment: () => node(),
    setText: (item, text) => { item.text = text },
    setElementText: (item, text) => {
      item.text = text
      item.children = []
    },
    patchProp: () => {},
    parentNode: item => item.parent,
    nextSibling: item => item.parent?.children[item.parent.children.indexOf(item) + 1] ?? null,
    insert,
    insertStaticContent: (text, parent, anchor) => {
      const item = node(text)
      insert(item, parent, anchor)
      return [item, item]
    },
    remove: (item) => {
      if (item.parent)
        item.parent.children.splice(item.parent.children.indexOf(item), 1)
    },
  })
  const app = renderer.createApp(exports.default)
  for (const name of ['wd-navbar', 'wd-loading', 'wd-empty', 'wd-icon', 'wd-button'])
    app.component(name, { render: () => vue.h('div') })
  app.mount(node())
  return { show, hide, bottom, pull, queries, details, route, auth, unmount: () => app.unmount(), refreshStops: () => refreshStops }
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve))

nodeTest('真实报告列表页面保留分页、项目筛选、下拉刷新；返回列表重新读取历史状态', async () => {
  const page = await setup()
  page.show[0]()
  await flush()
  page.bottom[0]()
  await flush()
  assert.deepEqual(page.queries.map(query => query.page), [1, 2])
  assert.ok(page.queries.every(query => query.projectId === 'project-1' && query.pageSize === 20))
  assert.equal(page.details.length, 4)
  page.hide[0]()
  page.show[0]()
  await flush()
  await page.pull[0]()
  assert.deepEqual(page.queries.map(query => query.page), [1, 2, 1, 1])
  assert.equal(page.refreshStops(), 1)
  page.hide[0]()
  page.unmount()
})

nodeTest('隐藏/项目或账号变化后的旧分页响应不读取详情或恢复旧列表', async () => {
  for (const change of ['hide', 'project', 'account']) {
    let resolve!: (page: ApiPage<MyReportItem>) => void
    const page = await setup(() => new Promise((done) => {
      resolve = done
    }))
    page.show[0]()
    if (change === 'hide')
      page.hide[0]()
    if (change === 'project')
      page.route.query.projectId = 'project-2'
    if (change === 'account')
      page.auth.user.id = 'user-2'
    resolve(fixture(1))
    await flush()
    assert.equal(page.details.length, 0, change)
    page.hide[0]()
    page.unmount()
  }
})

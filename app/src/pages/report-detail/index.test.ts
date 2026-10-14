import type { ReportDetail } from '@/api/types'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test as nodeTest } from 'node:test'
import { runInNewContext } from 'node:vm'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import { renderToString } from 'vue/server-renderer'
import { formatReportDate, reportTypeLabel } from '../../constants/reports'
import { reportResult } from '../../test/fixtures/report'
import * as reportTask from '../../utils/aiReportTask'

function fixture(status = 'READY', formats: ReportDetail['availableFormats'] = ['PDF']): ReportDetail {
  return { report: { ...reportResult().report, status }, project: null, sources: [], availableFormats: formats, task: null, solutionSnapshotId: 'snapshot-1' }
}

async function render(detail: ReportDetail | null, options: { platform?: string, status?: string, error?: string } = {}) {
  const show: Array<() => void> = []
  const hide: Array<() => void> = []
  const actions: string[] = []
  const signs: string[] = []
  const buttons: Array<{ label: string, click: () => Promise<void> }> = []
  const resource = { detail: vue.ref(detail), status: vue.ref(options.status ?? 'success'), errorMessage: vue.ref(options.error ?? ''), refreshing: vue.ref(false), retrying: vue.ref(false), start: async () => {}, stop: () => actions.push('stop'), reset: () => {}, refresh: async () => {}, retry: async () => false }
  const source = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const compiled = compileScript(descriptor, { id: 'report-detail-test', inlineTemplate: true, templateOptions: { compilerOptions: { isCustomElement: tag => ['view', 'text'].includes(tag) } } }).content
  const exports: Record<string, any> = {}
  const modules: Record<string, any> = {
    'vue': vue,
    '@/api/modules/reports': { reportApi: {
      getArtifactPreviewUrl: () => ({ send: async () => {
        signs.push('preview')
        return { data: { url: 'fixture-preview', expiresIn: 60 } }
      } }),
      getArtifactDownloadUrl: () => ({ send: async () => {
        signs.push('download')
        return { data: { url: 'fixture-download', expiresIn: 60 } }
      } }),
    } },
    '@/composables/useAuthGate': { useAuthGate: () => ({ requireLogin: () => true }) },
    '@/composables/useBackNavigation': { useBackNavigation: () => ({ goBack: () => {} }) },
    '@/composables/useReportDetail': { useReportDetail: () => resource },
    '@/constants/reports': { formatReportDate, reportTypeLabel },
    '@/store/auth': { useAuthStore: () => ({ user: { id: 'user-1' } }) },
    '@/store/reportTypes': { useReportTypeStore: () => ({ ensureLoaded: async () => {} }) },
    '@/services/platform': { getPlatformInfo: () => ({ platform: options.platform ?? 'h5' }) },
    '@/services/files/openOriginalFile': { openOriginalFile: async (input: { getUrl: () => Promise<unknown>, mode: string }) => {
      actions.push(input.mode)
      await input.getUrl()
    } },
    '@/utils/aiReportTask': reportTask,
  }
  runInNewContext(ts.transpileModule(compiled, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    require: (id: string) => modules[id] ?? {},
    definePage: () => {},
    useRoute: () => ({ query: { id: 'report-1' }, params: {} }),
    useRouter: () => ({ push: () => {} }),
    useGlobalToast: () => ({ error: () => {}, success: () => {} }),
    onShow: (callback: () => void) => show.push(callback),
    onHide: (callback: () => void) => hide.push(callback),
    onUnload: () => {},
  })
  const app = vue.createSSRApp(exports.default)
  const text = (nodes: vue.VNode[]): string => nodes.map(node => typeof node.children === 'string' ? node.children : Array.isArray(node.children) ? text(node.children as vue.VNode[]) : '').join('')
  app.component('wd-button', vue.defineComponent({ setup(_props, { attrs, slots }) {
    return () => {
      const children = slots.default?.() ?? []
      buttons.push({ label: text(children).trim(), click: attrs.onClick as () => Promise<void> })
      return vue.h('button', attrs, children)
    }
  } }))
  for (const name of ['wd-navbar', 'wd-icon', 'wd-loading', 'wd-action-sheet'])
    app.component(name, { render() { return vue.h('div') } })
  const html = await renderToString(app)
  return { html, buttons, show, hide, actions, signs }
}

nodeTest('正式空 JSON 报告使用 PDF 区；READY 无文件、生成中、失败、审核和发布明确区分', async () => {
  const ready = await render(fixture())
  for (const label of ['PDF 已就绪', '预览 PDF', '下载 PDF', '确认方案编号：snapshot-1', '未发布']) assert.ok(ready.html.includes(label), label)
  const missing = await render(fixture('READY', []))
  assert.ok(missing.html.includes('PDF 尚未生成或文件已失效'))
  assert.ok(!missing.html.includes('预览 PDF'))
  const pending = await render({ ...fixture('GENERATING', []), task: { id: 'task', status: 'ACTIVE', progress: 35, errorMessage: null } })
  for (const label of ['正在生成报告', '任务执行中', '35%', '正在等待生成']) assert.ok(pending.html.includes(label), label)
  const failed = await render({ ...fixture('FAILED', []), report: { ...fixture().report, status: 'FAILED', errorMessage: '模板已失效' } })
  assert.ok(failed.html.includes('重新生成'))
  assert.ok(failed.html.includes('模板已失效'))
  for (const [status, label] of [['PENDING_REVIEW', '审核中'], ['APPROVED', '审核通过'], ['REJECTED', '审核未通过']]) {
    const view = await render(fixture(status))
    assert.ok(view.html.includes(label))
    assert.ok(!view.html.includes('重新生成'))
  }
  const published = await render({ ...fixture('APPROVED'), report: { ...fixture('APPROVED').report, publishedAt: '2026-10-14' } })
  assert.ok(published.html.includes('已发布'))
})

nodeTest('旧 AI/历史技术 JSON 章节保持展示，权限失败只展示后端原因', async () => {
  for (const reportType of ['ai_conversation', 'technical_scheme']) {
    const old = await render({ ...fixture('READY', []), solutionSnapshotId: null, report: { ...fixture().report, reportType, contentJson: { summary: '旧摘要', sections: [{ heading: '旧章节', content: '旧内容' }], risks: ['旧风险'], disclaimer: '旧免责声明' } } })
    for (const label of ['旧摘要', '旧章节', '旧内容', '旧风险', '旧免责声明']) assert.ok(old.html.includes(label), label)
  }
  const denied = await render(null, { status: 'error', error: '报告尚未发布或无权查看' })
  assert.ok(denied.html.includes('报告尚未发布或无权查看'))
  assert.ok(!denied.html.includes('预览 PDF'))
})

nodeTest('真实页面点击分别实时请求 preview/download；App/微信展示保存并打开，隐藏停止详情刷新', async () => {
  for (const platform of ['h5', 'app', 'mp-weixin']) {
    const page = await render(fixture(), { platform })
    page.show.forEach(callback => callback())
    await page.buttons.find(button => button.label === '预览 PDF')!.click()
    await page.buttons.find(button => button.label === (platform === 'h5' ? '下载 PDF' : '保存并打开 PDF'))!.click()
    assert.deepEqual(page.signs, ['preview', 'download'])
    assert.deepEqual(page.actions, ['preview', 'download'])
    page.hide.forEach(callback => callback())
    assert.equal(page.actions.at(-1), 'stop')
  }
})

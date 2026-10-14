import type { CreateReportResult, ReportDetail } from '@/api/types'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test as nodeTest } from 'node:test'
import { runInNewContext } from 'node:vm'
import { createPinia, defineStore } from 'pinia'
import ts from 'typescript'
import { reportResult } from '../test/fixtures/report'
import { solutionFixture } from '../test/fixtures/solution'
import * as agentUi from '../utils/aiAgentUi'
import * as reportTask from '../utils/aiReportTask'
import * as selection from '../utils/aiUserSelection'
import * as solution from './solution'

/** 执行真实 assistant store，仅替换平台/网络/计时器，不加载配置或访问 Backend。 */
function setup(options: { detail?: () => Promise<ReportDetail>, result?: CreateReportResult, create?: () => Promise<CreateReportResult> } = {}) {
  const auth = { user: { id: 'user-1' }, accessToken: 'fixture-token' }
  const timers = new Map<number, () => void>()
  const exports: Record<string, any> = {}
  let nextTimer = 0
  let streams = 0
  let creates = 0
  const modules: Record<string, unknown> = {
    'pinia': { defineStore },
    './solution': solution,
    '@/store/auth': { useAuthStore: () => auth },
    '@/api/modules/ai': { aiApi: {} },
    '@/api/modules/reports': { reportApi: {
      create: () => ({ send: async () => {
        creates++
        return { data: await (options.create?.() ?? Promise.resolve(options.result ?? reportResult())) }
      } }),
      getDetail: () => ({ send: async () => ({ data: await options.detail?.() }) }),
      retry: () => ({ send: async () => ({ data: { reportId: 'report-1', taskId: 'retry-task', status: 'GENERATING' } }) }),
    } },
    '@/utils/aiReportTask': reportTask,
    '@/utils/aiUserSelection': selection,
    '@/utils/aiAgentUi': agentUi,
    '@/utils/aiSource': { normalizeAiSources: (value: unknown) => value },
    '@/utils/aiStream': { parseStreamEvent: (event: string, data: unknown) => ({ event, data }) },
    '@/services/platform': { createAiStreamRequest: () => { streams++ } },
  }
  const source = readFileSync(new URL('./assistant.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  runInNewContext(compiled, {
    exports,
    require: (id: string) => modules[id] ?? {},
    setTimeout: (callback: () => void) => {
      const id = ++nextTimer
      timers.set(id, callback)
      return id
    },
    clearTimeout: (id: number) => timers.delete(id),
  })
  const store = exports.useAssistantStore(createPinia())
  store.conversation = { id: 'conversation-1', userId: 'user-1', projectId: null }
  store.loadState = 'ready'
  store.restoreSolutionState(solutionFixture({ stage: 'CONFIRMED', confirmedSnapshotId: 'snapshot-1' }))
  return {
    store,
    auth,
    timers,
    creates: () => creates,
    streams: () => streams,
    tick: () => {
      const timer = timers.entries().next().value
      assert.ok(timer)
      timers.delete(timer[0])
      timer[1]()
    },
  }
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve))

nodeTest('真实 assistant 动作创建→同一 sessionReport→详情轮询，READY 不覆盖普通聊天', async () => {
  const detail: ReportDetail = { report: { ...reportResult().report, status: 'READY' }, project: null, sources: [], solutionSnapshotId: 'snapshot-1', task: { id: 'task-1', status: 'COMPLETED', progress: 100, errorMessage: null }, availableFormats: ['PDF'] }
  const context = setup({ detail: async () => detail })
  context.store.messages = [{ id: 'ordinary', role: 'ASSISTANT', content: '原有工程回答', status: 'COMPLETED' }]
  assert.equal(await context.store.createConfirmedReport(), true)
  assert.equal(context.creates(), 1)
  assert.equal(context.store.sessionReport.status, 'QUEUED')
  context.tick()
  await flush()
  assert.equal(context.store.sessionReport.status, 'READY')
  assert.equal(context.store.sessionReport.task.status, 'COMPLETED')
  assert.deepEqual(Array.from(context.store.sessionReport.availableFormats), ['PDF'])
  assert.equal(context.store.messages[0].content, '原有工程回答')
  assert.equal(context.timers.size, 0)
  context.store.handleStreamEvent({ event: 'done', data: { messageId: 'ordinary', sources: [] } }, context.store.streamRevision, 'conversation-1')
  assert.equal(context.store.messages[0].content, '原有工程回答')
})

nodeTest('页面隐藏、账号/会话切换期间的轮询响应不回写或重新安排计时器', async () => {
  for (const change of ['hide', 'account', 'conversation']) {
    let resolve!: (detail: ReportDetail) => void
    const context = setup({ detail: () => new Promise((done) => {
      resolve = done
    }) })
    await context.store.createConfirmedReport()
    context.tick()
    if (change === 'hide')
      context.store.setReportPageVisible(false)
    if (change === 'account')
      context.auth.user.id = 'other'
    if (change === 'conversation') {
      context.store.conversation.id = 'other'
      context.store.loadRevision++
    }
    resolve({ report: { ...reportResult().report, status: 'READY' }, sources: [], availableFormats: ['PDF'] })
    await flush()
    assert.equal(context.store.sessionReport.status, 'QUEUED')
    assert.equal(context.timers.size, 0)
  }
})

nodeTest('静默 GENERATE_REPORT 被拒，单报告选项保持可见，未发送 resume 请求', async () => {
  const context = setup()
  context.store.applyWaitingPayload({ runId: 'run', type: 'USER_SELECTION', selectionKind: 'REPORT_TYPE', options: [{ id: 'technical_scheme', title: '技术方案报告' }], confirmAction: { type: 'GENERATE_REPORT', label: '生成报告' } })
  assert.equal(context.store.pendingUserInput.hidden, false)
  assert.equal(context.streams(), 0)
  context.store.selectionSelectedIds = ['technical_scheme']
  assert.equal(await context.store.confirmSelection({ silent: true }), false)
  assert.equal(context.streams(), 0)
  assert.equal(context.store.sendLock, false)
  assert.equal(context.creates(), 0)
})

nodeTest('失败重试消费服务端实际 GENERATING 和新 taskId，保持原 reportId', async () => {
  const context = setup({ result: reportResult({ status: 'FAILED', reused: true }) })
  await context.store.createConfirmedReport()
  assert.equal(await context.store.retrySessionReport(), true)
  assert.equal(context.store.sessionReport.id, 'report-1')
  assert.equal(context.store.sessionReport.status, 'GENERATING')
  assert.equal(context.store.sessionReport.taskId, 'retry-task')
  assert.equal(context.store.retryingReport, false)
  context.store.stopReportPolling()
})

nodeTest('退出后同账号重登同会话，旧创建成功不能覆盖新任务或释放新请求锁', async () => {
  const resolves: Array<(value: CreateReportResult) => void> = []
  const context = setup({ create: () => new Promise((done) => {
    resolves.push(done)
  }) })
  const old = context.store.createConfirmedReport()
  context.store.resetForAccountChange()
  context.store.conversation = { id: 'conversation-1', userId: 'user-1', projectId: null }
  context.store.loadState = 'ready'
  context.store.restoreSolutionState(solutionFixture({ stage: 'CONFIRMED', confirmedSnapshotId: 'snapshot-1' }))
  const current = context.store.createConfirmedReport()
  resolves[0](reportResult())
  assert.equal(await old, false)
  assert.equal(context.store.sessionReport, null)
  assert.equal(context.store.solutionReportCreating, true)
  resolves[1](reportResult({ report: { ...reportResult().report, id: 'report-2' } }))
  assert.equal(await current, true)
  assert.equal(context.store.sessionReport.id, 'report-2')
  context.store.stopReportPolling()
})

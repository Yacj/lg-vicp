import type { CreateReportBody, CreateReportResult, ReportDetail, ReportItem, ReportTaskResult } from '@/api/types'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test as nodeTest } from 'node:test'
import { runInNewContext } from 'node:vm'
import { createPinia, defineStore } from 'pinia'
import ts from 'typescript'
import { reportResult } from '../test/fixtures/report'
import { snapshotFixture, solutionFixture } from '../test/fixtures/solution'
import * as agentUi from '../utils/aiAgentUi'
import * as answerUx from '../utils/aiAnswerUx'
import * as processing from '../utils/aiProcessing'
import * as reportTask from '../utils/aiReportTask'
import * as selection from '../utils/aiUserSelection'
import * as solution from './solution'

/** 执行真实 assistant store，仅替换平台/网络/计时器，不加载配置或访问 Backend。 */
function setup(options: { detail?: () => Promise<ReportDetail>, result?: CreateReportResult, create?: () => Promise<CreateReportResult>, retry?: () => Promise<ReportTaskResult>, history?: () => Promise<ReportItem[]> } = {}) {
  const auth = { user: { id: 'user-1' }, accessToken: 'fixture-token' }
  const timers = new Map<number, () => void>()
  const exports: Record<string, any> = {}
  let nextTimer = 0
  let streams = 0
  let creates = 0
  const bodies: CreateReportBody[] = []
  const modules: Record<string, unknown> = {
    'pinia': { defineStore },
    './solution': solution,
    '@/store/auth': { useAuthStore: () => auth },
    '@/api/modules/ai': { aiApi: {
      stopMessage: () => ({ send: async () => ({ success: true }) }),
      solutionAction: () => ({ send: async () => ({ data: { solutionState: solutionFixture({ stage: 'CONFIRMED', confirmedSnapshotId: 'snapshot-1' }), snapshot: snapshotFixture() } }) }),
      getConversation: () => ({ send: async () => ({ data: { reports: await options.history?.() ?? [] } }) }),
    } },
    '@/api/modules/reports': { reportApi: {
      create: (body: CreateReportBody) => ({ send: async () => {
        creates++
        bodies.push(body)
        return { data: await (options.create?.() ?? Promise.resolve(options.result ?? reportResult())) }
      } }),
      getDetail: () => ({ send: async () => ({ data: await options.detail?.() }) }),
      retry: () => ({ send: async () => ({ data: await (options.retry?.() ?? Promise.resolve({ reportId: 'report-1', taskId: 'retry-task', status: 'GENERATING' })) }) }),
    } },
    '@/utils/aiReportTask': reportTask,
    '@/utils/aiUserSelection': selection,
    '@/utils/aiAgentUi': agentUi,
    '@/utils/aiAnswerUx': answerUx,
    '@/utils/aiProcessing': processing,
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
    bodies,
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

nodeTest('本地停止先冻结处理步骤，迟到SSE不能把未完成步骤改为成功', async () => {
  const { store } = setup()
  store.messages = [{ id: 'answer', role: 'ASSISTANT', content: '', status: 'STREAMING', processingSteps: [
    { key: 'understanding', message: '正在理解你的问题…', status: 'active' },
  ] }]
  store.streamingMessageId = 'answer'
  store.isStreaming = true
  const revision = store.streamRevision
  await store.stopStreaming()
  assert.equal(store.messages[0].processingSteps[0].status, 'stopped')
  assert.equal(store.messages[0].processingSteps[0].message, '本步已停止')
  store.handleStreamEvent({ event: 'progress', data: { stage: 'analyzing', stepId: 'understanding', status: 'done', message: '已梳理问题' } }, revision, 'conversation-1')
  assert.equal(store.messages[0].processingSteps[0].status, 'stopped')
})

nodeTest('思考计时在首段正文到达时结束，后续正文和done不延长耗时', () => {
  const { store } = setup()
  store.messages = [{ id: 'timed-answer', role: 'ASSISTANT', content: '', status: 'STREAMING' }]
  const revision = store.startStreaming('timed-answer')
  assert.ok(store.messages[0].processingStartedAt > 0)
  store.handleStreamEvent({ event: 'delta', data: { text: ' ' } }, revision, 'conversation-1')
  assert.equal(store.messages[0].processingFinishedAt, undefined)
  store.handleStreamEvent({ event: 'delta', data: { text: '已查到的资料如下。' } }, revision, 'conversation-1')
  const ended = store.messages[0].processingFinishedAt
  assert.ok(ended >= store.messages[0].processingStartedAt)
  store.handleStreamEvent({ event: 'delta', data: { text: '继续输出正文。' } }, revision, 'conversation-1')
  store.handleStreamEvent({ event: 'done', data: { messageId: 'timed-answer', sources: [] } }, revision, 'conversation-1')
  assert.equal(store.messages[0].processingFinishedAt, ended)
})

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

nodeTest('正式 PDF 排队/生成/完成期间，普通聊天 delta 仍写入当前回答', async () => {
  for (const status of ['QUEUED', 'GENERATING', 'READY']) {
    const context = setup({ result: reportResult({ status }) })
    await context.store.createConfirmedReport()
    context.store.messages = [{ id: 'ordinary', role: 'ASSISTANT', content: '原有回答', status: 'STREAMING' }]
    context.store.streamingMessageId = 'ordinary'
    context.store.handleStreamEvent({ event: 'delta', data: { text: '继续说明' } }, context.store.streamRevision, 'conversation-1')
    assert.equal(context.store.messages[0].content, '原有回答继续说明', status)
    context.store.stopReportPolling()
  }
})

nodeTest('SSE report_queued 与 REST 复用同一任务，只抑制该报告对应消息的 delta', async () => {
  const context = setup()
  await context.store.createConfirmedReport()
  context.store.messages = [{ id: 'report-message', role: 'ASSISTANT', content: '', status: 'STREAMING' }]
  context.store.streamingMessageId = 'report-message'
  context.store.handleStreamEvent({ event: 'report_queued', data: { reportId: 'report-1', status: 'QUEUED' } }, context.store.streamRevision, 'conversation-1')
  assert.equal(context.store.sessionReport.id, 'report-1')
  assert.equal(context.store.sessionReport.messageId, 'report-message')
  assert.equal(context.timers.size, 1)
  context.store.handleStreamEvent({ event: 'delta', data: { text: '报告生成中' } }, context.store.streamRevision, 'conversation-1')
  assert.equal(context.store.messages[0].content, '')
  context.store.stopReportPolling()
})

nodeTest('报告轮询遇到 401/403/404 显示后端原文并停止，不伪造 FAILED/READY', async () => {
  for (const code of [401, 403, 404]) {
    const context = setup({ detail: async () => {
      throw Object.assign(new Error('请求失败'), { code, data: { error: { code, message: '报告不存在或无权查看' } } })
    } })
    await context.store.createConfirmedReport()
    context.tick()
    await flush()
    assert.equal(context.timers.size, 0, String(code))
    assert.equal(context.store.sessionReport.status, 'QUEUED')
    assert.equal(context.store.sessionReport.errorMessage, '报告不存在或无权查看')
  }
})

nodeTest('轮询错误归属不绑定；DRAFT 不继续轮询；临时网络失败仍可恢复', async () => {
  for (const scenario of ['wrong-id', 'draft', 'network']) {
    const context = setup({ detail: async () => {
      if (scenario === 'network')
        throw new Error('网络暂时不可用')
      return { report: { ...reportResult().report, id: scenario === 'wrong-id' ? 'other' : 'report-1', status: scenario === 'draft' ? 'DRAFT' : 'READY' }, sources: [], availableFormats: ['PDF'] }
    } })
    await context.store.createConfirmedReport()
    context.tick()
    await flush()
    assert.equal(context.store.sessionReport.reportStatus, scenario === 'draft' ? 'DRAFT' : 'QUEUED')
    assert.equal(context.timers.size, scenario === 'network' ? 1 : 0, scenario)
    context.store.stopReportPolling()
  }
})

nodeTest('重试错误 reportId 不改当前任务，权限失败在任务卡显示后端消息', async () => {
  for (const wrongId of [true, false]) {
    const context = setup({ result: reportResult({ status: 'FAILED' }), retry: async () => {
      if (!wrongId)
        throw Object.assign(new Error('请求失败'), { data: { error: { code: 403, message: '当前用户无权重新生成' } } })
      return { message: '', reportId: 'other', taskId: 'other-task', status: 'READY' }
    } })
    await context.store.createConfirmedReport()
    assert.equal(await context.store.retrySessionReport(), false)
    assert.equal(context.store.sessionReport.reportStatus, 'FAILED')
    assert.equal(context.store.sessionReport.taskId, 'task-1')
    assert.match(context.store.sessionReport.errorMessage, wrongId ? /不一致/ : /当前用户无权重新生成/)
    assert.equal(context.timers.size, 0)
  }
})

nodeTest('Fixture Final→Confirm→显式创建→生成→PDF 详情→历史恢复，工程参数不改写', async () => {
  let status = 'QUEUED'
  const context = setup({ detail: async () => ({ report: { ...reportResult().report, status }, solutionSnapshotId: 'snapshot-1', sources: [], task: { id: 'task-1', status: status === 'READY' ? 'COMPLETED' : 'ACTIVE', progress: status === 'READY' ? 100 : 40, errorMessage: null }, availableFormats: status === 'READY' ? ['PDF'] : [] }) })
  context.store.restoreSolutionState(solutionFixture({ stage: 'READY_TO_CONFIRM', selectedCandidateIds: ['A'], finalCandidateIds: ['A'] }))
  assert.equal(await context.store.createConfirmedReport(), false)
  assert.equal(await context.store.performSolutionAction('CONFIRM', ['A']), true)
  assert.equal(context.creates(), 0)
  const frozen = JSON.stringify(context.store.solutionSnapshot)
  assert.equal(await context.store.createConfirmedReport(), true)
  assert.deepEqual(context.bodies, [{ reportType: 'technical_scheme', conversationId: 'conversation-1', solutionSnapshotId: 'snapshot-1' }])
  status = 'GENERATING'
  context.tick()
  await flush()
  assert.equal(context.store.sessionReport.task.progress, 40)
  assert.equal(reportTask.reportTaskPresentation(context.store.sessionReport).canPreviewPdf, false)
  status = 'READY'
  context.tick()
  await flush()
  assert.equal(reportTask.reportTaskPresentation(context.store.sessionReport).canPreviewPdf, true)
  assert.equal(JSON.stringify(context.store.solutionSnapshot), frozen)
  assert.equal(context.store.solutionState.stage, 'CONFIRMED')
  assert.equal(context.timers.size, 0)
  const restored = setup({ history: async () => [{ ...reportResult().report, status: 'GENERATING', artifacts: [], sources: [] }] })
  await restored.store.refreshSessionReport()
  assert.equal(restored.store.sessionReport.id, 'report-1')
  assert.equal(restored.creates(), 0)
  assert.equal(restored.timers.size, 1)
  restored.store.stopReportPolling()
})

nodeTest('历史恢复的迟到响应不覆盖新报告，账号/会话变化和同账号重登均失效', async () => {
  for (const change of ['new-report', 'account', 'conversation', 'relogin']) {
    let resolve!: (reports: ReportItem[]) => void
    const context = setup({ history: () => new Promise((done) => {
      resolve = done
    }) })
    const pending = context.store.refreshSessionReport()
    if (change === 'new-report')
      await context.store.createConfirmedReport()
    if (change === 'account')
      context.auth.user.id = 'other'
    if (change === 'conversation')
      context.store.conversation.id = 'other'
    if (change === 'relogin') {
      context.store.resetForAccountChange()
      context.store.conversation = { id: 'conversation-1', userId: 'user-1', projectId: null }
    }
    resolve([{ ...reportResult().report, id: 'old-history', status: 'GENERATING', artifacts: [], sources: [] }])
    await pending
    assert.equal(context.store.sessionReport?.id ?? null, change === 'new-report' ? 'report-1' : null, change)
    context.store.stopReportPolling()
  }
})

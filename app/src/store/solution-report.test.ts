import type { SolutionUpdate } from '@/api/solution-types'
import type { CreateReportBody, CreateReportResult } from '@/api/types'
import type { SessionReport } from '@/utils/aiAgentUi'
import assert from 'node:assert/strict'
import { test as nodeTest } from 'node:test'
import { createPinia, defineStore } from 'pinia'
import { reportResult } from '../test/fixtures/report'
import { snapshotFixture, solutionFixture } from '../test/fixtures/solution'
import { createSolutionActions, solutionInitialState } from './solution'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function setup(create: (body: CreateReportBody) => Promise<CreateReportResult> = async () => reportResult()) {
  const bodies: CreateReportBody[] = []
  const polls: string[] = []
  let userId: string | null = 'user-1'
  const revise = deferred<SolutionUpdate>()
  const useStore = defineStore('solution-report-test', {
    state: () => ({ ...solutionInitialState(), conversation: { id: 'conversation-1', userId: 'user-1' }, loadRevision: 0, sessionReport: null as SessionReport | null }),
    actions: {
      ...createSolutionActions({
        getSolution: () => ({ send: async () => ({ data: solutionFixture() }) }),
        getSolutionSnapshot: () => ({ send: async () => ({ data: snapshotFixture() }) }),
        solutionAction: (_id, body) => ({ send: async () => ({ data: body.action === 'CONFIRM'
          ? { solutionState: solutionFixture({ stage: 'CONFIRMED', confirmedSnapshotId: 'snapshot-1' }), snapshot: snapshotFixture() }
          : await revise.promise }) }),
      }, {
        create: body => ({ send: async () => {
          bodies.push(body)
          return { data: await create(body) }
        } }),
        currentUserId: () => userId,
        canCreate: () => true,
      }),
      applyReportTask(report: SessionReport) { this.sessionReport = report },
      startReportPolling(id: string) { polls.push(id) },
      stopReportPolling() {},
    },
  })
  const store = useStore(createPinia())
  store.restoreSolutionState(solutionFixture({ stage: 'READY_TO_CONFIRM', finalCandidateIds: ['A'] }))
  return { store, bodies, polls, revise, setUser: (value: string | null) => {
    userId = value
  } }
}

nodeTest('Fixture Confirm 不创建报告，显式创建才发送当前快照且不修改方案事实', async () => {
  const { store, bodies, polls } = setup()
  assert.equal(await store.createConfirmedReport(), false)
  await store.performSolutionAction('CONFIRM', ['A'])
  assert.deepEqual(bodies, [])
  const before = JSON.stringify(store.solutionState)
  assert.equal(await store.createConfirmedReport(), true)
  assert.deepEqual(bodies, [{ reportType: 'technical_scheme', conversationId: 'conversation-1', solutionSnapshotId: 'snapshot-1' }])
  assert.equal(store.sessionReport?.id, 'report-1')
  assert.equal(store.sessionReport?.solutionSnapshotId, 'snapshot-1')
  assert.equal(store.sessionReport?.status, 'QUEUED')
  assert.deepEqual(polls, ['report-1'])
  assert.equal(JSON.stringify(store.solutionState), before)
})

nodeTest('双击只提交一次；READY/FAILED reused 不伪造新任务或强制排队', async () => {
  for (const status of ['QUEUED', 'READY', 'FAILED']) {
    const result = deferred<CreateReportResult>()
    const { store, bodies, polls } = setup(() => result.promise)
    await store.performSolutionAction('CONFIRM', ['A'])
    const first = store.createConfirmedReport()
    assert.equal(store.solutionReportCreating, true)
    assert.equal(await store.createConfirmedReport(), false)
    result.resolve(reportResult({ status, reused: true }))
    assert.equal(await first, true)
    assert.equal(bodies.length, 1)
    assert.equal(store.sessionReport?.id, 'report-1')
    assert.equal(store.sessionReport?.status, status)
    assert.equal(store.sessionReport?.reused, true)
    assert.equal(store.solutionReportCreating, false)
    assert.equal(polls.length, status === 'QUEUED' ? 1 : 0)
  }
})

nodeTest('后端拒绝展示原消息，释放锁，用户可按原 Snapshot 再试', async () => {
  let attempt = 0
  const { store, bodies } = setup(async () => {
    if (++attempt === 1)
      throw new Error('方案快照已变化，请刷新')
    return reportResult()
  })
  await store.performSolutionAction('CONFIRM', ['A'])
  assert.equal(await store.createConfirmedReport(), false)
  assert.equal(store.solutionReportError, '方案快照已变化，请刷新')
  assert.equal(store.solutionReportCreating, false)
  assert.equal(store.sessionReport, null)
  assert.equal(await store.createConfirmedReport(), true)
  assert.equal(store.solutionReportError, '')
  assert.deepEqual(bodies[0], bodies[1])
})

nodeTest('换会话、重进、账号切换、Snapshot 切换后的迟到成功或失败均不绑定新上下文', async () => {
  for (const change of ['conversation', 'reenter', 'account', 'snapshot']) {
    for (const fail of [false, true]) {
      const result = deferred<CreateReportResult>()
      const context = setup(() => result.promise)
      await context.store.performSolutionAction('CONFIRM', ['A'])
      const pending = context.store.createConfirmedReport()
      if (change === 'conversation') {
        context.store.clearSolution()
        context.store.conversation = { id: 'conversation-2', userId: 'user-1' }
      }
      if (change === 'reenter') {
        context.store.clearSolution()
        context.store.restoreSolutionState(solutionFixture({ stage: 'CONFIRMED', confirmedSnapshotId: 'snapshot-1' }))
      }
      if (change === 'account')
        context.setUser('user-2')
      if (change === 'snapshot')
        context.store.applySolutionState({ solutionState: solutionFixture({ stage: 'CONFIRMED', confirmedSnapshotId: 'snapshot-2' }) })
      if (fail)
        result.reject(new Error('旧请求失败'))
      else
        result.resolve(reportResult())
      assert.equal(await pending, false)
      assert.equal(context.store.sessionReport, null)
      assert.equal(context.store.solutionReportError, '')
      assert.equal(context.polls.length, 0)
    }
  }
})

nodeTest('继续调整点击即废弃报告请求，不等修订响应', async () => {
  const result = deferred<CreateReportResult>()
  const { store, revise } = setup(() => result.promise)
  await store.performSolutionAction('CONFIRM', ['A'])
  const creating = store.createConfirmedReport()
  const revising = store.performSolutionAction('REVISE')
  result.resolve(reportResult())
  assert.equal(await creating, false)
  assert.equal(store.sessionReport, null)
  revise.resolve({ solutionState: solutionFixture({ id: 'state-2' }) })
  await revising
  assert.equal(store.solutionState?.id, 'state-2')
})

nodeTest('旧请求返回不能释放新 Snapshot 的创建锁', async () => {
  const first = deferred<CreateReportResult>()
  const second = deferred<CreateReportResult>()
  let call = 0
  const { store } = setup(() => ++call === 1 ? first.promise : second.promise)
  await store.performSolutionAction('CONFIRM', ['A'])
  const old = store.createConfirmedReport()
  store.applySolutionState({ solutionState: solutionFixture({ stage: 'CONFIRMED', confirmedSnapshotId: 'snapshot-2' }) })
  const current = store.createConfirmedReport()
  first.resolve(reportResult())
  assert.equal(await old, false)
  assert.equal(store.solutionReportCreating, true)
  second.resolve(reportResult({ solutionSnapshotId: 'snapshot-2' }))
  assert.equal(await current, true)
  assert.equal(store.solutionReportCreating, false)
  assert.equal(store.sessionReport?.solutionSnapshotId, 'snapshot-2')
})

nodeTest('缺快照、非本人会话以及错误归属响应拒绝绑定', async () => {
  const { store, bodies } = setup()
  store.restoreSolutionState(solutionFixture({ stage: 'CONFIRMED' }))
  assert.equal(await store.createConfirmedReport(), false)
  store.restoreSolutionState(solutionFixture({ stage: 'CONFIRMED', confirmedSnapshotId: 'snapshot-1' }))
  store.conversation.userId = 'other'
  assert.equal(await store.createConfirmedReport(), false)
  assert.deepEqual(bodies, [])
  for (const field of ['snapshot', 'conversation']) {
    const context = setup(async () => field === 'snapshot'
      ? reportResult({ solutionSnapshotId: 'other' })
      : reportResult({ report: { ...reportResult().report, conversationId: 'other' } }))
    await context.store.performSolutionAction('CONFIRM', ['A'])
    assert.equal(await context.store.createConfirmedReport(), false)
    assert.equal(context.store.sessionReport, null)
    assert.match(context.store.solutionReportError, /不一致/)
  }
})

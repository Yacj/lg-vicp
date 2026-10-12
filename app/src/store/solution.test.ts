import type { SolutionActionBody, SolutionStateDto, SolutionUpdate } from '@/api/solution-types'
import assert from 'node:assert/strict'
import { test as nodeTest } from 'node:test'
import { createPinia, defineStore } from 'pinia'
import { snapshotFixture, solutionCandidate, solutionFixture } from '../test/fixtures/solution'
import { createSolutionActions, solutionInitialState } from './solution'

function setup(options: { act?: (body: SolutionActionBody) => Promise<SolutionUpdate>, get?: () => Promise<SolutionStateDto | null>, snapshot?: () => Promise<ReturnType<typeof snapshotFixture>> } = {}) {
  const bodies: SolutionActionBody[] = []
  let gets = 0
  const useStore = defineStore('solution-test', {
    state: () => ({ ...solutionInitialState(), conversation: { id: 'conversation-1' } as { id: string } | null, loadRevision: 0 }),
    actions: createSolutionActions({
      solutionAction: (_id, body) => ({ send: async () => {
        bodies.push(body)
        return { data: await (options.act?.(body) ?? Promise.resolve({ solutionState: solutionFixture({ version: 6 }) })) }
      } }),
      getSolution: () => ({ send: async () => {
        gets++
        return { data: await (options.get?.() ?? Promise.resolve(solutionFixture({ version: 6 }))) }
      } }),
      getSolutionSnapshot: () => ({ send: async () => ({ data: await (options.snapshot?.() ?? Promise.resolve(snapshotFixture())) }) }),
    }),
  })
  const store = useStore(createPinia())
  store.restoreSolutionState(solutionFixture())
  return { store, bodies, gets: () => gets }
}

nodeTest('历史恢复 Stage/Selected/Conflict/Final，清理旧比较与快照', () => {
  const { store } = setup()
  const state = solutionFixture({ stage: 'READY_TO_CONFIRM', selectedCandidateIds: ['A', 'C'], finalCandidateIds: ['A'], conflicts: [{ candidateId: 'C', code: 'THICKNESS_MISMATCH', message: '厚度超出', relatedConstraint: 'thicknessMax', keptForComparison: false }] })
  store.restoreSolutionState(state)
  assert.deepEqual(store.solutionState, state)
  store.clearSolution()
  assert.equal(store.solutionState, null)
  assert.equal(store.solutionComparison, null)
  assert.equal(store.solutionSnapshot, null)
})

nodeTest('ADD/REMOVE 以 response 为唯一状态；按钮与自然语言 SSE 共用 State', async () => {
  const { store, bodies } = setup({ act: async body => ({ solutionState: solutionFixture({ version: body.expectedVersion + 1, selectedCandidateIds: body.action === 'REMOVE' ? ['C'] : ['A'], candidateCards: [solutionCandidate('A', 1, { selected: body.action !== 'REMOVE' }), solutionCandidate('C', 3, { selected: true })] }) }) })
  await store.performSolutionAction('ADD', ['A'])
  assert.deepEqual(store.solutionState?.selectedCandidateIds, ['A'])
  store.applySolutionState({ solutionState: solutionFixture({ version: 7, selectedCandidateIds: ['A', 'C'] }) })
  assert.deepEqual(store.solutionState?.selectedCandidateIds, ['A', 'C'])
  await store.performSolutionAction('REMOVE', ['A'])
  assert.deepEqual(store.solutionState?.selectedCandidateIds, ['C'])
  assert.equal(bodies[1]?.expectedVersion, 7)
})

nodeTest('待响应不乐观选中；重复点击只发一次；仅 Solution 操作处于 loading', async () => {
  let resolve: (value: SolutionUpdate) => void = () => {}
  const { store, bodies } = setup({ act: () => new Promise((done) => {
    resolve = done
  }) })
  const first = store.performSolutionAction('ADD', ['A'])
  assert.equal(store.solutionActionLoading, true)
  assert.deepEqual(store.solutionState?.selectedCandidateIds, [])
  assert.deepEqual(store.solutionActionCandidateIds, ['A'])
  assert.equal(await store.performSolutionAction('ADD', ['A']), false)
  resolve({ solutionState: solutionFixture({ version: 6, selectedCandidateIds: ['A'] }) })
  await first
  assert.equal(bodies.length, 1)
  assert.equal(store.solutionActionLoading, false)
})

nodeTest('version/revision conflict 自动 GET 刷新，不重试旧 mutation', async () => {
  for (const code of ['SOLUTION_VERSION_CONFLICT', 'SOLUTION_REVISION_CONFLICT']) {
    const { store, bodies, gets } = setup({ act: async () => {
      throw Object.assign(new Error(code), { data: { error: { code: 400, details: { errorCode: code } } } })
    } })
    assert.equal(await store.performSolutionAction('ADD', ['A']), false)
    assert.equal(store.solutionState?.version, 6)
    assert.equal(gets(), 1)
    assert.equal(bodies.length, 1)
    assert.match(store.solutionNotice, /重新确认/)
  }
})

nodeTest('source changed 刷新并提示重查；刷新失败保留状态供手动重试', async () => {
  const changed = setup({ act: async () => {
    throw Object.assign(new Error('source changed'), { data: { error: { code: 'SOLUTION_SOURCE_CHANGED' } } })
  } })
  await changed.store.performSolutionAction('CONFIRM', ['A'])
  assert.equal(changed.gets(), 1)
  assert.match(changed.store.solutionNotice, /来源数据已更新/)
  const failed = setup({ act: async () => {
    throw Object.assign(new Error('version conflict'), { code: 'SOLUTION_VERSION_CONFLICT' })
  }, get: async () => {
    throw new Error('network')
  } })
  await failed.store.performSolutionAction('ADD', ['A'])
  assert.equal(failed.store.solutionState?.version, 5)
  assert.match(failed.store.solutionNotice, /刷新失败/)
  assert.equal(failed.store.solutionActionLoading, false)
})

nodeTest('COMPARE 只提交 selected IDs，保存独立结果；状态更新作废旧比较', async () => {
  const comparison = { scope: 'SELECTED_CANDIDATES' as const, candidates: ['A', 'C'].map(id => ({ ...solutionCandidate(id, null), conflicts: [] })), recommendedCandidateIds: ['A'] }
  const { store, bodies } = setup({ act: async () => ({ solutionState: solutionFixture({ selectedCandidateIds: ['A', 'C'] }), comparison }) })
  store.applySolutionState({ solutionState: solutionFixture({ selectedCandidateIds: ['A', 'C'] }) })
  await store.performSolutionAction('COMPARE', store.solutionState!.selectedCandidateIds)
  assert.deepEqual(bodies[0]?.candidateIds, ['A', 'C'])
  assert.deepEqual(store.solutionComparison, comparison)
  store.applySolutionState({ solutionState: solutionFixture({ version: 6, candidateSetRevision: 3 }) })
  assert.equal(store.solutionComparison, null)
})

nodeTest('SET_FINAL 多选 -> READY_TO_CONFIRM -> CONFIRM -> 冻结快照；REVISE 新 id 不修改旧 snapshot', async () => {
  const snapshot = snapshotFixture()
  const original = JSON.stringify(snapshot)
  const { store } = setup({ act: async body => ({ solutionState: solutionFixture({
    id: body.action === 'REVISE' ? 'state-2' : 'state-1',
    version: body.expectedVersion + 1,
    stage: body.action === 'SET_FINAL' ? 'READY_TO_CONFIRM' : body.action === 'CONFIRM' ? 'CONFIRMED' : 'CANDIDATE_SELECTION',
    finalCandidateIds: body.action === 'REVISE' ? [] : ['A', 'C'],
    confirmedSnapshotId: body.action === 'CONFIRM' ? snapshot.id : null,
  }), ...(body.action === 'CONFIRM' ? { snapshot } : {}) }) })
  await store.performSolutionAction('SET_FINAL', ['A', 'C'])
  assert.equal(store.solutionState?.stage, 'READY_TO_CONFIRM')
  assert.deepEqual(store.solutionState?.finalCandidateIds, ['A', 'C'])
  await store.performSolutionAction('CONFIRM', ['A', 'C'])
  assert.equal(store.solutionState?.stage, 'CONFIRMED')
  assert.equal(store.solutionSnapshot?.id, snapshot.id)
  await store.loadSolutionSnapshot()
  await store.performSolutionAction('REVISE')
  assert.equal(store.solutionState?.id, 'state-2')
  assert.equal(store.solutionSnapshot, null)
  assert.equal(JSON.stringify(snapshot), original)
})

nodeTest('新的 conflict 完全使用 Backend keptForComparison，不继承本地旧处理结果', () => {
  const { store } = setup()
  const conflict = { candidateId: 'B', code: 'THICKNESS_MISMATCH', message: '超厚', relatedConstraint: 'thicknessMax', keptForComparison: true }
  store.applySolutionState({ solutionState: solutionFixture({ version: 6, conflicts: [conflict], keptForComparisonIds: ['B'] }) })
  store.applySolutionState({ solutionState: solutionFixture({ version: 7, conflicts: [{ ...conflict, code: 'SYSTEM_MISMATCH', keptForComparison: false }], keptForComparisonIds: [] }) })
  assert.equal(store.solutionState?.conflicts[0]?.keptForComparison, false)
})

nodeTest('会话切换拒绝迟到 action/get/snapshot；SSE 新版本不被旧 REST 响应倒退', async () => {
  let resolve: (value: SolutionUpdate) => void = () => {}
  const { store } = setup({ act: () => new Promise((done) => {
    resolve = done
  }) })
  const pending = store.performSolutionAction('ADD', ['A'])
  store.applySolutionState({ solutionState: solutionFixture({ version: 7 }) })
  resolve({ solutionState: solutionFixture({ version: 6 }) })
  await pending
  assert.equal(store.solutionState?.version, 7)
  const pendingSwitch = store.performSolutionAction('REMOVE', ['A'])
  store.clearSolution()
  store.conversation = { id: 'conversation-2' }
  resolve({ solutionState: solutionFixture({ version: 8 }) })
  await pendingSwitch
  assert.equal(store.solutionState, null)
  assert.equal(store.solutionActionLoading, false)
  assert.equal(store.applySolutionState({ solutionState: solutionFixture() }), false)
})

nodeTest('同一会话离开后重进，旧请求仍被 revision 拦截；snapshot 查看也是隔离的', async () => {
  let resolveState: (value: SolutionStateDto) => void = () => {}
  let resolveSnapshot: (value: ReturnType<typeof snapshotFixture>) => void = () => {}
  const { store } = setup({ get: () => new Promise((done) => {
    resolveState = done
  }), snapshot: () => new Promise((done) => {
    resolveSnapshot = done
  }) })
  const get = store.refreshSolutionState()
  store.restoreSolutionState(solutionFixture({ version: 9 }))
  resolveState(solutionFixture({ version: 6 }))
  await get
  assert.equal(store.solutionState?.version, 9)
  store.restoreSolutionState(solutionFixture({ stage: 'CONFIRMED', confirmedSnapshotId: 'snapshot-1' }))
  const snapshot = store.loadSolutionSnapshot()
  store.clearSolution()
  resolveSnapshot(snapshotFixture())
  await snapshot
  assert.equal(store.solutionSnapshot, null)
})

nodeTest('REVISE/START_NEW 切换后，旧 GET 和旧 SSE 不能恢复已退休的 state', async () => {
  for (const action of ['REVISE', 'START_NEW'] as const) {
    let resolve: (value: SolutionStateDto) => void = () => {}
    const { store } = setup({ get: () => new Promise((done) => {
      resolve = done
    }), act: async () => ({ solutionState: solutionFixture({ id: 'state-2', version: 1, candidateCards: action === 'START_NEW' ? [] : solutionFixture().candidateCards }) }) })
    const refresh = store.refreshSolutionState()
    await store.performSolutionAction(action)
    resolve(solutionFixture({ version: 99 }))
    await refresh
    assert.equal(store.solutionState?.id, 'state-2')
    assert.equal(store.applySolutionState({ solutionState: solutionFixture({ version: 100 }) }), false)
    assert.equal(store.solutionState?.id, 'state-2')
  }
})

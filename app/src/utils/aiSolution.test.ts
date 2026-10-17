import assert from 'node:assert/strict'
import { test as nodeTest } from 'node:test'
import { snapshotFixture, solutionCandidate, solutionFixture } from '../test/fixtures/solution'
import { isSolutionState, solutionActionBody, solutionClientState, solutionErrorCode, solutionErrorMessages, solutionMetrics, solutionPersistenceSnapshot, solutionPool, solutionSelected, solutionSourceQuery, visibleSolutionPool } from './aiSolution'
import { parseStreamEvent } from './aiStream'

nodeTest('solution_state 解析正式状态、selected-only comparison 和不可变 snapshot', () => {
  const state = solutionFixture()
  const comparison = { scope: 'SELECTED_CANDIDATES', candidates: [], recommendedCandidateIds: ['A'] }
  const snapshot = snapshotFixture()
  const event = parseStreamEvent('solution_state', { solutionState: state, comparison, snapshot })
  assert.equal(event?.event, 'solution_state')
  if (event?.event !== 'solution_state')
    throw new Error('missing event')
  assert.deepEqual(event.data, { solutionState: state, comparison, snapshot })
  assert.equal(parseStreamEvent('solution_state', { solutionState: { id: 'broken' } }), null)
  assert.equal(isSolutionState({ ...state, candidateCards: [null] }), false)
})

nodeTest('done solutionState 兜底；产品 comparison_ready 协议仍独立', () => {
  const event = parseStreamEvent('done', { messageId: 'm', conversationId: 'conversation-1', solutionState: solutionFixture() })
  assert.ok(event?.event === 'done' && event.data.solutionState?.id === 'state-1')
  const product = parseStreamEvent('comparison_ready', { comparisonResult: { products: [{ id: 'p' }], dimensions: [] } })
  assert.equal(product?.event, 'comparison_ready')
})

nodeTest('re-query 候选按 position 排序，历史 selected position=null 仍显示', () => {
  const state = solutionFixture({ poolCandidateIds: ['D', 'E', 'F'], selectedCandidateIds: ['A', 'C'], candidateCards: [
    solutionCandidate('F', 3),
    solutionCandidate('A', null, { selected: true }),
    solutionCandidate('D', 1),
    solutionCandidate('C', null, { selected: true }),
    solutionCandidate('E', 2),
  ] })
  assert.deepEqual(solutionPool(state).map(card => card.candidateId), ['D', 'E', 'F'])
  assert.deepEqual(solutionSelected(state).map(card => card.candidateId), ['A', 'C'])
})

nodeTest('折叠候选不隐藏 selected/conflict/final；推荐不自动选中', () => {
  const state = solutionFixture({ recommendedCandidateIds: ['A'], candidateCards: Array.from({ length: 8 }, (_, i) => solutionCandidate(String(i), i + 1, i === 5 ? { selected: true } : i === 6 ? { conflict: true } : i === 7 ? { final: true } : {})) })
  assert.deepEqual(visibleSolutionPool(state, false).map(card => card.position), [1, 2, 3, 4, 6, 7, 8])
  assert.equal(solutionSelected(solutionFixture({ recommendedCandidateIds: ['A'] })).length, 0)
})

nodeTest('所有动作传最新 version/revision 和 candidateId，不提交序号', () => {
  for (const action of ['SELECT', 'ADD', 'REMOVE', 'REMOVE_CONFLICT', 'KEEP_FOR_COMPARISON', 'SET_FINAL', 'COMPARE', 'CONFIRM', 'START_NEW', 'REVISE'] as const) {
    const body = solutionActionBody(solutionFixture({ version: 9, candidateSetRevision: 7 }), action, ['A', 'C'])
    assert.deepEqual(body, { action, solutionStateId: 'state-1', expectedVersion: 9, candidateSetRevision: 7, candidateIds: ['A', 'C'] })
    assert.ok(!('positions' in body))
  }
})

nodeTest('来源 route 保留正式 pageId/pageLabel/optionId；缺失产品事实不伪造数值', () => {
  const candidate = solutionCandidate('A', 1)
  assert.deepEqual(solutionSourceQuery(candidate), { documentId: 'document', pageId: 'page', pageLabel: '22', optionId: 'A-18', title: '构造A', view: 'content' })
  assert.deepEqual(solutionMetrics({ candidateId: 'p', sourceType: 'PRODUCT' }), [])
  assert.equal(solutionMetrics(candidate).find(metric => metric.label === '传热系数 K')?.value, 0.303)
})

nodeTest('指标标签绑定产品层语义：厚度不是保温层厚度，产品层 R 不是总热阻', () => {
  const metrics = solutionMetrics(solutionCandidate('A', 1))
  const labels = metrics.map(metric => metric.label)
  // 「保温层厚度」会被理解成单层板厚；这里展示的是产品层总厚度。
  assert.ok(!labels.includes('保温层厚度'))
  assert.ok(labels.includes('产品厚度'))
  assert.ok(labels.includes('产品层热阻 R'))
  assert.ok(labels.includes('总热阻 R₀'))
  // 两个 R 是两个指标，单位相同但含义不同，不能互相顶替。
  const productR = metrics.find(metric => metric.label === '产品层热阻 R')
  const totalR = metrics.find(metric => metric.label === '总热阻 R₀')
  assert.notEqual(productR?.value, totalR?.value)
})

nodeTest('识别 Backend HTTP 数值码内嵌 details.errorCode，所有指定错误均有独立提示', () => {
  assert.equal(solutionErrorCode({ data: { error: { code: 400, details: { errorCode: 'SOLUTION_VERSION_CONFLICT' } } } }), 'SOLUTION_VERSION_CONFLICT')
  for (const code of ['SOLUTION_VERSION_CONFLICT', 'SOLUTION_COMPARE_MINIMUM', 'SOLUTION_HARD_CONFLICT', 'SOLUTION_CONFLICT_UNHANDLED', 'SOLUTION_FINAL_REQUIRED', 'SOLUTION_FACTS_INCOMPLETE', 'SOLUTION_SOURCE_CHANGED']) assert.ok(solutionErrorMessages[code])
})

nodeTest('跨启动保留正式已选/Final/Conflict，丢弃 action 锁和签名快照；旧缓存和串会话安全降级', () => {
  const state = solutionFixture({ stage: 'READY_TO_CONFIRM', selectedCandidateIds: ['A', 'C'], finalCandidateIds: ['A'] })
  const stored = { conversation: { id: 'conversation-1' }, solutionState: state, solutionActionLoading: true, solutionActionCandidateIds: ['A'], solutionSnapshotLoading: true, solutionSnapshot: snapshotFixture() }
  const clean = solutionPersistenceSnapshot(stored)
  assert.deepEqual(clean.solutionState, state)
  assert.equal(clean.solutionActionLoading, false)
  assert.equal(clean.solutionSnapshotLoading, false)
  assert.equal(clean.solutionSnapshot, null)
  assert.equal(stored.solutionActionLoading, true)
  assert.equal(solutionPersistenceSnapshot({}).solutionState, null)
  assert.equal(solutionPersistenceSnapshot({ ...stored, conversation: { id: 'conversation-2' } }).solutionState, null)
})

nodeTest('Client 投影只消费正式展示字段，不复制 Backend debug/raw candidates/provenance', () => {
  const original = { ...solutionFixture(), debug: { private: true }, candidates: [{ provenanceSnapshot: { internal: true } }], candidateCards: [{ ...solutionCandidate('A', 1), provenanceSnapshot: { internal: true }, resultSnapshot: {} }] }
  const state = solutionClientState(original)
  assert.ok(!('debug' in state))
  assert.ok(!('candidates' in state))
  assert.ok(!('provenanceSnapshot' in state.candidateCards[0]!))
  assert.equal(state.candidateCards[0]?.kValue, 0.303)
  assert.equal(original.debug.private, true)
})

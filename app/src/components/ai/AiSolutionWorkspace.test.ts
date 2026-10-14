import type { App, Component } from 'vue'
import type { SolutionAction, SolutionComparisonResult, SolutionSnapshotDto } from '@/api/solution-types'
import assert from 'node:assert/strict'
import { test as nodeTest } from 'node:test'
import { createRenderer, createSSRApp, defineComponent, h, nextTick, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { snapshotFixture, solutionCandidate, solutionFixture } from '../../test/fixtures/solution'
import AiSolutionCandidateCard from './AiSolutionCandidateCard.vue'
import AiSolutionComparisonCard from './AiSolutionComparisonCard.vue'
import AiSolutionWorkspace from './AiSolutionWorkspace.vue'

const button = defineComponent({ props: { disabled: Boolean, loading: Boolean }, emits: ['click'], setup(props, context) {
  return () => h('button', { disabled: props.disabled, onClick: () => {
    if (!props.disabled)
      context.emit('click')
  } }, context.slots.default?.() as never)
} })
const checkbox = defineComponent({ props: { modelValue: Boolean, disabled: Boolean }, emits: ['change'], setup(props, context) {
  return () => h('checkbox', { checked: props.modelValue, disabled: props.disabled, onClick: () => {
    if (!props.disabled)
      context.emit('change')
  } }, context.slots.default?.() as never)
} })
function register(app: Pick<App, 'component'>) {
  app.component('wd-button', button)
  app.component('wd-checkbox', checkbox)
  app.component('wd-segmented', { render: () => h('div') })
  app.component('scroll-view', { render() {
    return h('div', this.$slots.default?.())
  } })
}
async function render(component: Component, props: Record<string, unknown>) {
  const app = createSSRApp({ render: () => h(component, props) })
  register(app)
  return renderToString(app)
}
function workspaceProps(state = solutionFixture()) {
  return { state, comparison: null as SolutionComparisonResult | null, snapshot: null as SolutionSnapshotDto | null, loading: false, actionCandidateIds: [] as string[], pendingAction: null as SolutionAction | null, snapshotLoading: false, notice: '' }
}

nodeTest('工作区显示候选、历史已选、推荐和中文 Stage，推荐不自动成为 Final', async () => {
  const state = solutionFixture({ recommendedCandidateIds: ['A'], selectedCandidateIds: ['C'], candidateCards: [solutionCandidate('A', 1), solutionCandidate('C', null, { selected: true })] })
  const html = await render(AiSolutionWorkspace, workspaceProps(state))
  for (const text of ['智配方案', '当前候选 1', '本轮候选（1）', '已选方案（1）', '此前保留', '推荐', '请选择方案']) assert.ok(html.includes(text), text)
  assert.ok(!html.includes('CANDIDATE_SELECTION'))
  assert.ok(!html.includes('最终方案确认'))
})

nodeTest('PRODUCT 缺参数提示待补齐，不显示伪造的零值热工数', async () => {
  const candidate = solutionCandidate('p', 1, { sourceType: 'PRODUCT', thicknessMm: undefined, kValue: undefined, productThermalResistance: undefined, totalThermalResistance: undefined })
  const html = await render(AiSolutionCandidateCard, { candidate })
  assert.ok(html.includes('产品候选 · 热工/构造参数待补齐'))
  assert.ok(!html.includes('candidate__value'))
})

nodeTest('KEEP 后冲突仍显示；新冲突恢复保留按钮，不把其标成满足条件', async () => {
  const candidate = solutionCandidate('B', null, { selected: true, conflict: true, conflictMessages: ['厚度必须20以内'] })
  const kept = await render(AiSolutionCandidateCard, { candidate, keptForComparison: true })
  assert.ok(kept.includes('与当前条件冲突'))
  assert.ok(kept.includes('已保留用于比较，仍不满足当前条件'))
  assert.ok(!kept.includes('>保留用于比较<'))
  const fresh = await render(AiSolutionCandidateCard, { candidate: { ...candidate, conflictMessages: ['体系不匹配'] }, keptForComparison: false })
  assert.ok(fresh.includes('体系不匹配'))
  assert.ok(fresh.includes('保留用于比较'))
})

nodeTest('comparison 显示 selected-only 的 A,C 及后台参数/推荐，不补选 B', async () => {
  const comparison = { scope: 'SELECTED_CANDIDATES', candidates: ['A', 'C'].map(id => ({ ...solutionCandidate(id, null), conflicts: [] })), recommendedCandidateIds: ['C'] }
  const html = await render(AiSolutionComparisonCard, { comparison })
  for (const text of ['构造A', '构造C', '0.303', '2.880', '3.297', '当前条件下更符合偏好']) assert.ok(html.includes(text), text)
  assert.ok(!html.includes('构造B'))
})

nodeTest('READY_TO_CONFIRM 显示全部 Final 参数来源，CONFIRMED 只读摘要及 revise/start-new 入口', async () => {
  const final = solutionCandidate('A', 1, { selected: true, final: true, status: 'FINAL' })
  const ready = await render(AiSolutionWorkspace, workspaceProps(solutionFixture({ stage: 'READY_TO_CONFIRM', candidateCards: [final], finalCandidateIds: ['A'] })))
  for (const text of ['最终方案确认（1）', '确认生成方案', '0.303', '查看参考页']) assert.ok(ready.includes(text), text)
  const confirmed = await render(AiSolutionWorkspace, { ...workspaceProps(solutionFixture({ stage: 'CONFIRMED', candidateCards: [final], finalCandidateIds: ['A'], confirmedSnapshotId: 'snapshot-1' })), snapshot: snapshotFixture() })
  for (const text of ['方案已确认', '查看已确认方案', '继续调整', '重新做一套方案']) assert.ok(confirmed.includes(text), text)
  for (const text of ['本轮候选（', '加入方案', 'PDF已生成', '确认并生成报告']) assert.ok(!confirmed.includes(text), text)
})

// 最小 Vue host：使用真实 SFC setup/watch/emits 验证按钮和 UI draft，无 DOM 依赖。
interface HostNode { type: string, text: string, props: Record<string, unknown>, parent: HostNode | null, children: HostNode[] }
function node(type: string, text = ''): HostNode {
  return { type, text, props: {}, parent: null, children: [] }
}
function text(node: HostNode): string {
  return node.text + node.children.map(text).join('')
}
function find(root: HostNode, type: string, label: string): HostNode {
  const flatten = (item: HostNode): HostNode[] => [item, ...item.children.flatMap(flatten)]
  const found = flatten(root).find(item => item.type === type && text(item).includes(label))
  assert.ok(found, `${type} ${label}`)
  return found
}
function mount(props: ReturnType<typeof workspaceProps>) {
  const state = ref(props.state)
  const actions: Array<[string, string[]]> = []
  const reports: string[] = []
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: type => node(type),
    createText: value => node('text', value),
    createComment: value => node('comment', value),
    setText: (item, value) => { item.text = value },
    setElementText: (item, value) => {
      item.text = value
      item.children = []
    },
    patchProp: (item, key, _previous, value) => { item.props[key] = value },
    parentNode: item => item.parent,
    nextSibling: item => item.parent?.children[item.parent.children.indexOf(item) + 1] || null,
    insert: (item, parent, anchor) => {
      if (item.parent)
        item.parent.children.splice(item.parent.children.indexOf(item), 1)
      item.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, item)
    },
    remove: (item) => {
      if (item.parent)
        item.parent.children.splice(item.parent.children.indexOf(item), 1)
      item.parent = null
    },
  })
  const app = renderer.createApp({ render: () => h(AiSolutionWorkspace, { ...props, state: state.value, onAction: (action: string, ids: string[]) => actions.push([action, ids]), onGenerateReport: () => reports.push(state.value.confirmedSnapshotId!) }) })
  register(app)
  const root = node('root')
  app.mount(root)
  return { root, state, actions, reports, app }
}
function click(item: HostNode) {
  (item.props.onClick as () => void)()
}

nodeTest('实际按钮按 candidateId ADD；最终多选 draft 仅 SET_FINAL 提交并随 Backend State 重置', async () => {
  const cards = ['A', 'C', 'D'].map(id => solutionCandidate(id, null, { selected: true }))
  const mounted = mount(workspaceProps(solutionFixture({ selectedCandidateIds: ['A', 'C', 'D'], candidateCards: cards })))
  const allCheckboxes = mounted.root.children.flatMap(function flatten(item): HostNode[] {
    return [item, ...item.children.flatMap(flatten)]
  }).filter(item => item.type === 'checkbox')
  click(allCheckboxes[0]!)
  click(allCheckboxes[2]!)
  await nextTick()
  assert.deepEqual(mounted.actions, [])
  click(find(mounted.root, 'button', '设为最终方案'))
  assert.deepEqual(mounted.actions, [['SET_FINAL', ['A', 'D']]])
  mounted.state.value = solutionFixture({ version: 6, selectedCandidateIds: ['A', 'C', 'D'], finalCandidateIds: ['C'], candidateCards: cards })
  await nextTick()
  click(find(mounted.root, 'button', '设为最终方案'))
  assert.deepEqual(mounted.actions[1], ['SET_FINAL', ['C']])
  mounted.app.unmount()
  const add = mount(workspaceProps())
  click(find(add.root, 'button', '加入方案'))
  assert.deepEqual(add.actions, [['ADD', ['A']]])
  add.app.unmount()
})

nodeTest('实际 CONFIRM 防重复；未处理冲突禁用确认；snapshot 展开显示最终/备选/warnings', async () => {
  const state = solutionFixture({ stage: 'READY_TO_CONFIRM', finalCandidateIds: ['A'], selectedCandidateIds: ['A'], candidateCards: [solutionCandidate('A', 1, { selected: true, final: true })] })
  const loading = mount({ ...workspaceProps(state), loading: true, pendingAction: 'CONFIRM' })
  click(find(loading.root, 'button', '确认生成方案'))
  assert.deepEqual(loading.actions, [])
  loading.app.unmount()
  const conflicts = mount(workspaceProps({ ...state, conflicts: [{ candidateId: 'C', code: 'SYSTEM_MISMATCH', relatedConstraint: 'systemId', message: '体系不匹配', keptForComparison: false }] }))
  click(find(conflicts.root, 'button', '确认生成方案'))
  assert.deepEqual(conflicts.actions, [])
  conflicts.app.unmount()
  const confirmed = mount({ ...workspaceProps({ ...state, stage: 'CONFIRMED', confirmedSnapshotId: 'snapshot-1' }), snapshot: snapshotFixture() } as ReturnType<typeof workspaceProps>)
  click(find(confirmed.root, 'button', '查看已确认方案'))
  await nextTick()
  for (const label of ['已确认方案摘要', '最终方案（1）', '备选方案（1）', '备选方案有厚度冲突']) assert.ok(text(confirmed.root).includes(label), label)
  confirmed.app.unmount()
})

nodeTest('PDF 按钮只允许严格 CONFIRMED 和 Snapshot；加载、历史恢复、普通建议不会自动发事件', async () => {
  const ready = await render(AiSolutionWorkspace, workspaceProps(solutionFixture({ stage: 'READY_TO_CONFIRM' })))
  assert.ok(!ready.includes('生成技术方案 PDF'))
  for (const state of [solutionFixture({ stage: 'CONFIRMED' }), solutionFixture({ stage: 'GENERATED', confirmedSnapshotId: 'snapshot-1' }), solutionFixture({ stage: 'CONFIRMED', confirmedSnapshotId: 'snapshot-1' })]) {
    const mounted = mount(workspaceProps(state))
    assert.deepEqual(mounted.reports, [])
    const target = find(mounted.root, 'button', '生成技术方案 PDF')
    click(target)
    assert.equal(mounted.reports.length, state.stage === 'CONFIRMED' && state.confirmedSnapshotId ? 1 : 0)
    assert.deepEqual(mounted.actions, [])
    mounted.app.unmount()
  }
  for (const overrides of [{ reportCreating: true }, { reportBlocked: true }, { loading: true }]) {
    const mounted = mount({ ...workspaceProps(solutionFixture({ stage: 'CONFIRMED', confirmedSnapshotId: 'snapshot-1' })), ...overrides })
    click(find(mounted.root, 'button', '生成技术方案 PDF'))
    assert.deepEqual(mounted.reports, [])
    mounted.app.unmount()
  }
})

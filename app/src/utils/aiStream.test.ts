import { parseStreamEvent } from './aiStream.ts'

let failed = 0
let passed = 0

function assert(condition: unknown, name: string) {
  if (condition) {
    passed += 1
    console.log(`ok  ${name}`)
    return
  }
  failed += 1
  console.error(`FAIL  ${name}`)
}

const selection = parseStreamEvent('waiting_user_input', {
  runId: 'run-1',
  type: 'COMPARISON_SELECTION',
  title: '请选择需要纳入报告的产品/方案',
  prompt: '可选择一个或多个',
  multiple: true,
  minSelections: 1,
  confirmAction: { type: 'GENERATE_REPORT', label: '确认并生成报告' },
  options: [{ id: 'vicp', label: 'VICP', summary: '薄抹灰' }],
  comparisonResult: { products: [{ id: 'vicp', name: 'VICP' }], dimensions: [] },
})
assert(selection?.event === 'need_user_input', 'waiting_user_input 映射为同一等待事件')
assert(selection?.event === 'need_user_input' && selection.data.type === 'COMPARISON_SELECTION', '恢复 COMPARISON_SELECTION')
assert(selection?.event === 'need_user_input' && selection.data.multiple === true, '多选标记')
assert(selection?.event === 'need_user_input' && !('snapshotId' in selection.data), '不向 C 端暴露 snapshotId')

const userSelection = parseStreamEvent('waiting_user_input', {
  runId: 'run-2',
  type: 'USER_SELECTION',
  selectionKind: 'KNOWLEDGE_SOURCE',
  title: '选择参考资料',
  multiple: true,
  minSelections: 1,
  autoSelectWhenSingle: true,
  confirmAction: { type: 'CONTINUE', label: '确认使用' },
  options: [
    { id: 'd1', title: '《VICP外墙保温系统图集》', description: '外墙薄抹灰系统' },
    { id: 'd2', title: '《建筑节能构造图集》', description: '节能构造节点' },
  ],
  request: {
    type: 'USER_SELECTION',
    selectionKind: 'KNOWLEDGE_SOURCE',
    title: '选择参考资料',
    multiple: true,
    autoSelectWhenSingle: true,
    options: [
      { id: 'd1', title: '《VICP外墙保温系统图集》' },
      { id: 'd2', title: '《建筑节能构造图集》' },
    ],
    confirmAction: { type: 'CONTINUE', label: '确认使用' },
  },
})
assert(userSelection?.event === 'need_user_input' && userSelection.data.type === 'USER_SELECTION', 'USER_SELECTION 事件')
assert(userSelection?.event === 'need_user_input' && userSelection.data.selectionKind === 'KNOWLEDGE_SOURCE', '统一 selectionKind')
assert(userSelection?.event === 'need_user_input' && userSelection.data.autoSelectWhenSingle === true, '单来源自动选择标记')

const queued = parseStreamEvent('report_queued', {
  reportId: 'r1',
  taskId: 't1',
  snapshotId: 's1',
  status: 'QUEUED',
})
assert(queued?.event === 'report_queued' && queued.data.reportId === 'r1', '报告入队后结束 AI loading')
assert(queued?.event === 'report_queued' && queued.data.status === 'QUEUED', '入队状态')
assert(queued?.event === 'report_queued' && !('snapshotId' in queued.data), '入队不暴露 snapshotId')

const started = parseStreamEvent('report_started', { conversationId: 'c1', snapshotId: 's1' })
assert(started?.event === 'report_started', '报告开始状态')
assert(started?.event === 'report_started' && !('snapshotId' in started.data), '报告开始不暴露 snapshotId')

const completed = parseStreamEvent('report_completed', {
  reportId: 'r1',
  snapshotId: 's1',
  selectedProductIds: ['vicp', 'a'],
})
assert(completed?.event === 'report_completed' && completed.data.reportId === 'r1', '报告完成')
assert(completed?.event === 'report_completed' && completed.data.selectedProductIds?.join(',') === 'vicp,a', '报告带回已确认产品')
assert(completed?.event === 'report_completed' && !('snapshotId' in completed.data), '报告完成不暴露 snapshotId')

const products = parseStreamEvent('product_cards', {
  products: [{ id: 'vicp', name: 'VICP', summary: '薄抹灰' }],
})
assert(products?.event === 'product_cards' && products.data.products.length === 1, '产品咨询卡片事件')

const ignored = parseStreamEvent('tool_start', { toolName: 'get_product_data', message: '正在读取产品资料…' })
assert(ignored?.event === 'tool_start' && ignored.data.toolName === 'get_product_data', 'tool 事件可解析但 UI 不展示名称')

const statusOnly = parseStreamEvent('agent_status', { toolName: 'search_knowledge' })
assert(statusOnly?.event === 'agent_status' && statusOnly.data.toolName === 'search_knowledge', '仅 toolName 的状态也可驱动等待文案')

const progressAlias = parseStreamEvent('agent_status', { stage: 'analyzing', message: '正在分析' })
assert(progressAlias === null, '带 stage 的 agent_status 不重复进入聊天状态')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  throw new Error(`aiStream tests failed: ${failed}`)
}

import {
  agentActiveLabel,
  agentDoneLabel,
  applyToolResult,
  applyToolStart,
  dedupeAiSources,
  formatScheme,
  isUserFacingStatusText,
  parseNeedUserInput,
} from './aiAgentUi.ts'

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

assert(isUserFacingStatusText('正在查找相关资料…'), '中文状态对用户可见')
assert(!isUserFacingStatusText('search_knowledge'), 'toolName 不对用户可见')
assert(!isUserFacingStatusText('search_knowledge running'), 'running 状态不对用户可见')
assert(!isUserFacingStatusText('ToolCall #3'), 'ToolCall 不对用户可见')
assert(!isUserFacingStatusText('Agent step 4/8'), 'Agent step 不对用户可见')
assert(!isUserFacingStatusText('{"token":1}'), 'JSON 不对用户可见')
assert(agentActiveLabel('thermal_calculate') === '正在整理结果…', '热工进行中文案')
assert(agentActiveLabel('search_knowledge') === '正在查找相关资料…', '知识库进行中文案')
assert(agentActiveLabel('compare_products', '正在执行compare_products……') === '正在整理对比结果…', '对比过程不暴露 tool 名')
assert(agentActiveLabel('search_knowledge', '正在调用知识库工具……') === '正在查找相关资料…', '不把 tool 状态当正文')
assert(agentDoneLabel('search_knowledge') === '已找到相关资料', '知识库完成文案')
assert(agentDoneLabel('get_project_context') === '已整理结果', '项目资料完成不说 Context')
assert(agentActiveLabel('get_product_data', 'get_product_data') === '正在查找相关资料…', '产品咨询不暴露 tool 名')

const choice = parseNeedUserInput({
  runId: 'run-1',
  prompt: '请选择一个方案继续',
  options: [
    { index: 1, candidateId: 'a', scheme: { name: '薄抹灰 25mm' }, kValue: 0.32 },
    { index: 2, candidateId: 'b', scheme: '岩棉方案', kValue: 0.35 },
    { index: 3, candidateId: 'c', scheme: '方案三' },
  ],
})
assert(choice?.mode === 'choice', '多方案解析为 choice')
assert(choice?.options.map(item => item.label).join(',') === '方案1,方案2,方案3', '方案按钮文案')
assert(choice?.options[0].resumeContent === '方案1', '点击方案后 Resume 文案')
assert(!JSON.stringify(choice).includes('candidateId') || choice?.options[0].id === 'a', '内部仍可保留 id，UI 不展示技术字段')

const comparisonSelection = parseNeedUserInput({
  runId: 'run-compare',
  type: 'COMPARISON_SELECTION',
  title: '请选择需要纳入报告的产品/方案',
  prompt: '可选择一个或多个',
  multiple: true,
  minSelections: 1,
  confirmAction: { type: 'GENERATE_REPORT', label: '确认并生成报告' },
  options: [
    { id: 'vicp', label: 'VICP', summary: '薄抹灰外保温' },
    { id: 'a', label: '产品A', summary: '岩棉方案' },
    { id: 'b', label: '产品B' },
  ],
})
assert(comparisonSelection?.mode === 'selection', '产品对比等待为统一 selection')
assert(comparisonSelection?.selectionKind === 'PRODUCT', '产品对比 selectionKind=PRODUCT')
assert(comparisonSelection?.multiple === true, '对比选择使用 Checkbox 而不是 Radio')
assert(comparisonSelection?.minSelections === 1, '至少选择 1 项才可确认')
assert(comparisonSelection?.confirmAction?.label === '确认并生成报告', '确认按钮文案')
assert(comparisonSelection?.options[0].description === '薄抹灰外保温', '选项展示关键特点')
assert(!JSON.stringify(comparisonSelection?.options).includes('kValue'), '多选卡片不写死 K 值')

const conflict = parseNeedUserInput({
  runId: 'run-2',
  prompt: '检测到新的项目条件与之前记录不同',
  options: [{ previous: 'K <= 0.35', next: 'K <= 0.30' }],
})
assert(conflict?.mode === 'conflict', '记忆冲突解析')
assert(conflict?.conflict?.previous === 'K <= 0.35', '冲突原值')
assert(conflict?.conflict?.next === 'K <= 0.30', '冲突新值')
assert(conflict?.options[0].resumeContent === '使用新值', '使用新值 Resume')
assert(conflict?.options[1].resumeContent === '保留原值', '保留原值 Resume')

assert(formatScheme({ name: 'VICP 薄抹灰', thicknessMm: 25 }) === 'VICP 薄抹灰 · 25mm', '方案对象格式化')

const steps = applyToolResult(
  applyToolStart([], 'search_knowledge', 'search_knowledge'),
  'search_knowledge',
  true,
)
assert(steps[0].label === '已找到相关资料', '工具完成后使用用户文案')
assert(steps[0].status === 'done', '工具完成后标记完成')

const sources = dedupeAiSources([
  { title: '图集 A', documentId: 'd1', sectionId: 's1', pageLabel: 'A7' },
  { title: '图集 A', documentId: 'd1', sectionId: 's1', pageLabel: 'A7' },
  { title: '图集 B', documentId: 'd2', pageLabel: 'B1' },
])
assert(sources.length === 2, '来源按资料+章节+页码去重')
assert(!JSON.stringify(sources).includes('chunkId'), '去重结果不含 chunkId')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  throw new Error(`aiAgentUi tests failed: ${failed}`)
}

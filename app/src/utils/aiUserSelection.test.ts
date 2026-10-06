import {
  autoSelectWhenSingleOption,
  canConfirmSelection,
  fromParsedWaiting,
  nextSelectedIds,
  optionMetaLines,
  parseUserSelectionRequest,
  shouldAutoSelectWhenSingle,
} from './aiUserSelection.ts'
import { parseNeedUserInput } from './aiAgentUi.ts'

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

const radio = parseUserSelectionRequest({
  type: 'USER_SELECTION',
  selectionKind: 'REPORT_TYPE',
  title: '选择报告类型',
  description: '请选择一种报告类型',
  multiple: false,
  minSelections: 1,
  maxSelections: 1,
  autoSelectWhenSingle: true,
  options: [
    { id: 'technical_scheme', title: '综合技术方案报告', description: '完整技术方案与依据' },
    { id: 'project_brief', title: '项目方案简报', description: '更精炼的方案说明' },
    { id: 'material_compare', title: '材料对比报告', description: '多种材料对比结果' },
  ],
  confirmAction: { type: 'CONTINUE', label: '继续' },
})
assert(radio?.selectionKind === 'REPORT_TYPE', 'AiSelectionCard 单选：REPORT_TYPE')
assert(radio?.multiple === false, 'AiSelectionCard 单选不是 Checkbox')
assert(radio?.confirmAction.label === '继续', '报告类型确认按钮为继续')
assert(!JSON.stringify(radio).includes('\n1.'), '报告类型不出现 1. 2. 3. 编号')

const checkbox = parseUserSelectionRequest({
  type: 'USER_SELECTION',
  selectionKind: 'PRODUCT',
  title: '请选择需要纳入报告的产品/方案',
  multiple: true,
  minSelections: 1,
  autoSelectWhenSingle: true,
  options: [
    { id: 'vicp', title: 'VICP', description: '薄抹灰外保温' },
    { id: 'a', title: '产品A', description: '岩棉方案' },
  ],
  confirmAction: { type: 'GENERATE_REPORT', label: '确认并生成报告' },
})
assert(checkbox?.multiple === true, 'AiSelectionCard 多选：PRODUCT')
assert(canConfirmSelection(1, checkbox!), '多选至少 1 项可确认')
assert(!canConfirmSelection(0, checkbox!), '未选择时不可确认')

const twoSources = parseNeedUserInput({
  runId: 'run-ks-2',
  type: 'USER_SELECTION',
  selectionKind: 'KNOWLEDGE_SOURCE',
  title: '选择参考资料',
  multiple: true,
  minSelections: 1,
  autoSelectWhenSingle: true,
  confirmAction: { type: 'CONTINUE', label: '确认使用' },
  options: [
    { id: 'd1', title: '《VICP外墙保温系统图集》', description: '外墙薄抹灰系统', meta: { kind: 'atlas' } },
    { id: 'd2', title: '《建筑节能构造图集》', description: '节能构造节点', meta: { kind: 'atlas' } },
  ],
})
assert(twoSources?.mode === 'selection', 'Knowledge Source 2 个进入选择卡')
assert(twoSources?.selectionKind === 'KNOWLEDGE_SOURCE', 'Knowledge Source 使用统一协议')
assert(twoSources?.multiple === true, 'Knowledge Source 2 个可多选')
assert(twoSources?.hidden !== true, '2 个来源展示选择卡')
assert(twoSources?.confirmAction?.label === '确认使用', '图集确认按钮')
assert(optionMetaLines('KNOWLEDGE_SOURCE', {
  id: 'd1',
  title: '《VICP外墙保温系统图集》',
  description: '外墙薄抹灰系统',
  meta: { kind: 'atlas' },
  resumeContent: '',
}).join('|').includes('适用：外墙薄抹灰系统'), '图集展示适用范围')

const threeSources = parseNeedUserInput({
  runId: 'run-ks-3',
  type: 'USER_SELECTION',
  request: {
    type: 'USER_SELECTION',
    selectionKind: 'KNOWLEDGE_SOURCE',
    title: '选择参考资料',
    multiple: true,
    minSelections: 1,
    autoSelectWhenSingle: true,
    options: [
      { id: 'd1', title: 'A' },
      { id: 'd2', title: 'B' },
      { id: 'd3', title: 'C' },
    ],
    confirmAction: { type: 'CONTINUE', label: '确认使用' },
  },
})
assert(threeSources?.options.map(item => item.id).join(',') === 'd1,d2,d3', 'Knowledge Source 3 个仍多选')
assert(threeSources?.hidden !== true, '3 个来源展示选择卡')

const singleSource = parseNeedUserInput({
  runId: 'run-ks-1',
  type: 'USER_SELECTION',
  selectionKind: 'KNOWLEDGE_SOURCE',
  autoSelectWhenSingle: true,
  multiple: true,
  minSelections: 1,
  options: [{ id: 'only', title: '《苏 J/T15》' }],
  confirmAction: { type: 'CONTINUE', label: '确认使用' },
})
assert(singleSource?.hidden === true, '单来源不打断：隐藏选择卡')
assert(shouldAutoSelectWhenSingle(parseUserSelectionRequest({
  type: 'USER_SELECTION',
  selectionKind: 'KNOWLEDGE_SOURCE',
  title: '选择参考资料',
  multiple: true,
  autoSelectWhenSingle: true,
  options: [{ id: 'only', title: '《苏 J/T15》' }],
})), '单来源 autoSelectWhenSingle 直接确认')
assert(autoSelectWhenSingleOption(parseUserSelectionRequest({
  type: 'USER_SELECTION',
  selectionKind: 'KNOWLEDGE_SOURCE',
  title: 'x',
  autoSelectWhenSingle: true,
  options: [{ id: 'only', title: '《苏 J/T15》' }],
}) )?.[0] === 'only', '单来源返回唯一 id')

const reportType = parseNeedUserInput({
  runId: 'run-rt',
  type: 'USER_SELECTION',
  selectionKind: 'REPORT_TYPE',
  title: '选择报告类型',
  multiple: false,
  options: [
    { id: 'technical_scheme', title: '综合技术方案报告', description: '完整技术方案与依据' },
    { id: 'project_brief', title: '项目方案简报', description: '更精炼的方案说明' },
    { id: 'material_compare', title: '材料对比报告', description: '多种材料对比结果' },
  ],
  confirmAction: { type: 'CONTINUE', label: '继续' },
})
assert(reportType?.mode === 'selection' && reportType.selectionKind === 'REPORT_TYPE', 'Report Type 结构化选择')
assert(reportType?.multiple === false, 'Report Type 单选')
assert(!reportType?.options.some(item => /^[123]\.?$/.test(item.title)), '不要求用户输入 1')
assert(nextSelectedIds(['technical_scheme'], 'project_brief', reportType!)[0] === 'project_brief', '单选切换而不是叠加')

assert(parseNeedUserInput({
  runId: 'run-inferred',
  prompt: '正在生成报告…',
})?.mode === 'text', 'Backend 已推断类型时不弹选择卡')

const noProject = fromParsedWaiting({
  selectionKind: 'REPORT_TYPE',
  title: '选择报告类型',
  multiple: false,
  minSelections: 1,
  options: [{ id: 'material_compare', label: '材料对比报告', description: '', resumeContent: '材料对比报告' }],
  confirmAction: { type: 'GENERATE_REPORT', label: '确认并生成报告' },
})
assert(noProject.options[0].id === 'material_compare', '无 projectId 仍可用 code 提交')

const product = parseNeedUserInput({
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
  ],
})
assert(product?.mode === 'selection' && product.selectionKind === 'PRODUCT', '产品多选统一到 USER_SELECTION')
assert(product?.multiple === true, '产品选择 Checkbox')
assert(product?.options[0].description === '薄抹灰外保温', 'PRODUCT 展示关键摘要')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  throw new Error(`aiUserSelection tests failed: ${failed}`)
}

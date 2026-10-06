import {
  appendAssistantDelta,
  formatReportCompletedMessage,
  isReportDump,
  isSourceInquiry,
  previousUserText,
  resolveComparisonAttachAction,
  restoreAssistantContent,
  shouldAttachProductCards,
  splitAnswerLayers,
} from './aiAnswerUx.ts'
import { comparisonIdentity, parseProductComparison } from './aiComparison.ts'
import { renderMarkdown } from './markdown.ts'

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

assert(isSourceInquiry('你是怎么得到这个结论的？'), '用户问来源时可展开')
assert(isSourceInquiry('用了哪些资料？'), '问资料来源')

const layers = splitAnswerLayers('结论：VICP更薄。\n\n关键点一。\n\n传热系数计算过程如下：K=1/(R0+ΣR)。\n\n再补充施工节点说明。')
assert(layers.collapsible, '专业内容可分层')
assert(layers.summary.includes('结论'), '默认先展示结论')
assert(layers.details.includes('计算过程'), '详细说明默认折叠')

assert(formatReportCompletedMessage(['VICP', '产品A']) === '报告已生成。', '报告完成简洁提示')
assert(isReportDump('VICP 产品资料……产品A 产品资料……'.repeat(8), ['VICP', '产品A']), '报告不复制全部产品资料')

const first = parseProductComparison({
  comparisonId: 'cmp-1',
  version: 'v1',
  products: [{ id: 'vicp', name: 'VICP' }, { id: 'a', name: '产品A' }],
  dimensions: [{ key: 'name', label: '名称', items: [{ productId: 'vicp', value: 'VICP' }, { productId: 'a', value: '产品A' }] }],
})!
const same = parseProductComparison({
  comparisonId: 'cmp-1',
  version: 'v1',
  products: [{ id: 'vicp', name: 'VICP' }, { id: 'a', name: '产品A' }],
  dimensions: [{ key: 'name', label: '名称', items: [{ productId: 'vicp', value: 'VICP' }, { productId: 'a', value: '产品A' }] }],
})!
const changed = parseProductComparison({
  comparisonId: 'cmp-1',
  version: 'v2',
  products: [{ id: 'vicp', name: 'VICP' }, { id: 'a', name: '产品A' }, { id: 'b', name: '产品B' }],
  dimensions: [{ key: 'name', label: '名称', items: [{ productId: 'vicp', value: 'VICP' }, { productId: 'a', value: '产品A' }, { productId: 'b', value: '产品B' }] }],
})!

assert(resolveComparisonAttachAction(same, [{ id: 'm1', comparison: first }], 'm2') === 'skip', 'Comparison Card 同版本不重复')
assert(resolveComparisonAttachAction(changed, [{ id: 'm1', comparison: first }], 'm2') === 'replace', '新增产品时替换卡片')
assert(resolveComparisonAttachAction(first, [], 'm1') === 'insert', '首次对比插入卡片')
assert(comparisonIdentity(changed).comparisonId === 'cmp-1', '变化后仍使用同一 comparisonId')
assert(!shouldAttachProductCards(first.products, [{ comparison: first }]), '上一轮对比后的产品卡不重复')
assert(previousUserText([{ role: 'USER', content: '价格呢？' }, { role: 'ASSISTANT', content: '价格还缺资料' }], 1) === '价格呢？', '可定位上一轮用户问题')

const deltas = ['可以先看', '以下两个方案', '：\n- 方案A', '\n- 方案B']
const streamed = deltas.reduce((text, delta) => appendAssistantDelta(text, delta), '')
assert(streamed === deltas.join(''), '人工 delta 拼接逐字等于原串')
assert(streamed.includes('方案A') && streamed.includes('方案B'), '列表跨 delta 不丢项')

const markdownDeltas = ['这是**', '粗体**跨 delta。', '\n- 列表A', '\n- 列表B']
const markdownText = markdownDeltas.reduce((text, delta) => appendAssistantDelta(text, delta), '')
assert(markdownText === '这是**粗体**跨 delta。\n- 列表A\n- 列表B', '粗体与列表跨 delta 不改写')
const html = renderMarkdown(markdownText)
assert(html.includes('<strong>') || html.includes('<b>'), '跨 delta 粗体可渲染')
assert(html.includes('<li>'), '跨 delta 列表可渲染')

const serverContent = '我会先查询知识库，再给你答案。\n\nVICP更适合薄抹灰。'
assert(restoreAssistantContent(serverContent) === serverContent, '历史正文不被 Regex 改写')
assert(restoreAssistantContent('我不会杜撰，以下是结论。\n\n厚度可控。').includes('我不会杜撰'), '旧正文中的过程句也原样保留')
assert(restoreAssistantContent('search_knowledge running') === 'search_knowledge running', '历史不因新版 Regex 删除 Tool 名')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  throw new Error(`aiAnswerUx tests failed: ${failed}`)
}

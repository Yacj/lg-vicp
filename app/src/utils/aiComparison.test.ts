import {
  canConfirmComparison,
  COMPARISON_MISSING_VALUE,
  formatConfirmedCount,
  formatSelectedCount,
  isForbiddenCompareDimensionKey,
  parseProductCards,
  parseProductComparison,
  selectedProductNames,
} from './aiComparison.ts'

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

const twoProducts = parseProductComparison({
  comparisonId: 'cmp-vicp-a',
  version: '1',
  products: [
    { id: 'vicp', name: 'VICP', summary: '薄抹灰' },
    { id: 'a', name: '产品A', summary: '岩棉' },
  ],
  dimensions: [
    {
      key: 'name',
      label: '产品名称',
      sourceType: 'PRODUCT_FIELD',
      items: [
        { productId: 'vicp', value: 'VICP' },
        { productId: 'a', value: '产品A' },
      ],
    },
    {
      key: 'summary',
      label: '产品简介',
      items: [
        { productId: 'vicp', value: '薄抹灰' },
        { productId: 'a', insufficient: true, value: null },
      ],
    },
    {
      key: 'score',
      label: '总分',
      items: [
        { productId: 'vicp', value: 95 },
        { productId: 'a', value: 80 },
      ],
    },
  ],
  missingNotes: ['当前产品资料未提供价格'],
  thermal: { status: 'NOT_AVAILABLE', results: [] },
  evidenceRefs: [{ type: 'CATALOG_PRODUCT', id: 'vicp', label: 'VICP' }],
})

assert(twoProducts?.products.length === 2, '2产品比较可解析')
assert(twoProducts?.comparisonId === 'cmp-vicp-a', '读取 comparisonId')
assert(twoProducts?.version === '1', '读取 version')
assert(twoProducts?.dimensions.map(item => item.key).join(',') === 'name,summary', '动态维度不渲染总分')
assert(twoProducts?.dimensions[1]?.cells[1]?.display === COMPARISON_MISSING_VALUE, '资料不足显示暂无可靠资料')
assert(twoProducts?.showThermal === false, '无热工时不展示热工明细')
assert(twoProducts?.thermalNote?.includes('暂时不参与比较'), '无热工时给出自然语言说明')
assert(!JSON.stringify(twoProducts).includes('NOT_AVAILABLE'), '热工不暴露内部状态码')
assert(!JSON.stringify(twoProducts).includes('系统已为你选出最佳方案'), '文案不含最佳方案')

const threeProducts = parseProductComparison({
  products: [
    { id: 'vicp', name: 'VICP' },
    { id: 'a', name: '产品A' },
    { id: 'b', name: '产品B' },
  ],
  dimensions: [{
    key: 'focus:性能',
    label: '性能',
    items: [
      { productId: 'vicp', value: '薄抹灰' },
      { productId: 'a', value: '岩棉' },
      { productId: 'b', value: 'EPS' },
    ],
  }],
})
assert(threeProducts?.products.map(item => item.id).join(',') === 'vicp,a,b', '3产品比较保持动态列顺序')
assert(threeProducts?.dimensions[0]?.cells.map(item => item.display).join(',') === '薄抹灰,岩棉,EPS', '3产品动态维度取值')
assert(Boolean(threeProducts?.comparisonId && threeProducts.version), '无显式 id 时也能生成 comparisonId/version')

const withThermal = parseProductComparison({
  products: [{ id: 'vicp', name: 'VICP' }, { id: 'a', name: '产品A' }],
  dimensions: [{
    key: 'thermal',
    label: '热工结果（可选）',
    items: [
      { productId: 'vicp', value: '已提供' },
      { productId: 'a', value: '已提供' },
    ],
  }],
  thermal: {
    status: 'AVAILABLE',
    results: [{ name: 'VICP', K: '0.32', R: '1.2', calcSteps: 'R=d/λ' }],
  },
})
assert(withThermal?.showThermal === true, '有热工数据块时展示')
assert(withThermal?.thermalCoreRows.some(item => item.value === '0.32' || item.value === '1.2'), '热工先展示核心数值')
assert(withThermal?.thermalDetailRows.some(item => item.label.includes('calcSteps')), '计算过程放入详情')
assert(!JSON.stringify(withThermal).includes('"AVAILABLE"'), '有热工时也不展示状态码')

assert(isForbiddenCompareDimensionKey('性价比分数'), '性价比分数不作为固定维度')
assert(isForbiddenCompareDimensionKey('weight'), '权重不作为固定维度')
assert(!isForbiddenCompareDimensionKey('summary'), '普通动态维度可渲染')

const cards = parseProductCards({
  products: [
    { id: 'vicp', name: 'VICP', summary: '薄抹灰外保温' },
    { id: 'a', name: '产品A' },
  ],
})
assert(cards[0]?.summary === '薄抹灰外保温', '产品咨询卡片使用摘要而不是 tool 名')
assert(!JSON.stringify(cards).includes('get_product_data'), '产品卡不暴露 tool 名')

assert(canConfirmComparison(1, 1), '多选1个可确认')
assert(canConfirmComparison(2, 1), '多选多个可确认')
assert(!canConfirmComparison(0, 1), '未选时不可确认')
assert(formatSelectedCount(2) === '已选择 2 项', '已选择计数')
assert(formatConfirmedCount(2) === '已确认 2 个产品', '确认后报告状态文案')
assert(selectedProductNames(twoProducts!.products, ['vicp', 'a']).join('、') === 'VICP、产品A', '报告基于已确认产品')

const fromFields = parseProductComparison({
  products: [{ id: 'vicp', name: 'VICP' }, { id: 'eps', name: 'EPS' }],
  fields: [
    { field: 'summary', values: [{ productId: 'vicp', value: '简介' }, { productId: 'eps', value: null }] },
    { field: 'rank', values: [{ productId: 'vicp', value: 1 }, { productId: 'eps', value: 2 }] },
  ],
})
assert(fromFields?.dimensions.map(item => item.key).join(',') === 'summary', '旧 fields 投影也过滤排名')
assert(fromFields?.dimensions[0]?.cells[1]?.display === COMPARISON_MISSING_VALUE, '旧 fields 空值显示暂无可靠资料')

const sameVersion = parseProductComparison({
  comparisonId: 'cmp-vicp-a',
  version: '1',
  products: twoProducts!.products,
  dimensions: twoProducts!.dimensions.map(item => ({
    key: item.key,
    label: item.label,
    items: item.cells.map(cell => ({ productId: cell.productId, value: cell.insufficient ? null : cell.display })),
  })),
})
assert(sameVersion?.comparisonId === twoProducts?.comparisonId && sameVersion?.version === twoProducts?.version, '同结果 version 稳定')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  throw new Error(`aiComparison tests failed: ${failed}`)
}

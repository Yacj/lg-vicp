import { describe, expect, it } from 'vitest'
import { PRODUCT_COMPARE_MISSING_VALUE } from './product-compare'
import { projectReportComparison, remainingReportContentJson, resolveSelectedProductIds } from './report-comparison'

describe('report comparison snapshot', () => {
  it('prefers selectedProductIds and still accepts legacy selectedProductId', () => {
    expect(resolveSelectedProductIds({ selectedProductIds: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(resolveSelectedProductIds({ selectedProductId: 'vicp' })).toEqual(['vicp'])
    expect(resolveSelectedProductIds({ selectedProductIds: ['a'], selectedProductId: 'vicp' })).toEqual(['a'])
  })

  it('projects multi-product snapshot with sources and optional thermal', () => {
    const view = projectReportComparison({
      comparisonResult: {
        dimensions: [{
          items: [
            { productId: 'vicp', value: 'VICP' },
            { insufficient: true, productId: 'eps', value: null },
          ],
          key: 'name',
          label: '产品名称',
        }],
        products: [
          { id: 'vicp', name: 'VICP' },
          { id: 'eps', name: 'EPS' },
        ],
        thermal: { results: [], status: 'NOT_AVAILABLE' },
      },
      selectedProductIds: ['vicp', 'eps'],
      sourceRefs: [{ id: 'doc-1', label: '产品说明书', type: 'KNOWLEDGE_DOCUMENT' }],
    })

    expect(view?.selectedProducts.map(item => item.name)).toEqual(['VICP', 'EPS'])
    expect(view?.dimensions[0]?.cells.map(item => item.display)).toEqual(['VICP', PRODUCT_COMPARE_MISSING_VALUE])
    expect(view?.sources[0]?.label).toBe('产品说明书')
    expect(view?.showThermalResults).toBe(false)
  })

  it('shows thermal block when snapshot has available results', () => {
    const view = projectReportComparison({
      selectedProductIds: ['vicp'],
      thermal: { results: [{ kValue: 0.3 }], status: 'AVAILABLE' },
      thermalResults: [{ kValue: 0.3 }],
    })
    expect(view?.showThermalResults).toBe(true)
    expect(view?.thermalResults).toEqual([{ kValue: 0.3 }])
  })

  it('keeps remaining contentJson for generic detail after extracting comparison keys', () => {
    const remaining = remainingReportContentJson({
      selectedProductIds: ['vicp'],
      summary: '已纳入 VICP。',
      title: '产品对比报告',
    })
    expect(remaining).toEqual({ summary: '已纳入 VICP。', title: '产品对比报告' })
  })
})

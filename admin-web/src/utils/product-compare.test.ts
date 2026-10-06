import { describe, expect, it } from 'vitest'
import type { CatalogProduct, CatalogProductCompareResult } from '@/types/catalog-product'
import {
  buildCompareProductIds,
  formatCompareCellDisplay,
  isForbiddenCompareDimensionKey,
  PRODUCT_COMPARE_MISSING_VALUE,
  projectProductCompareWorkbench,
} from './product-compare'

function product(id: string, name: string, summary: string | null = null): CatalogProduct {
  return {
    categoryId: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    id,
    knowledgeDocumentIds: [],
    name,
    sortOrder: 0,
    status: 'ACTIVE',
    summary,
    updatedAt: '2026-09-20T00:00:00.000Z',
  }
}

describe('product compare workbench projection', () => {
  it('builds owner + compare product ids without duplicates', () => {
    expect(buildCompareProductIds('vicp', ['a', 'b', 'vicp', 'a'])).toEqual(['vicp', 'a', 'b'])
    expect(buildCompareProductIds('', ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('projects two products from dimensions and never invents missing values', () => {
    const result: CatalogProductCompareResult = {
      aiExplanation: 'VICP 施工更便捷。',
      dimensions: [
        {
          items: [
            { productId: 'vicp', value: 'VICP' },
            { productId: 'rockwool', value: '岩棉' },
          ],
          key: 'name',
          label: '产品名称',
          sourceType: 'PRODUCT_FIELD',
        },
        {
          insufficient: true,
          items: [
            { insufficient: true, note: '资料不足', productId: 'vicp', value: null },
            { insufficient: true, note: '资料不足', productId: 'rockwool', value: '猜测单价' },
          ],
          key: 'focus:性价比',
          label: '性价比',
          note: '当前产品资料未提供价格',
          sourceType: 'USER_REQUIREMENT',
        },
      ],
      evidenceRefs: [{ id: 'vicp', label: 'VICP', type: 'CATALOG_PRODUCT' }],
      missingNotes: ['当前产品资料未提供价格'],
      products: [product('vicp', 'VICP', '薄抹灰'), product('rockwool', '岩棉')],
      thermal: { results: [], status: 'NOT_AVAILABLE' },
    }

    const view = projectProductCompareWorkbench(result)
    expect(view.products).toHaveLength(2)
    expect(view.dimensions[0]?.cells.map(item => item.display)).toEqual(['VICP', '岩棉'])
    expect(view.dimensions[1]?.cells.every(item => item.display === PRODUCT_COMPARE_MISSING_VALUE)).toBe(true)
    expect(view.showThermalResults).toBe(false)
    expect(view.aiExplanation).toBe('VICP 施工更便捷。')
  })

  it('keeps three products in dynamic dimension order', () => {
    const products = [product('vicp', 'VICP'), product('rockwool', '岩棉'), product('eps', 'EPS')]
    const view = projectProductCompareWorkbench({
      aiExplanation: null,
      dimensions: [{
        items: products.map(item => ({ productId: item.id, value: item.name })),
        key: 'name',
        label: '产品名称',
        sourceType: 'PRODUCT_FIELD',
      }],
      products,
    })
    expect(view.dimensions[0]?.cells.map(item => item.productId)).toEqual(['vicp', 'rockwool', 'eps'])
  })

  it('projects legacy fields[] into dimensions without score or rank columns', () => {
    const products = [product('vicp', 'VICP', '简介'), product('eps', 'EPS', null)]
    const view = projectProductCompareWorkbench({
      aiExplanation: null,
      fields: [
        {
          field: 'summary',
          same: false,
          values: [
            { productId: 'vicp', value: '简介' },
            { productId: 'eps', value: null },
          ],
        },
        {
          field: 'score',
          same: false,
          values: [
            { productId: 'vicp', value: 95 },
            { productId: 'eps', value: 80 },
          ],
        },
      ],
      products,
      ranking: null,
      scores: null,
    })
    expect(view.dimensions.map(item => item.key)).toEqual(['summary'])
    expect(view.dimensions[0]?.cells.map(item => item.display)).toEqual(['简介', PRODUCT_COMPARE_MISSING_VALUE])
    expect(view.dimensions.some(item => item.key === 'score')).toBe(false)
  })

  it('shows optional thermal results only when AVAILABLE', () => {
    const products = [product('vicp', 'VICP'), product('eps', 'EPS')]
    const withoutThermal = projectProductCompareWorkbench({
      aiExplanation: null,
      dimensions: [],
      products,
      thermal: { status: 'NOT_AVAILABLE' },
    })
    expect(withoutThermal.showThermalResults).toBe(false)

    const withThermal = projectProductCompareWorkbench({
      aiExplanation: null,
      dimensions: [{
        items: products.map(item => ({ productId: item.id, value: '0.32' })),
        key: 'thermal',
        label: '热工结果（可选）',
        sourceType: 'THERMAL',
      }],
      products,
      thermal: { results: [{ kValue: 0.32 }], status: 'AVAILABLE' },
    })
    expect(withThermal.showThermalResults).toBe(true)
    expect(withThermal.thermalResults).toEqual([{ kValue: 0.32 }])
  })

  it('does not treat score-like keys as comparable dimensions', () => {
    expect(isForbiddenCompareDimensionKey('score')).toBe(true)
    expect(isForbiddenCompareDimensionKey('总分')).toBe(true)
    expect(isForbiddenCompareDimensionKey('summary')).toBe(false)
    expect(formatCompareCellDisplay('name', 'VICP')).toBe('VICP')
    expect(formatCompareCellDisplay('price', 12, true)).toBe(PRODUCT_COMPARE_MISSING_VALUE)
  })
})

import type { AiReferencePage } from '@/api/reference-page'

/** 通用协议夹具，仅用于测试，不进入业务页面。 */
export function referenceFixture(): AiReferencePage {
  return { type: 'REFERENCE_PAGE', page: { documentId: 'document', pageId: 'page', documentTitle: '参考图集', pageLabel: '22', imageUrl: 'https://example.test/page.png?signature=old' },
    renderModel: { pageTitle: '热工选用表', pageLabel: '22', constructions: ['A1-3', 'A1-4'].map(code => ({
      constructionId: code, constructionCode: code, systemName: 'I型VICP', layers: [{ name: '砂浆', thicknessMm: 20 }, { name: '保温板', variable: true }], material: { name: 'VICP复合保温板', lambda: 0.005, alpha: 1.25 },
      options: [15, 18, 20, 25].map(thickness => ({ optionId: `${code}-${thickness}`, thicknessMm: thickness, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 })),
    })), notes: ['原页备注'] }, matches: [{ constructionId: 'A1-3', optionId: 'A1-3-18', fieldKeys: ['thicknessMm', 'productThermalResistance', 'totalThermalResistance', 'kValue'] }] }
}

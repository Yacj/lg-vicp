import type { KnowledgeQaSseEvent, KnowledgeReferencePageBlock } from '@/types/knowledge'
import { createPinia } from 'pinia'
import TDesign from 'tdesign-vue-next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { fetchKnowledgePageRecognition, postKnowledgeVersionTestQa } from '@/api/modules/knowledge'
import { useUserStore } from '@/stores/user'
import KnowledgeTestPanel from './KnowledgeTestPanel.vue'

vi.mock('@/api/modules/knowledge', () => ({ fetchKnowledgePageRecognition: vi.fn(), fetchVersionPageWindow: vi.fn(), postKnowledgeVersionTestQa: vi.fn(), inspectKnowledgeVersionTest: vi.fn() }))
const apps: ReturnType<typeof createApp>[] = []
const answer = '有。资料中的接近档位如下：\n\n- **外墙A1-3**：8mm 的 K 为 0.325，10mm 为 0.269。\n- **外墙A1-4**：8mm 的 K 为 0.270。\n\n正式工程结论请由专业人员复核。'
const reference: KnowledgeReferencePageBlock = {
  page: { documentId: 'document', pageId: 'page', documentTitle: '热工参考选用表', pageLabel: '69', pageNumber: 3, imageUrl: '/original-page.png' },
  summary: { constructionCode: '外墙A1-3', thicknessMm: 8, kValue: 0.325 },
  renderModel: { pageTitle: '完整热工表', pageLabel: '69', notes: ['原页备注'], constructions: ['A1-3', 'A1-4'].map(code => ({
    constructionId: code, constructionCode: `外墙${code}`, systemName: 'I型VICP薄抹灰外保温系统',
    layers: [
      { order: 1, name: code === 'A1-3' ? '蒸压灰砂砖' : '加气混凝土砌块', thicknessMm: 240, lambda: 1.1, alpha: 1, rValue: 0.218 },
      { order: 2, name: '真空绝热板', variable: true, lambda: 0.0025, alpha: 1.25 },
      { order: 3, name: '抹面胶浆', thicknessMm: 5, lambda: 0.93, alpha: 1, rValue: 0.005 },
    ], material: { name: '真空绝热板', lambda: 0.0025, alpha: 1.25 },
    options: [
      { optionId: `${code}-8`, thicknessMm: 8, productThermalResistance: 2.56, totalThermalResistance: 3.076, kValue: code === 'A1-3' ? 0.325 : 0.270 },
      { optionId: `${code}-10`, thicknessMm: 10, productThermalResistance: 3.2, totalThermalResistance: 3.716, kValue: 0.269 },
      { optionId: `${code}-20`, thicknessMm: 20, productThermalResistance: 6.4, totalThermalResistance: 6.916, kValue: 0.145 },
    ],
  })) },
  matches: [
    { constructionId: 'A1-3', optionId: 'A1-3-8', fieldKeys: ['totalThermalResistance', 'kValue'], summary: { constructionCode: '外墙A1-3' }, highlights: [] },
    { constructionId: 'A1-3', optionId: 'A1-3-10', fieldKeys: ['kValue'], summary: { constructionCode: '外墙A1-3' }, highlights: [] },
    { constructionId: 'A1-4', optionId: 'A1-4-8', fieldKeys: ['kValue'], summary: { constructionCode: '外墙A1-4' }, highlights: [] },
  ],
}
async function settle() { for (let index = 0; index < 8; index++) { await Promise.resolve(); await nextTick() } }
async function ask(events: KnowledgeQaSseEvent[]) {
  vi.mocked(postKnowledgeVersionTestQa).mockImplementation(async (_version, _body, options) => { events.forEach(event => options.onEvent?.(event)) })
  const pinia = createPinia(); useUserStore(pinia).permissions = ['system:knowledge:doc:list']
  const element = document.createElement('div'); document.body.append(element)
  const app = createApp({ render: () => h(KnowledgeTestPanel, { versionId: 'version' }) }); apps.push(app)
  app.use(pinia).use(TDesign).mount(element)
  const textarea = element.querySelector('textarea')!
  textarea.value = '传热系数0.3的方案'; textarea.dispatchEvent(new Event('input', { bubbles: true })); await nextTick()
  ;[...element.querySelectorAll('button')].find(button => button.textContent?.trim() === '开始测试')!.click()
  await settle()
  return element
}
const events: KnowledgeQaSseEvent[] = [{ type: 'delta', data: { text: answer } }, { type: 'reference_pages', data: { referencePages: [reference] } }]
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = ''; vi.resetAllMocks() })

describe('AI 回答下完整原页及正式档位高亮', () => {
  it('每段保留整页全部构造、所有档位和后续层，只突出该段引用的正式行', async () => {
    const element = await ask(events)
    const pages = element.querySelectorAll('.knowledge-answer-reference-page')
    expect(pages).toHaveLength(2)
    expect(pages[0]?.parentElement?.querySelector('.app-markdown')?.textContent).toContain('外墙A1-3')
    expect(pages[1]?.parentElement?.querySelector('.app-markdown')?.textContent).toContain('外墙A1-4')
    for (const page of pages) {
      expect(page.querySelectorAll('.thermal-option-table')).toHaveLength(1)
      expect(page.querySelectorAll('table')).toHaveLength(1)
      expect(page.querySelectorAll('thead')).toHaveLength(1)
      expect(page.querySelectorAll('tr[data-construction-id="A1-3"]')).toHaveLength(5)
      expect(page.querySelectorAll('tr[data-construction-id="A1-4"]')).toHaveLength(5)
      expect(page.querySelectorAll('tr[data-option-id]')).toHaveLength(6)
      expect(page.textContent).toContain('抹面胶浆')
      expect(page.textContent).toContain('原页备注')
      expect(page.textContent).toContain('6.916')
      expect(page.querySelector('.page-image')).toBeNull()
    }
    expect([...pages[0]!.querySelectorAll('tr.is-hit')].map(row => (row as HTMLElement).dataset.optionId)).toEqual(['A1-3-8', 'A1-3-10'])
    expect([...pages[1]!.querySelectorAll('tr.is-hit')].map(row => (row as HTMLElement).dataset.optionId)).toEqual(['A1-4-8'])
    expect([...pages[0]!.querySelector('tr[data-option-id="A1-3-8"]')!.querySelectorAll('.field-hit')].map(cell => cell.textContent)).toEqual(['3.076', '0.325'])
    expect(pages[0]!.querySelector('tr[data-option-id="A1-4-8"] .field-hit')).toBeNull()
    expect(fetchKnowledgePageRecognition).not.toHaveBeenCalled()
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })
  it('切换原图时卸载表格，切回保留命中；取消高亮不删除数据', async () => {
    const element = await ask(events)
    const page = element.querySelector('.knowledge-answer-reference-page')!
    const click = async (label: string) => { [...page.querySelectorAll('button')].find(button => button.textContent?.trim() === label)!.click(); await settle() }
    await click('查看构造简图及原页')
    expect(page.querySelector('img')?.getAttribute('src')).toBe('/original-page.png')
    expect(page.querySelector('.thermal-option-table')).toBeNull()
    await click('完整表格')
    expect(page.querySelector('img')).toBeNull()
    expect(page.querySelectorAll('tr.is-hit')).toHaveLength(2)
    await click('取消高亮')
    expect(page.querySelectorAll('tr.is-hit')).toHaveLength(0)
    expect(page.querySelectorAll('tr[data-option-id]')).toHaveLength(6)
    await click('重新显示')
    expect(page.querySelectorAll('tr.is-hit')).toHaveLength(2)
  })
  it('缺少 renderModel 时直接完整原图，不从摘要拼出候选小表', async () => {
    const element = await ask([{ type: 'delta', data: { text: answer } }, { type: 'reference_pages', data: { referencePages: [{ ...reference, renderModel: undefined }] } }])
    expect(element.querySelectorAll('.page-image img')).toHaveLength(2)
    expect(element.querySelector('.thermal-option-table')).toBeNull()
    expect(element.textContent).toContain('当前来源未提供表格定位数据')
  })
  it('sources-only 保留来源入口，不从回答数值编造原页命中', async () => {
    const element = await ask([{ type: 'delta', data: { text: answer } }, { type: 'sources', data: { sources: [{ documentId: 'document', pageId: 'page', title: '原页', pageLabel: '69' }] } }])
    expect(element.querySelector('.knowledge-answer-reference-page')).toBeNull()
    expect(element.textContent).toContain('本次引用未提供匹配档位')
    expect([...element.querySelectorAll('button')].some(button => button.textContent?.trim() === '查看来源原页')).toBe(true)
  })
  it('清空回答时移除全部内嵌原页', async () => {
    const element = await ask(events)
    expect(element.querySelectorAll('.knowledge-answer-reference-page')).toHaveLength(2)
    ;[...element.querySelectorAll('button')].find(button => button.textContent?.trim() === '清空')!.click()
    await settle()
    expect(element.querySelector('.knowledge-answer-reference-page')).toBeNull()
  })
})

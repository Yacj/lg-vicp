import type { KnowledgePageRenderModel, ReferenceHighlight } from '@/types/knowledge-page-render'
import { createPinia } from 'pinia'
import TDesign from 'tdesign-vue-next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'
import { useUserStore } from '@/stores/user'
import { formatThermalNumber, resolveReferenceHighlights } from '@/utils/knowledge-page-render'
import KnowledgePageViewer from './KnowledgePageViewer.vue'

// 仅测试用协议夹具：同页两构造包含相同数值，检验定位不依赖文本。
function renderModel(): KnowledgePageRenderModel {
  return {
    pageLabel: '22', pageTitle: '建筑外墙热工计算参考选用表',
    constructions: ['A1-3', 'A1-4'].map(code => ({
      constructionId: code, constructionCode: code, systemName: '外墙',
      layers: ['混合砂浆', '蒸压灰砂砖', '找平层', '粘结砂浆', 'I型VICP复合保温板', '抹面胶浆'].map((name, index) => ({
        name, order: index + 1, variable: index === 4,
        thicknessMm: index === 4 ? null : [20, 240, 15, 5, 0, 5][index],
        rValue: index === 4 ? null : [0.023, 0.218, 0.015, 0.005, 0, 0.005][index],
        lambda: [0.87, 1.1, 0.93, 0.93, 0.005, 0.93][index], alpha: index === 4 ? 1.25 : 1,
      })),
      material: { name: 'I型VICP复合保温板', lambda: 0.005, alpha: 1.25 },
      options: [
        { optionId: `${code}-15`, thicknessMm: 15, productThermalResistance: 2.4, totalThermalResistance: 2.816, kValue: 0.355 },
        { optionId: `${code}-18`, thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 },
        { optionId: `${code}-20`, thicknessMm: 20, productThermalResistance: 3.2, totalThermalResistance: 3.616, kValue: 0.277 },
      ],
    })),
  }
}

const apps: ReturnType<typeof createApp>[] = []
async function mount(extra: Record<string, unknown> = {}, permissions: string[] = []) {
  const props = reactive({ pageId: 'page', renderModel: renderModel(), ...extra })
  const pinia = createPinia()
  const user = useUserStore(pinia)
  user.permissions = permissions
  const element = document.createElement('div')
  document.body.append(element)
  const app = createApp({ render: () => h(KnowledgePageViewer, props) })
  apps.push(app)
  app.use(pinia).use(TDesign).mount(element)
  await nextTick()
  await nextTick()
  return { element, props, user }
}
function click(element: HTMLElement, label: string): void {
  const button = [...element.querySelectorAll<HTMLElement>('button, .t-tabs__nav-item')].find(item => item.textContent?.trim() === label)
  expect(button, `应存在操作：${label}`).toBeDefined()
  button!.click()
}
afterEach(() => {
  apps.splice(0).forEach(app => app.unmount())
  document.body.innerHTML = ''
  vi.mocked(Element.prototype.scrollIntoView).mockClear()
})

describe('知识页结构化展示与定位', () => {
  it('默认页面内容，A1-3/A1-4 共用一张完整表及表头，各构造保留公共参数和全部档位', async () => {
    const { element } = await mount()
    expect(element.querySelector('.t-tabs__nav-item.t-is-active')?.textContent).toContain('页面内容')
    const table = element.querySelector('.thermal-option-table')!
    expect(element.querySelectorAll('.thermal-option-table')).toHaveLength(1)
    expect(table.querySelectorAll('table')).toHaveLength(1)
    expect(table.querySelectorAll('thead')).toHaveLength(1)
    for (const code of ['A1-3', 'A1-4']) {
      expect(table.querySelectorAll(`tbody tr[data-construction-id="${code}"][data-row-kind="layer"]`)).toHaveLength(5)
      expect(table.querySelectorAll(`tbody tr[data-construction-id="${code}"][data-row-kind="option"]`)).toHaveLength(3)
    }
    expect(table.textContent).toContain('I型VICP复合保温板')
    expect(table.textContent).toContain('0.005')
    expect(table.textContent).toContain('1.25')
    expect(element.querySelector('[data-option-id="A1-3-18"]')?.textContent).toContain('18—2.8803.2970.303')
    expect(element.querySelectorAll('tr.is-hit')).toHaveLength(0)
    expect(element.textContent).not.toContain('文件第')
    expect(element.textContent).not.toContain('调试 JSON')
  })

  it('单厚度仍显示档位表；缺少模型时原样回退 parsedText', async () => {
    const model = renderModel()
    model.constructions = [model.constructions[0]!]
    model.constructions[0]!.options = [model.constructions[0]!.options[0]!]
    const { element, props } = await mount({ renderModel: model })
    expect(element.querySelectorAll('tbody tr[data-row-kind="option"]')).toHaveLength(1)
    expect(element.querySelector('tbody td')?.getAttribute('rowspan')).toBe('6')
    Object.assign(props, { renderModel: null, parsedText: '历史页面\n完整原文 0.303' })
    await nextTick()
    expect(element.textContent).toContain('当前按原文排版展示')
    expect(element.querySelector('.knowledge-document-content')?.textContent).toContain('历史页面')
  })

  it('单命中只高亮 A1-3 的 18mm 行及指定字段，自动定位一次', async () => {
    const highlights: ReferenceHighlight[] = [{ constructionId: 'A1-3', optionId: 'A1-3-18', fieldKeys: ['thicknessMm', 'kValue'] }]
    const { element, props } = await mount({ highlights })
    expect(element.querySelectorAll('tr.is-hit')).toHaveLength(1)
    const target = element.querySelector('[data-option-id="A1-3-18"]')!
    expect(target.classList.contains('is-hit')).toBe(true)
    expect(target.querySelectorAll('.field-hit')).toHaveLength(2)
    expect(element.querySelector('[data-option-id="A1-4-18"]')?.classList.contains('is-hit')).toBe(false)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    Object.assign(props, { pageTitle: '新的页面标题' })
    await nextTick()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('多命中可以导航、取消与重新显示，切换 Tab 不重复跳动', async () => {
    const highlights = [{ optionId: 'A1-3-18' }, { optionId: 'A1-4-18', fieldKeys: ['totalThermalResistance'] }, { constructionId: 'A1-4', optionId: 'A1-4-20' }]
    const { element } = await mount({ highlights })
    expect(element.textContent).toContain('命中 3 处')
    expect(element.querySelectorAll('tr.is-hit')).toHaveLength(3)
    click(element, '下一处')
    await nextTick(); await nextTick()
    expect(element.querySelector('tr.is-active')?.getAttribute('data-option-id')).toBe('A1-4-18')
    click(element, '取消高亮')
    await nextTick()
    expect(element.querySelectorAll('tr.is-hit')).toHaveLength(0)
    click(element, '重新显示')
    await nextTick(); await nextTick()
    expect(element.querySelectorAll('tr.is-hit')).toHaveLength(3)
    click(element, '上一处')
    await nextTick(); await nextTick()
    expect(element.querySelector('tr.is-active')?.getAttribute('data-option-id')).toBe('A1-3-18')
    const count = vi.mocked(Element.prototype.scrollIntoView).mock.calls.length
    click(element, '页面原图'); await nextTick()
    click(element, '页面内容'); await nextTick(); await nextTick()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(count)
  })

  it('无效标识、其他页和同页不唯一 optionId 均不猜测定位', async () => {
    const model = renderModel()
    model.constructions[0]!.options[1]!.optionId = 'same'
    model.constructions[1]!.options[1]!.optionId = 'same'
    expect(resolveReferenceHighlights(model, [{ optionId: 'same' }], 'page')).toEqual([])
    expect(resolveReferenceHighlights(model, [{ pageId: 'other', constructionId: 'A1-3', optionId: 'same' }], 'page')).toEqual([])
    expect(resolveReferenceHighlights(model, [{ constructionId: 'A1-3', optionId: 'same' }], 'page')).toHaveLength(1)
    const { element } = await mount({ highlights: [{ optionId: 'missing', fieldKeys: ['kValue'] }] })
    expect(element.querySelectorAll('tr.is-hit')).toHaveLength(0)
    expect(element.textContent).toContain('命中数据暂无法定位')
  })

  it('重复来源事件不重置已选命中或用户关闭高亮的状态', async () => {
    const matches = [{ constructionId: 'A1-3', optionId: 'A1-3-18' }, { constructionId: 'A1-4', optionId: 'A1-4-18' }]
    const { element, props } = await mount({ highlights: matches })
    click(element, '下一处')
    await nextTick()
    await nextTick()
    Object.assign(props, { highlights: JSON.parse(JSON.stringify(matches)) })
    await nextTick()
    await nextTick()
    expect(element.querySelector('tr.is-active')?.getAttribute('data-option-id')).toBe('A1-4-18')
    click(element, '取消高亮')
    await nextTick()
    Object.assign(props, { highlights: JSON.parse(JSON.stringify(matches)) })
    await nextTick()
    await nextTick()
    expect(element.querySelectorAll('tr.is-hit')).toHaveLength(0)
  })

  it('异常数值保持原样并提示校验，识别数据和 JSON 按权限显示', async () => {
    const model = renderModel()
    model.constructions[0]!.options[0]!.productThermalResistance = null
    model.constructions[0]!.warnings = ['厚度与热阻需核对']
    const { element, user } = await mount({ renderModel: model, canReview: true }, ['system:knowledge:page:review'])
    expect(element.textContent).toContain('识别数据可能存在异常')
    expect(element.textContent).toContain('进入识别校验')
    click(element, '识别结果'); await nextTick()
    expect(element.textContent).not.toContain('调试 JSON')
    user.permissions = ['system:knowledge:debug']
    await nextTick()
    expect(element.textContent).toContain('调试 JSON')
    user.permissions = []
    await nextTick()
    expect(element.querySelector('.t-tabs__nav-item.t-is-active')?.textContent).toContain('页面内容')
    expect(element.textContent).not.toContain('调试 JSON')
  })

  it('补足三位小数，保留 Backend 正式格式及更高精度', () => {
    expect(formatThermalNumber(2.88)).toBe('2.880')
    expect(formatThermalNumber(0.303)).toBe('0.303')
    expect(formatThermalNumber(0.30345)).toBe('0.30345')
    expect(formatThermalNumber('2.8800')).toBe('2.8800')
  })

  it('没有 Render Model 的已确认页面也默认按构造和厚度表阅读', async () => {
    const { element } = await mount({ renderModel: null, confirmedStructuredData: { fullText: '<h2>页面原文</h2>', systems: renderModel().constructions.map(section => ({ constructionCode: section.constructionCode, systemName: section.systemName, layers: section.layers, options: section.options })), notes: ['<p>原文备注</p>'] } })
    expect(element.querySelectorAll('.thermal-option-table')).toHaveLength(1)
    expect(element.querySelectorAll('tbody tr[data-row-kind="option"]')).toHaveLength(6)
    expect(element.querySelector('.knowledge-page-viewer__unavailable')).toBeNull()
    expect(element.textContent).not.toContain('结构化全文')
    expect(element.querySelectorAll('tr.is-hit')).toHaveLength(0)
    expect(element.textContent).toContain('查看页面原文')
    expect(element.querySelector('.knowledge-page-viewer__original h2')?.textContent).toBe('页面原文')
  })

  it('原表排版合并编号、材料及公共 λ/α，主断面两列与各厚度逐行对应', async () => {
    const { element } = await mount()
    const section = element.querySelector('.thermal-option-table')!
    const wallHeader = [...section.querySelectorAll('thead th')].find(cell => cell.textContent === '整构造参数（源文组名待核）')!
    expect(wallHeader.getAttribute('colspan')).toBe('2')
    expect(section.querySelector('thead')?.textContent).toContain('整构造传热阻（源文符号待核）')
    expect(section.querySelector('thead')?.textContent).not.toContain('R₀')
    expect(section.querySelector('tbody tr td')?.getAttribute('rowspan')).toBe('8')
    const firstOption = section.querySelector('[data-option-id="A1-3-15"]')!
    const merged = firstOption.querySelectorAll('td[rowspan="3"]')
    expect([...merged].map(cell => cell.textContent)).toEqual(['5. I型VICP复合保温板', '0.005', '1.25'])
    expect([...section.querySelector('[data-option-id="A1-3-18"]')!.querySelectorAll('td')].map(cell => cell.textContent)).toEqual(['18', '—', '2.880', '3.297', '0.303'])
    expect(section.querySelector('tr[data-construction-id="A1-4"] td')?.getAttribute('rowspan')).toBe('8')
    expect([...section.querySelector('[data-option-id="A1-4-15"]')!.querySelectorAll('td[rowspan="3"]')].map(cell => cell.textContent)).toEqual(['5. I型VICP复合保温板', '0.005', '1.25'])
    expect([...section.querySelector('[data-option-id="A1-4-18"]')!.querySelectorAll('td')].map(cell => cell.textContent)).toEqual(['18', '—', '2.880', '3.297', '0.303'])
    expect(section.querySelectorAll('tr.is-construction-end')).toHaveLength(2)
    const commonRows = section.querySelectorAll('tr[data-row-kind="layer"]')
    expect(commonRows[0]?.textContent).toContain('0.8701.000.023')
    expect(commonRows[commonRows.length - 1]?.textContent).toContain('6. 抹面胶浆')
    expect(section.querySelector('thead')?.textContent).not.toContain('识别提示')
  })

  it('档位行缺失的数据不补算，在原表中保留缺失标记与校验提示', async () => {
    const model = renderModel()
    model.constructions[0]!.options[1]!.totalThermalResistance = null
    const { element } = await mount({ renderModel: model })
    const row = element.querySelector('[data-option-id="A1-3-18"]')!
    expect([...row.querySelectorAll('td')].map(cell => cell.textContent)).toEqual(['18', '—', '2.880', '—', '0.303', '需校验'])
    expect(element.querySelector('.thermal-option-table thead')?.textContent).toContain('识别提示')
  })

  it('合表后同名 optionId 仍只突出指定构造，构造命中限定在自己的行内', async () => {
    const model = renderModel()
    model.constructions.forEach(construction => { construction.options[1]!.optionId = 'shared-18' })
    const { element, props } = await mount({ renderModel: model, highlights: [{ constructionId: 'A1-4', optionId: 'shared-18', fieldKeys: ['kValue'] }] })
    expect(element.querySelectorAll('tr.is-hit')).toHaveLength(1)
    expect(element.querySelectorAll('tr.is-active')).toHaveLength(1)
    expect(element.querySelector('tr.is-active')?.getAttribute('data-construction-id')).toBe('A1-4')
    expect(element.querySelector('tr[data-construction-id="A1-3"][data-option-id="shared-18"] .field-hit')).toBeNull()
    Object.assign(props, { highlights: [{ constructionId: 'A1-3' }] })
    await nextTick(); await nextTick()
    expect(element.querySelectorAll('tr.is-hit')).toHaveLength(8)
    expect(element.querySelectorAll('tr[data-construction-id="A1-4"].is-hit')).toHaveLength(0)
  })

  it('原图入口保留构造简图；页面与构造备注保留', async () => {
    const model = renderModel()
    model.notes = ['页面备注']
    model.constructions[0]!.notes = ['第一构造备注']
    model.constructions[1]!.notes = ['第二构造备注']
    const { element } = await mount({ renderModel: model, pageImageUrl: '/original.png' })
    expect(element.textContent).toContain('第一构造备注')
    expect(element.textContent).toContain('第二构造备注')
    expect(element.textContent).toContain('页面备注')
    click(element, '查看构造简图及原页'); await nextTick()
    expect(element.querySelector('.t-tabs__nav-item.t-is-active')?.textContent).toContain('页面原图')
    expect(element.querySelector('.page-image img')?.getAttribute('src')).toBe('/original.png')
  })
})

import type { KnowledgeReferencePageBlock, PageRecognitionResult } from '@/types/knowledge'
import type { KnowledgePageRenderModel } from '@/types/knowledge-page-render'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPinia } from 'pinia'
import TDesign from 'tdesign-vue-next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import KnowledgeAnswerContent from '@/components/business/knowledge/KnowledgeAnswerContent.vue'
import ThermalOptionTable from '@/components/business/knowledge/ThermalOptionTable.vue'
import { recognitionConstructionContent } from './knowledge-document'
import { normalizeReferenceHighlights, resolveReferenceHighlights } from './knowledge-page-render'
import { copyRecognitionDraft, recognitionDraftPayload, removeRecognitionLayer } from './knowledge-recognition-draft'
import { thermalColumnHeader } from './knowledge-thermal-labels'

const fixture = (page: number): PageRecognitionResult => JSON.parse(readFileSync(resolve(process.cwd(), `../backend/tests/fixtures/complex-atlas/page-${page}.json`), 'utf8')).data
function model(page: number): KnowledgePageRenderModel {
  return { ...fixture(page), constructions: fixture(page).systems.map((system, i) => ({
    ...recognitionConstructionContent(system),
    constructionId: `page-${page}-g${i}`,
    layers: system.layers!,
    options: system.options!.map((option, j) => ({ ...option, optionId: `page-${page}-g${i}-o${j}` })),
  })) }
}
const apps: ReturnType<typeof createApp>[] = []
async function mount(component: any, props: any) {
  const el = document.createElement('div')
  document.body.append(el)
  const app = createApp({ render: () => h(component, props) })
  apps.push(app)
  app.use(createPinia()).use(TDesign).mount(el)
  for (let i = 0; i < 4; i++) {
    await nextTick()
  }
  return el
}
afterEach(() => {
  apps.splice(0).forEach(app => app.unmount())
  document.body.innerHTML = ''
  vi.mocked(Element.prototype.scrollIntoView).mockClear()
})

describe('三页复杂图集合同（人工源图Fixture，不是正式资料）', () => {
  it.each([22, 53])('%s页编号栏不夹型号/基层，简图说明单列且热工表保留六行与原层号', async (page) => {
    const source = fixture(page)
    const copy = recognitionDraftPayload(copyRecognitionDraft(source))
    expect(copy.systems[0]!.diagramNotes).toEqual(source.systems[0]!.diagramNotes)
    expect(copy.systems[0]!.sourceTableHeaders).toEqual(source.systems[0]!.sourceTableHeaders)
    expect(copy.systems[0]!.layers?.[0]!.sourceRegion).toBe('THERMAL_TABLE')
    const render = model(page)
    const el = await mount(ThermalOptionTable, { constructions: render.constructions })
    expect(el.querySelector('thead')!.textContent).toContain('编号')
    expect(el.querySelector('thead')!.textContent).not.toContain('产品整体热阻')
    const code = el.querySelector('tbody .construction-code')!
    expect(code.textContent).toBe(source.systems[0]!.rawConstructionLabel)
    expect(code.textContent).not.toContain('240mm')
    if (page === 53) {
      expect(el.querySelector('thead')!.textContent).toContain('构造简图')
      expect(el.querySelector('tbody .construction-diagram')!.textContent).toContain('隔汽层：按工程设计')
      expect([...el.querySelectorAll('.construction-material')].some(item => item.textContent?.includes('按工程设计'))).toBe(false)
      expect(el.querySelectorAll('tr[data-row-kind="option"]')).toHaveLength(12)
    }
  })
  it('确认版本约束经过DTO归一化后保留，旧引用不高亮新模型', () => {
    const current = model(90)
    current.confirmedRevision = 'current'
    const group = current.constructions[0]!
    const matches = normalizeReferenceHighlights([{ constructionId: group.constructionId, optionId: group.options[0]!.optionId, confirmedRevision: 'old', fieldKeys: ['kValue'] }])
    expect(matches[0]!.confirmedRevision).toBe('old')
    expect(resolveReferenceHighlights(current, matches)).toHaveLength(0)
    matches[0]!.confirmedRevision = 'current'
    expect(resolveReferenceHighlights(current, matches)).toHaveLength(1)
  })
  it.each([89, 90, 75])('%s页全部档位、分层热阻和来源R忠实呈现，编辑载荷不丢字段', async (page) => {
    const source = fixture(page)
    const before = JSON.stringify(source)
    const draft = copyRecognitionDraft(source)
    const payload = recognitionDraftPayload(draft)
    expect(payload.schemaVersion).toBe(2)
    expect(payload.pageLabelEvidence).toBe(String(page))
    for (let i = 0; i < 2; i++) {
      expect(payload.systems[i]!.sourceColumns).toEqual(source.systems[i]!.sourceColumns)
      expect(payload.systems[i]!.options).toEqual(source.systems[i]!.options)
      expect(payload.systems[i]!.rawConstructionLabel).toBe(source.systems[i]!.rawConstructionLabel)
    }
    const render = model(page)
    const el = await mount(ThermalOptionTable, { constructions: render.constructions })
    expect(el.querySelectorAll('tr[data-row-kind="option"]')).toHaveLength(page === 75 ? 14 : 12)
    expect(el.querySelector('thead')!.textContent).toContain('外墙主断面')
    expect(el.querySelector('thead')!.textContent).toContain('传热阻 R')
    expect(el.textContent).not.toContain('R₀')
    for (const construction of render.constructions) {
      for (const option of construction.options) {
        const row = el.querySelector(`[data-option-id="${option.optionId}"]`)!
        expect(row.textContent).toContain(Number(option.totalThermalResistance).toFixed(3))
        expect(row.textContent).toContain(Number(option.kValue).toFixed(3))
        expect(row.textContent).toContain(option.layerValues![0]!.rValue!.toFixed(3))
      }
    }
    expect(JSON.stringify(source)).toBe(before)
  })

  it('删除层后引用只重排，不将被删芯层绑定给包覆层；数字为空不填0', () => {
    const draft = copyRecognitionDraft(fixture(90))
    const system = draft.systems[0]!
    const coreIndex = system.options[0]!.layerValues![0]!.layerIndex
    removeRecognitionLayer(system, 0)
    expect(system.options[0]!.layerValues![0]!.layerIndex).toBe(coreIndex - 1)
    removeRecognitionLayer(system, coreIndex - 1)
    expect(system.options.every(option => option.layerValues?.length === 0)).toBe(true)
    const payload = recognitionDraftPayload(draft)
    expect(payload.systems[0]!.constructionCode).toBeNull()
    expect(payload.systems[0]!.options![0]!.productThermalResistance).toBeNull()
  })

  it('未知源列保守退化，原文写R不被改成R₀，组间表头不同不能套用首组', () => {
    const constructions = model(90).constructions
    expect(thermalColumnHeader(constructions, 'totalThermalResistance').label).toBe('传热阻 R')
    constructions[1]!.sourceColumns = []
    expect(thermalColumnHeader(constructions, 'totalThermalResistance').label).toContain('源文符号待核')
    const duplicate = model(90).constructions
    duplicate[0]!.sourceColumns!.push({ ...duplicate[0]!.sourceColumns!.find(column => column.fieldKey === 'totalThermalResistance')! })
    expect(thermalColumnHeader(duplicate, 'totalThermalResistance').label).toContain('源文符号待核')
  })

  it('90页同值双构造在同一回答位置并列比较，重复来源不合并为一个构造', async () => {
    const render = model(90)
    const answer = '两种构造的参数相同，但做法分别保留。'
    const page: KnowledgeReferencePageBlock = { page: { documentId: 'fixture', pageId: '90', documentTitle: '平屋面', pageNumber: 1, pageLabel: '90', imageUrl: '/original.png' }, summary: {}, renderModel: render, matches: render.constructions.map(section => ({ constructionId: section.constructionId, optionId: section.options[3]!.optionId, fieldKeys: ['totalThermalResistance', 'kValue'], answerOffset: answer.length, summary: {}, highlights: [] })) }
    const el = await mount(KnowledgeAnswerContent, { answer, referencePages: [page, page], complete: true, hasSources: true })
    expect(el.querySelectorAll('.knowledge-answer-reference-page')).toHaveLength(1)
    expect(el.querySelectorAll('.answer-match-summary tbody tr')).toHaveLength(2)
    expect(el.querySelectorAll('.thermal-option-table tr.is-hit')).toHaveLength(2)
    expect(el.querySelectorAll('.thermal-option-table tr[data-option-id]')).toHaveLength(12)
    expect(el.textContent).toContain('正置')
    expect(el.textContent).toContain('倒置')
  })
})

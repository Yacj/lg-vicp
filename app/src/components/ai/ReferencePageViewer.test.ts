import type { AiReferencePage } from '@/api/reference-page'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { complexAtlasFixture } from '../../test/fixtures/complexAtlas'
import { referenceFixture } from '../../test/fixtures/referencePage'
import AiAnswerReferencePage from './AiAnswerReferencePage.vue'
import AiReferenceAnswer from './AiReferenceAnswer.vue'
import AiThermalSolutionCard from './AiThermalSolutionCard.vue'
import ReferencePageViewer from './ReferencePageViewer.vue'
import StructuredThermalSection from './StructuredThermalSection.vue'

async function render(component: unknown, props: Record<string, unknown>) {
  const app = createSSRApp({ render: () => h(component as never, props) })
  app.component('wd-button', { render() { return h('button', this.$slots.default?.()) } })
  app.component('wd-segmented', { render() { return h('div') } })
  app.component('mp-html', { props: ['content'], render() { return h('section', { innerHTML: this.$props.content }) } })
  return renderToString(app)
}
test('复杂图集三页按来源列头显示 6 个独立构造、全部档位和原备注，命中对比含 R/K', async () => {
  for (const number of [89, 90, 75] as const) {
    const page = complexAtlasFixture(number)
    const html = await render(AiAnswerReferencePage, { page, anchorPrefix: `atlas-${number}` })
    assert.equal((html.match(/class="thermal-table__body"/g) || []).length, 2)
    assert.equal((html.match(/id="atlas-\d+-construction-\d+-option-\d+"/g) || []).length, number === 75 ? 14 : 12)
    for (const construction of page.renderModel!.constructions) {
      assert.ok(html.includes(construction.rawConstructionLabel!))
      for (const option of construction.options) {
        assert.ok(html.includes(String(option.kValue)))
        assert.ok(html.includes(String(option.totalThermalResistance)))
      }
    }
    for (const note of page.renderModel!.notes || [])
      assert.ok(html.includes(note))
    assert.ok(html.includes('传热阻 R'))
    assert.ok(html.includes('来源栏目：外墙主断面'))
    assert.ok(html.includes('定位命中档位'))
    assert.ok(html.includes(`印刷页码 ${number}`))
    assert.ok(!html.includes('R₀'))
  }
})
test('方案卡默认只强调厚度和 K，来源是引用区域，双 R 可展开，不显示技术标识', async () => {
  const page = referenceFixture()
  page.matches.push({ constructionId: 'A1-4', optionId: 'A1-4-18', fieldKeys: ['kValue'] })
  const html = await render(AiThermalSolutionCard, { page })
  for (const text of ['A1-3', 'A1-4', '18', '0.303', '参考图集 · 第22页', '查看热阻参数']) assert.ok(html.includes(text))
  assert.ok(!html.includes('2.880')); assert.ok(!html.includes('3.297'))
  assert.equal((html.match(/查看参考页/g) || []).length, 2)
  assert.equal((html.match(/class="solution__parameters"/g) || []).length, 2)
  assert.equal((html.match(/class="solution__citation"/g) || []).length, 2)
  assert.ok(!html.includes('optionId'))
})
test('默认同页一张完整表格，公共层和所有厚度保留，命中四字段突出且原图互斥', async () => {
  const page = referenceFixture()
  const html = await render(ReferencePageViewer, { page })
  for (const text of ['A1-3', 'A1-4', '保温板', '0.005', '1.25', '2.880', '3.297', '0.303', '砂浆', '>15<', '>20<', '>25<', '原页备注', '查看原始页面', '全屏看表格', '整构造参数（源文组名待核）']) assert.ok(html.includes(text), text)
  assert.ok(!html.includes('R₀'))
  assert.ok(html.includes('reference-construction-0-option-1'))
  assert.equal((html.match(/class="thermal-table__header"/g) || []).length, 1)
  assert.equal((html.match(/class="[^"]*thermal-table__row--hit/g) || []).length, 1)
  assert.equal((html.match(/class="[^"]*thermal-table__field--hit/g) || []).length, 4)
  assert.ok(!html.includes('<image'))
})

test('历史表格的识别字段说明不出现在对话或参考页，也不触发虚假告警', async () => {
  const page = referenceFixture()
  const internal = [
    '按构造编号分为外墙H1-1和外墙H1-2两个系统。',
    'VICP复合保温板为多厚度档，layers中厚度和热阻填null，各档厚度及产品层热阻、外墙主断面总传热阻和传热系数分别写入options。',
    '岩棉层热阻0.593为构造层自身热阻，只保留在layers中。',
    '板材主断面传热阻R和传热系数K分别逐档写入options对应字段。',
    '金属面板行未给出厚度、导热系数、修正系数和热阻，填null。',
  ]
  const model = page.renderModel!
  model.notes = internal
  model.paragraphs = [internal[0]!]
  model.warnings = [internal[1]!]
  model.constructions[0]!.notes = [internal[2]!]
  model.constructions[0]!.options[1]!.warnings = [internal[3]!]
  const snapshot = JSON.stringify(page)
  for (const inline of [true, false]) {
    const html = await render(ReferencePageViewer, { page, inline })
    for (const text of [...internal, '识别参数可能存在异常', '需核对']) assert.ok(!html.includes(text), text)
    for (const text of ['全屏看表格', '2.880', '3.297', '0.303']) assert.ok(html.includes(text), text)
    assert.equal((html.match(/class="[^"]*thermal-table__field--hit/g) || []).length, 4)
  }
  assert.equal(JSON.stringify(page), snapshot)
})

test('原页业务备注和具体缺失提示保留，缺省备注可正常展示表格', async () => {
  const page = referenceFixture()
  const model = page.renderModel!
  model.paragraphs = ['本表适用于混凝土夹心外墙板。']
  model.notes = ['内表面换热阻0.11(m²·K)/W，外表面换热阻0.04(m²·K)/W。']
  model.constructions[0]!.notes = ['岩棉层自身热阻为0.593。']
  model.warnings = ['50mm档总热阻不清晰，请核对原图。']
  model.constructions[0]!.options[1]!.warnings = ['传热系数不清晰，请核对原图。']
  const html = await render(ReferencePageViewer, { page, inline: true })
  for (const text of [...model.paragraphs, ...model.notes, ...model.constructions[0]!.notes, ...model.warnings, '需核对']) assert.ok(html.includes(text), text)
  assert.ok(!html.includes('识别参数可能存在异常'))
  delete model.paragraphs
  delete model.notes
  delete model.warnings
  assert.ok((await render(ReferencePageViewer, { page })).includes('thermal-table__header'))
})
test('无 renderModel 老消息默认完整 contain 原图及全屏入口，图片错误可重试', async () => {
  const page: AiReferencePage = { ...referenceFixture(), renderModel: null, matches: [] }
  const html = await render(ReferencePageViewer, { page })
  assert.ok(html.includes('mode="aspectFit"'))
  assert.ok(html.includes('全屏查看'))
  assert.ok(!html.includes('thermal-section'))
  const failed = await render(ReferencePageViewer, { page, imageFailed: true })
  assert.ok(failed.includes('重新加载图片')); assert.ok(!failed.includes('<image'))
})
test('取消高亮不移除命中规格；同值的另一个构造不会突出', async () => {
  const page = referenceFixture()
  const first = await render(StructuredThermalSection, { construction: page.renderModel!.constructions[0], matches: page.matches, anchor: 'first', highlightEnabled: false })
  assert.ok(first.includes('first-option-1'))
  assert.ok(!first.includes('thermal-option--hit'))
  const second = await render(StructuredThermalSection, { construction: page.renderModel!.constructions[1], matches: page.matches, anchor: 'second' })
  assert.ok(!second.includes('thermal-option--hit'))
})

test('正式查表摘要下直接展示完整表格高亮，说明和结论保留，不显示参数卡', async () => {
  const page = referenceFixture()
  page.answerStyle = 'THERMAL_SOLUTIONS'
  const answer = '参考说明。\n\n- 原始完整参数说明。\n\n另一个结论。'
  page.matches[0]!.answerOffset = answer.indexOf('。\n\n另') + 1
  const html = await render(AiReferenceAnswer, { answer, pages: [page] })
  assert.ok(html.indexOf('参考说明。') < html.indexOf('thermal-table__header'))
  assert.ok(html.indexOf('查看参考页') < html.indexOf('另一个结论。'))
  assert.ok(!html.includes('原始完整参数说明'))
  assert.ok(!html.includes('answerOffset'))
  assert.ok(!html.includes('solution__parameters'))
  assert.ok(!html.includes('查看热阻参数'))
  assert.equal((html.match(/class="thermal-table__header"/g) || []).length, 1)
  assert.equal((html.match(/class="[^"]*thermal-table__field--hit/g) || []).length, 4)
  for (const text of ['2.880', '3.297', '0.303', '>15<', '>20<', '>25<']) assert.ok(html.includes(text), text)
})

test('跨页默认完整展示两页表格，其余有展开入口，独立锚点保留结论和来源', async () => {
  const pages = ['one', 'two', 'three'].map(id => ({ ...referenceFixture(), page: { ...referenceFixture().page, pageId: id } }))
  const html = await render(AiReferenceAnswer, { answer: '参考结论。', pages })
  assert.equal((html.match(/class="thermal-table__header"/g) || []).length, 2)
  assert.ok(html.includes('查看其他参考表格（1 页）'))
  const ids = [...html.matchAll(/id="([^"]+-option-\d+)"/g)].map(match => match[1])
  assert.equal(ids.length, new Set(ids).size)
  assert.ok(html.includes('参考结论。'))
})

test('回答同页两段两命中共用完整表格，不重复原图或缩减未命中档位', async () => {
  const page = referenceFixture()
  const answer = '参考方案。\n\n第一构造。\n\n第二构造。'
  page.matches[0]!.answerOffset = answer.indexOf('第一构造。') + '第一构造。'.length
  page.matches.push({ constructionId: 'A1-4', optionId: 'A1-4-20', fieldKeys: ['kValue'], answerOffset: answer.length })
  const html = await render(AiReferenceAnswer, { answer, pages: [page, page] })
  assert.equal((html.match(/class="thermal-table__header"/g) || []).length, 1)
  assert.equal((html.match(/class="[^"]*thermal-table__row--hit/g) || []).length, 2)
  assert.equal((html.match(/class="[^"]*thermal-table__field--hit/g) || []).length, 5)
  for (const text of ['匹配 2 处', '当前引用', '上一处', '下一处', '取消高亮', '重新显示']) assert.ok(!html.includes(text), text)
  assert.equal((html.match(/<button/g) || []).length, 2)
  assert.ok(html.includes('保温厚度')); assert.ok(html.includes('传热系数'))
  assert.ok(!html.includes('<image'))
  assert.ok(html.includes('第一构造。')); assert.ok(html.includes('第二构造。'))
})

test('老消息无模型内嵌完整原页，缺失图片提供参考页入口，不伪造高亮', async () => {
  const page = { ...referenceFixture(), renderModel: null }
  const html = await render(AiAnswerReferencePage, { page, anchorPrefix: 'old' })
  assert.ok(html.includes('mode="aspectFit"')); assert.ok(html.includes('查看参考页'))
  assert.ok(!html.includes('thermal-table__row--hit'))
  const historical = await render(AiAnswerReferencePage, { page: { ...page, page: { ...page.page, imageUrl: '' } }, anchorPrefix: 'history' })
  assert.ok(historical.includes('打开参考页查看完整原文。'))
  assert.ok(!historical.includes('<image'))
})

test('查询双 R 时所问指标直接可见，正式字段不因简洁模式被隐藏', async () => {
  const page = { ...referenceFixture(), primaryFieldKeys: ['totalThermalResistance' as const] }
  const html = await render(AiThermalSolutionCard, { page })
  assert.ok(html.includes('3.297'))
  assert.ok(!html.includes('查看热阻参数'))
})

test('系统名是主标题，表名括号小字，中文参数在标题下，表格工具栏保留完整表格高亮', async () => {
  const page = referenceFixture()
  page.renderModel!.pageTitle = '建筑外墙热工计算参考选用表（II型VICP薄抹灰外保温系统）'
  const html = await render(AiAnswerReferencePage, { page, anchorPrefix: 'heading' })
  const title = html.match(/class="reference-page-viewer__title"[^>]*>(.*?)<\/view>/s)?.[1]
  assert.ok(title?.includes('II型VICP薄抹灰外保温系统'))
  assert.ok(!title?.includes('建筑外墙热工计算参考选用表'))
  assert.ok(html.includes('（建筑外墙热工计算参考选用表）'))
  assert.ok(html.indexOf('II型VICP薄抹灰外保温系统') < html.indexOf('保温厚度'))
  assert.ok(html.includes('reference-page-viewer__actions'))
  assert.equal((html.match(/<button/g) || []).length, 2)
  for (const text of ['查看参考页', '全屏看表格', '保温厚度', '传热系数', '2.880', '3.297', '0.303']) assert.ok(html.includes(text), text)
  assert.equal((html.match(/class="[^"]*thermal-table__field--hit/g) || []).length, 4)
})

test('从查看参考页进入时可直接展示完整原图，有模型也不自动切回表格', async () => {
  const html = await render(ReferencePageViewer, { page: referenceFixture(), initialView: '原始页面' })
  assert.ok(html.includes('mode="aspectFit"'))
  assert.ok(html.includes('全屏查看'))
  assert.ok(!html.includes('thermal-table__header'))
})

test('编号格仅显示原图标识，系统属性有独立入口，完整构造与高亮不变', async () => {
  const page = referenceFixture()
  const construction = page.renderModel!.constructions[0]!
  construction.systemName = ` ${construction.constructionCode} `
  const html = await render(ReferencePageViewer, { page })
  const codes = [...html.matchAll(/class="thermal-table__cell thermal-table__code"[^>]*>(.*?)<\/view>/gs)].map(match => match[1]!)
  assert.equal((codes[0]!.match(/A1-3/g) || []).length, 1)
  assert.ok(!codes[1]!.includes('I型VICP'))
  assert.ok(html.includes('查看构造属性'))
  assert.equal((html.match(/class="[^"]*thermal-table__field--hit/g) || []).length, 4)
  construction.constructionCode = null
  construction.title = '外墙A2-1'
  construction.systemName = '外墙A2-1'
  const fallback = await render(ReferencePageViewer, { page })
  const cell = fallback.match(/class="thermal-table__cell thermal-table__code"[^>]*>(.*?)<\/view>/s)?.[1] || ''
  assert.equal((cell.match(/外墙A2-1/g) || []).length, 1)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { referenceFixture } from '../test/fixtures/referencePage'
import { formatReferenceNumber, hasPageRenderModel, normalizeReferencePages, referencePageHeading, referencePageInitialView, referencePersistenceSnapshot, referenceSolutions, resolvePageHighlights } from './referencePage'

test('确认版本约束在协议归一化后仍保留，旧引用不能标到新模型', () => {
  const source = referenceFixture()
  source.renderModel!.confirmedRevision = 'current'
  const construction = source.renderModel!.constructions[0]!
  source.matches = [{ constructionId: construction.constructionId, optionId: construction.options[0]!.optionId, confirmedRevision: 'old', fieldKeys: ['kValue'] }]
  const normalized = normalizeReferencePages([source])[0]!
  assert.equal(normalized.matches[0]!.confirmedRevision, 'old')
  assert.equal(resolvePageHighlights(normalized.renderModel!, normalized.matches, normalized.page.pageId).length, 0)
  normalized.matches[0]!.confirmedRevision = 'current'
  assert.equal(resolvePageHighlights(normalized.renderModel!, normalized.matches, normalized.page.pageId).length, 1)
})

test('来源标题视觉分层仅使用页面标题或明确统一系统名，原图路由有安全默认值', () => {
  const model = referenceFixture().renderModel!
  model.pageTitle = '建筑外墙热工计算参考选用表（II型VICP薄抹灰外保温系统）'
  assert.deepEqual(referencePageHeading(model), { title: 'II型VICP薄抹灰外保温系统', subtitle: '建筑外墙热工计算参考选用表' })
  model.pageTitle = '选用表 (II型VICP薄抹灰外保温系统)'
  assert.deepEqual(referencePageHeading(model), { title: 'II型VICP薄抹灰外保温系统', subtitle: '选用表' })
  model.pageTitle = '说明（节能75%）'
  assert.deepEqual(referencePageHeading(model), { title: model.pageTitle, subtitle: '' })
  model.constructions[0]!.systemName = 'I型外保温系统'
  model.constructions[1]!.systemName = 'II型外保温系统'
  assert.equal(referencePageHeading(model).title, model.pageTitle)
  model.constructions[1]!.systemName = 'I型外保温系统'
  assert.equal(referencePageHeading(model).title, 'I型外保温系统')
  assert.deepEqual(referencePageHeading(null), { title: '', subtitle: '' })
  assert.equal(referencePageInitialView('image'), '原始页面')
  assert.equal(referencePageInitialView(undefined), '页面内容')
  assert.equal(referencePageInitialView('unknown'), '页面内容')
})

test('同页多方案合并一页与字段；跨页分别保留，输入不修改', () => {
  const page = referenceFixture()
  const snapshot = JSON.stringify(page)
  const pages = normalizeReferencePages([page, { ...page, matches: [{ constructionId: 'A1-4', optionId: 'A1-4-18', fieldKeys: ['kValue'] }] }, { ...page, matches: [{ constructionId: 'A1-3', optionId: 'A1-3-18', fieldKeys: ['kValue'] }] }, { ...page, page: { ...page.page, pageId: 'page-23', pageLabel: '23' } }])
  assert.equal(pages.length, 2)
  assert.equal(pages[0]!.matches.length, 2)
  assert.equal(pages[1]!.page.pageLabel, '23')
  assert.equal(JSON.stringify(page), snapshot)
})
test('卡片使用正式行参数，错误 summary 不覆盖，缺失值不推导', () => {
  const page = referenceFixture()
  page.matches[0]!.summary = { thicknessMm: 99, kValue: 0.9 }
  const card = referenceSolutions(page)[0]!
  assert.equal(card.option.thicknessMm, 18)
  assert.equal(card.option.kValue, 0.303)
  assert.equal(card.match?.optionId, 'A1-3-18')
  page.renderModel!.constructions[0]!.options[1]!.totalThermalResistance = null
  assert.equal(referenceSolutions(page)[0]!.option.totalThermalResistance, null)
  page.renderModel!.constructions[0]!.systemName = 'A1-3'
  assert.equal(referenceSolutions(page)[0]!.system, 'VICP复合保温板')
})
test('相同数字和相同 optionId 必须限定构造，失效/跨页/歧义标识不猜测', () => {
  const page = referenceFixture()
  page.renderModel!.constructions.forEach(construction => { construction.options[1]!.optionId = 'same' })
  assert.deepEqual(resolvePageHighlights(page.renderModel, [{ optionId: 'same' }], 'page'), [])
  assert.equal(resolvePageHighlights(page.renderModel, [{ constructionId: 'A1-3', optionId: 'same' }], 'page').length, 1)
  assert.deepEqual(resolvePageHighlights(page.renderModel, [{ pageId: 'other', optionId: 'same', constructionId: 'A1-3' }], 'page'), [])
  assert.deepEqual(resolvePageHighlights(page.renderModel, [{ optionId: 'missing' }], 'page'), [])
})
test('旧页图片兼容，无模型的候选条不能伪造档位高亮', () => {
  const old = normalizeReferencePages([{ documentId: 'document', pageId: 'page', pageLabel: '69', pageImageUrl: '/original.png', summary: { thicknessMm: 8, kValue: 0.325 }, highlights: [{ field: 'kValue', value: '0.325' }] }])[0]!
  assert.equal(old.page.imageUrl, '/original.png')
  assert.equal(old.renderModel, null)
  assert.deepEqual(old.matches, [])
  assert.equal(referenceSolutions(old)[0]!.match, undefined)
  assert.equal(referenceSolutions(old)[0]!.option.kValue, 0.325)
})
test('highlights 标识协议同样可用，数字格式补三位但不降低正式精度', () => {
  const fixture = referenceFixture()
  const page = normalizeReferencePages([{ ...fixture, matches: [], highlights: fixture.matches }])[0]!
  assert.equal(referenceSolutions(page).length, 1)
  assert.equal(formatReferenceNumber(2.88, 3), '2.880')
  assert.equal(formatReferenceNumber('2.8800', 3), '2.8800')
  assert.equal(formatReferenceNumber(0.30345, 3), '0.30345')
  assert.equal(formatReferenceNumber(null, 3), '—')
  assert.equal(hasPageRenderModel({ constructions: [fixture.renderModel!.constructions[0], fixture.renderModel!.constructions[0]] }), false)
})
test('持久化删除 signed URL，原内存数据不变，标识和模型可恢复', () => {
  const page = referenceFixture()
  const state = { messages: [{ id: 'message', referencePages: [page] }] }
  const persisted = referencePersistenceSnapshot(state) as typeof state
  assert.equal(persisted.messages[0]!.referencePages[0]!.page.imageUrl, '')
  assert.match(state.messages[0]!.referencePages[0]!.page.imageUrl, /signature=old/)
  assert.equal(referenceSolutions(persisted.messages[0]!.referencePages[0]!).length, 1)
})

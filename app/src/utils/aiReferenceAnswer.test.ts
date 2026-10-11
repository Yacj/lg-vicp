import assert from 'node:assert/strict'
import { test } from 'node:test'
import { referenceFixture } from '../test/fixtures/referencePage'
import { referenceAnswerContent, referenceAnswerPageContent } from './aiReferenceAnswer'
import { normalizeReferencePages, restoreMessageReferences } from './referencePage'

test('正式段落位置保留，两个方案放到各自列表说明下，完整正文不改写', () => {
  const answer = '有参考方案。\n\n- **第一种构造**：18mm，K=0.303。\n- **第二种构造**：20mm，K=0.303。\n\n正式工程请核对。'
  const page = referenceFixture()
  page.matches[0]!.answerOffset = answer.indexOf('。\n-') + 1
  page.matches.push({ constructionId: 'A1-4', optionId: 'A1-4-20', fieldKeys: ['kValue'], answerOffset: answer.indexOf('。\n\n正式') + 1 })
  const normalized = normalizeReferencePages([page])[0]!
  assert.equal(normalized.matches[0]!.answerOffset, page.matches[0]!.answerOffset)
  const { blocks, leadingPages } = referenceAnswerContent(answer, [normalized])
  assert.equal(blocks.map(block => block.content).join(''), answer)
  assert.equal(leadingPages.length, 0)
  assert.equal(blocks[0]!.pages[0]!.matches[0]!.optionId, 'A1-3-18')
  assert.equal(blocks[1]!.pages[0]!.matches[0]!.optionId, 'A1-4-20')
  assert.equal(blocks[0]!.pages[0]!.renderModel?.constructions.length, 2)
})

test('没有正式段落关联或关联代码块时，方案优先展示，不根据相同数字猜位置', () => {
  const page = referenceFixture()
  const answer = '0.303 出现在多个无关段落。\n\n```text\n0.303\n```\n'
  let result = referenceAnswerContent(answer, [page])
  assert.equal(result.leadingPages.length, 1)
  assert.equal(result.blocks[0]!.content, answer)
  page.matches[0]!.answerOffset = answer.lastIndexOf('0.303') + 5
  result = referenceAnswerContent(answer, [page])
  assert.equal(result.leadingPages.length, 1)
  page.matches[0]!.answerOffset = 999
  assert.equal(referenceAnswerContent(answer, [page]).leadingPages.length, 1)
})

test('同段落同页多命中只生成一个来源组，跨页分别保留', () => {
  const answer = '多个参考方案。\n\n后续说明。'
  const page = referenceFixture()
  page.matches[0]!.answerOffset = answer.indexOf('\n')
  page.matches.push({ constructionId: 'A1-4', optionId: 'A1-4-18', fieldKeys: ['kValue'], answerOffset: answer.indexOf('\n') })
  const other = { ...page, page: { ...page.page, pageId: 'other' } }
  const result = referenceAnswerContent(answer, [page, page, other])
  assert.equal(result.blocks[0]!.pages.length, 2)
  assert.equal(result.blocks[0]!.pages[0]!.matches.length, 2)
})

test('同一档位引用到两段说明时关联位置不被合并丢失', () => {
  const page = referenceFixture()
  const answer = '第一段。\n\n第二段。'
  page.matches[0]!.answerOffset = 4
  page.matches.push({ ...page.matches[0]!, answerOffset: answer.length })
  const normalized = normalizeReferencePages([page])
  assert.equal(normalized[0]!.matches.length, 2)
  const result = referenceAnswerContent(answer, normalized)
  assert.equal(result.blocks.filter(block => block.pages.length).length, 2)
})

test('流式初步命中、最终段落引用与 done 扁平来源合并，不重复展示待定位卡片', () => {
  const initial = referenceFixture()
  initial.matches[0]!.candidateId = 'formal-candidate'
  initial.matches[0]!.pageId = initial.page.pageId
  initial.matches[0]!.fieldKeys = ['thicknessMm']
  const answer = '第一段。\n\n第二段。'
  const finalMatch = { constructionId: 'A1-3', optionId: 'A1-3-18', fieldKeys: ['kValue'], answerOffset: 4 }
  const final = { ...initial, matches: [finalMatch, { ...finalMatch, answerOffset: answer.length }] }
  const stored = { ...initial.page, imageUrl: '', renderModel: initial.renderModel, matches: final.matches }
  for (const events of [[initial, final, stored], [final, initial, stored]]) {
    const pages = normalizeReferencePages(events)
    assert.equal(pages.length, 1)
    assert.equal(pages[0]!.matches.length, 2)
    assert.ok(pages[0]!.page.imageUrl)
    assert.ok(pages[0]!.matches.every(match => match.fieldKeys?.includes('thicknessMm') && match.fieldKeys.includes('kValue')))
    const result = referenceAnswerContent(answer, pages)
    assert.equal(result.leadingPages.length, 0)
    assert.equal(result.blocks.filter(block => block.pages.length).length, 2)
    assert.equal(result.blocks.map(block => block.content).join(''), answer)
  }
})

test('历史加载保留同一条未改写消息的已接收来源，跨会话/改写/明确清空时不恢复', () => {
  const cached = [{ id: 'message', conversationId: 'conversation', content: '正式回答', referencePages: [referenceFixture()] }]
  const server = [{ id: 'message', conversationId: 'conversation', content: '正式回答' }]
  const restored = restoreMessageReferences(server, cached)
  assert.equal(restored[0]!.referencePages?.length, 1)
  assert.equal(restored[0]!.referencePages?.[0]!.page.imageUrl, '')
  assert.ok(cached[0]!.referencePages[0]!.page.imageUrl)
  assert.equal(restoreMessageReferences([{ ...server[0]!, content: '新的回答' }], cached)[0]!.referencePages, undefined)
  assert.equal(restoreMessageReferences([{ ...server[0]!, conversationId: 'other' }], cached)[0]!.referencePages, undefined)
  assert.deepEqual(restoreMessageReferences([{ ...server[0]!, referencePages: [] }], cached)[0]!.referencePages, [])
})

test('仅后端标记的正式方案摘要可替换；普通引用、失效标识和原始结论保留', () => {
  const answer = '条件说明。\n\n- 正式方案摘要。\n\n限制条件。'
  const page = referenceFixture()
  page.matches[0]!.answerOffset = answer.indexOf('。\n\n限制') + 1
  assert.equal(referenceAnswerContent(answer, [page], true).blocks.map(block => block.content).join(''), answer)
  page.answerStyle = 'THERMAL_SOLUTIONS'
  let result = referenceAnswerContent(answer, normalizeReferencePages([page]), true)
  assert.equal(result.blocks.map(block => block.content).join(''), '条件说明。\n\n限制条件。')
  assert.equal(result.blocks[0]!.pages[0]!.matches[0]!.optionId, 'A1-3-18')
  page.matches[0]!.optionId = 'obsolete'
  result = referenceAnswerContent(answer, [page], true)
  assert.equal(result.blocks.map(block => block.content).join(''), answer)
})

test('内嵌全文表格同页跨段只展示一次，全部命中合并，跨资料相同 pageId 不混合', () => {
  const answer = '有参考方案。\n\n- 第一构造。\n\n- 第二构造。\n\n条件说明。'
  const page = referenceFixture()
  page.answerStyle = 'THERMAL_SOLUTIONS'
  page.matches[0]!.answerOffset = answer.indexOf('第一构造。') + '第一构造。'.length
  page.matches.push({ constructionId: 'A1-4', optionId: 'A1-4-20', fieldKeys: ['kValue'], answerOffset: answer.indexOf('第二构造。') + '第二构造。'.length })
  const result = referenceAnswerPageContent(answer, [page, page])
  assert.equal(result.leadingPages.length, 0)
  assert.equal(result.blocks.flatMap(block => block.pages).length, 1)
  const embedded = result.blocks[0]!.pages[0]!
  assert.equal(embedded.matches.length, 2)
  assert.equal(embedded.renderModel?.constructions.length, 2)
  assert.equal(embedded.renderModel?.constructions[0]!.options.length, 4)
  assert.ok(!result.blocks.map(block => block.content).join('').includes('第二构造。'))
  assert.ok(result.blocks.at(-1)!.content.includes('条件说明。'))
  const other = { ...page, page: { ...page.page, documentId: 'other-document' } }
  assert.equal(referenceAnswerPageContent(answer, [page, other]).blocks.flatMap(block => block.pages).length, 2)
})

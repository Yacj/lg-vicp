import type { SolutionSnapshotDto } from '@/api/solution-types'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { complexAtlasFixture } from '../test/fixtures/complexAtlas'
import { referenceFixture } from '../test/fixtures/referencePage'
import { referenceTableLocation, resolveReferenceTablePage } from './referenceTable'

test('表格路由只携带来源标识和匹配位置，不携带模型或签名图片', () => {
  const page = referenceFixture()
  const location = referenceTableLocation(page, { referenceMessageId: 'message' }, page.matches[0], false)
  assert.deepEqual(location, { name: 'reference-table', params: { documentId: 'document', pageId: 'page', referenceMessageId: 'message', constructionId: 'A1-3', optionId: 'A1-3-18', highlight: '0' } })
  assert.ok(!JSON.stringify(location).includes('imageUrl'))
  assert.ok(!JSON.stringify(location).includes('renderModel'))
})

test('同页不同消息按原消息定位，缺失或不一致的来源不使用其他消息代替', () => {
  const page = referenceFixture()
  const other = referenceFixture()
  other.renderModel!.constructions[0]!.options[1]!.kValue = 0.9
  const messages = [{ id: 'first', referencePages: [page] }, { id: 'second', referencePages: [other] }]
  const query = referenceTableLocation(page, { referenceMessageId: 'first' }, page.matches[0]).params
  const result = resolveReferenceTablePage(messages, null, query)!
  assert.equal(result.renderModel!.constructions[0]!.options[1]!.kValue, 0.303)
  assert.deepEqual(JSON.parse(JSON.stringify(result.matches)), page.matches)
  for (const invalid of [{ ...query, referenceMessageId: 'missing' }, { ...query, documentId: 'wrong' }, { ...query, pageId: 'wrong' }, { ...query, referenceMessageId: undefined }, { ...query, referenceSnapshotId: 'also-present' }])
    assert.equal(resolveReferenceTablePage(messages, null, invalid), undefined)
})

test('冻结表格只读取指定快照，保留全部档位和正式选项定位', () => {
  const page = referenceFixture()
  const snapshot = { id: 'snapshot', payload: { referencePages: [{ documentId: 'document', sourcePageId: 'page', renderModel: page.renderModel }], candidates: [{ sourcePageId: 'page', optionId: 'A1-3-18', candidateId: 'candidate' }], alternatives: [] } } as unknown as SolutionSnapshotDto
  const query = referenceTableLocation(page, { referenceSnapshotId: snapshot.id }).params
  const result = resolveReferenceTablePage([], snapshot, query)!
  assert.deepEqual(result.renderModel, page.renderModel)
  assert.equal(result.matches[0]!.optionId, 'A1-3-18')
  assert.equal(resolveReferenceTablePage([], { ...snapshot, id: 'different' }, query), undefined)
})

test('全屏旧路由不能把换版或已失效档位绑定到新模型首行', () => {
  const page = complexAtlasFixture(90)
  const query = referenceTableLocation(page, { referenceMessageId: 'message' }, page.matches[1]).params
  const messages = [{ id: 'message', referencePages: [page] }]
  assert.equal(query.confirmedRevision, page.renderModel!.confirmedRevision)
  assert.ok(resolveReferenceTablePage(messages, null, query))
  assert.equal(resolveReferenceTablePage(messages, null, { ...query, confirmedRevision: 'stale' }), undefined)
  assert.equal(resolveReferenceTablePage(messages, null, { ...query, optionId: 'stale' }), undefined)
  assert.equal(resolveReferenceTablePage(messages, null, { ...query, constructionId: page.renderModel!.constructions[0]!.constructionId }), undefined)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AiSourceDetail } from '@/api/types'
import { useReferencePageResource } from './useReferencePageResource'
function detail(url = 'https://example.test/page.png?signature=new'): AiSourceDetail {
  return { document: { id: 'document', title: '参考图集' }, original: { pageImageUrl: url }, page: { id: 'page', pageImageUrl: url } } as AiSourceDetail
}
test('签名图片过期重新请求 Backend 一次，再失败提供手动重试', async () => {
  let calls = 0
  const resource = useReferencePageResource(() => ({ locator: { pageId: 'page' } }), async () => { calls++; return detail(`https://example.test/${calls}.png`) })
  await resource.load()
  assert.equal(resource.status.value, 'ready')
  await resource.recoverImage()
  assert.equal(calls, 2)
  assert.match(resource.pageImageUrl.value, /2.png/)
  assert.equal(resource.imageRevision.value, 1)
  await resource.recoverImage()
  assert.equal(calls, 2)
  assert.equal(resource.imageFailed.value, true)
  await resource.recoverImage(true)
  assert.equal(calls, 3)
  resource.imageLoaded()
  assert.equal(resource.imageFailed.value, false)
})
test('续签网络失败保留表格与已加载详情，页面首次加载失败可重试', async () => {
  let fail = true
  const resource = useReferencePageResource(() => ({ locator: { pageId: 'page' } }), async () => { if (fail) throw new Error('network'); return detail() })
  await resource.load(); assert.equal(resource.status.value, 'error')
  fail = false; await resource.load(); assert.equal(resource.status.value, 'ready')
  fail = true; await resource.recoverImage()
  assert.equal(resource.status.value, 'ready')
  assert.equal(resource.detail.value?.page?.id, 'page')
  assert.equal(resource.imageFailed.value, true)
})
test('Backend 返回其他页时拒绝错页，取消/并发加载不覆盖当前页面', async () => {
  const wrong = useReferencePageResource(() => ({ locator: { pageId: 'other' } }), async () => detail())
  await wrong.load(); assert.equal(wrong.status.value, 'error'); assert.equal(wrong.detail.value, null)
  let resolveFirst: (value: AiSourceDetail) => void = () => {}
  let calls = 0
  const resource = useReferencePageResource(() => ({ locator: { pageId: 'page' } }), async () => ++calls === 1 ? new Promise<AiSourceDetail>(resolve => { resolveFirst = resolve }) : detail())
  const first = resource.load()
  await resource.load()
  resolveFirst(detail('old')); await first
  assert.equal(resource.status.value, 'ready'); assert.notEqual(resource.pageImageUrl.value, 'old')
  resource.cancel()
})

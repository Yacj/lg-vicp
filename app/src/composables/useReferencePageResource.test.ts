import type { AiSourceDetail } from '@/api/types'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { useReferencePageResource } from './useReferencePageResource'

function detail(url = 'https://example.test/page.png?signature=new'): AiSourceDetail {
  return { document: { id: 'document', title: '参考图集' }, original: { pageImageUrl: url }, page: { id: 'page', pageImageUrl: url } } as AiSourceDetail
}
test('签名图片过期重新请求 Backend 一次，再失败提供手动重试', async () => {
  let calls = 0
  const resource = useReferencePageResource(() => ({ locator: { pageId: 'page' } }), async () => {
    calls++
    return detail(`https://example.test/${calls}.png`)
  })
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

test('确认快照变化拒绝把新原图绑到旧引用', async () => {
  const context = { page: { documentId: 'document' }, renderModel: { confirmedRevision: 'old' } } as never
  const resource = useReferencePageResource(() => ({ locator: { pageId: 'page' }, context }), async () => ({ ...detail(), page: { ...detail().page!, renderModel: { confirmedRevision: 'new', constructions: [] } } }))
  await resource.load()
  assert.equal(resource.status.value, 'error')
  assert.match(resource.errorMessage.value, /确认版本已变化/)
  assert.equal(resource.detail.value, null)
})
test('续签网络失败保留表格与已加载详情，页面首次加载失败可重试', async () => {
  let fail = true
  const resource = useReferencePageResource(() => ({ locator: { pageId: 'page' } }), async () => {
    if (fail)
      throw new Error('network')
    return detail()
  })
  await resource.load()
  assert.equal(resource.status.value, 'error')
  assert.equal(resource.errorMessage.value, 'network')
  fail = false
  await resource.load()
  assert.equal(resource.status.value, 'ready')
  assert.equal(resource.errorMessage.value, '')
  fail = true
  await resource.recoverImage()
  assert.equal(resource.status.value, 'ready')
  assert.equal(resource.detail.value?.page?.id, 'page')
  assert.equal(resource.imageFailed.value, true)
})
test('Backend 返回其他页时拒绝错页，取消/并发加载不覆盖当前页面', async () => {
  const wrong = useReferencePageResource(() => ({ locator: { pageId: 'other' } }), async () => detail())
  await wrong.load()
  assert.equal(wrong.status.value, 'error')
  assert.equal(wrong.detail.value, null)
  assert.equal(wrong.errorMessage.value, '引用页面不一致')
  let resolveFirst: (value: AiSourceDetail) => void = () => {}
  let calls = 0
  const resource = useReferencePageResource(() => ({ locator: { pageId: 'page' } }), async () => ++calls === 1
    ? new Promise<AiSourceDetail>((resolve) => {
        resolveFirst = resolve
      })
    : detail())
  const first = resource.load()
  await resource.load()
  resolveFirst(detail('old'))
  await first
  assert.equal(resource.status.value, 'ready')
  assert.notEqual(resource.pageImageUrl.value, 'old')
  resource.cancel()
})
test('来源失效保留 Backend 具体原因，过期请求的失败不覆盖当前页', async () => {
  const failure = Object.assign(new Error('请求失败'), { data: { error: { code: 404, message: '知识资料版本不存在或尚未发布' }, requestId: 'request' } })
  const failed = useReferencePageResource(() => ({ locator: { pageId: 'page' } }), async () => {
    throw failure
  })
  await failed.load()
  assert.equal(failed.errorMessage.value, '知识资料版本不存在或尚未发布')
  let rejectFirst: (error: Error) => void = () => {}
  let calls = 0
  const resource = useReferencePageResource(() => ({ locator: { pageId: 'page' } }), async () => ++calls === 1
    ? new Promise<AiSourceDetail>((_, reject) => {
        rejectFirst = reject
      })
    : detail())
  const first = resource.load()
  await resource.load()
  rejectFirst(failure)
  await first
  assert.equal(resource.status.value, 'ready')
  assert.equal(resource.errorMessage.value, '')
})

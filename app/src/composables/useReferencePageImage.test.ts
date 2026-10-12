import assert from 'node:assert/strict'
import { test } from 'node:test'
import { useReferencePageImage } from './useReferencePageImage'

test('原生读取签名图片后使用返回的临时路径，读取失败不会留下空白图片', async () => {
  let fail = false
  const image = useReferencePageImage(async () => {
    if (fail)
      throw new Error('download failed')
    return { path: '/tmp/original-page.png', width: 1200, height: 1700 }
  })
  const first = image.load('https://example.test/page.png?signature=new')
  assert.equal(image.status.value, 'loading')
  assert.equal(await first, 'ready')
  assert.equal(image.source.value, '/tmp/original-page.png')
  fail = true
  assert.equal(await image.load('https://example.test/page.png?signature=expired'), 'error')
  assert.equal(image.source.value, '')
  assert.equal(image.status.value, 'error')
  assert.equal(await image.load(''), 'empty')
})

test('切换图片和离开页面后迟到的原生读取结果不覆盖当前状态', async () => {
  let resolveFirst: (value: { path: string, width: number, height: number }) => void = () => {}
  const image = useReferencePageImage(async url => url === 'old'
    ? new Promise((resolve) => { resolveFirst = resolve })
    : { path: 'current', width: 1200, height: 1700 })
  const first = image.load('old')
  await image.load('new')
  resolveFirst({ path: 'old', width: 1200, height: 1700 })
  assert.equal(await first, 'stale')
  assert.equal(image.source.value, 'current')
  const cancelled = image.load('old')
  image.cancel()
  resolveFirst({ path: 'cancelled', width: 1200, height: 1700 })
  assert.equal(await cancelled, 'stale')
  assert.equal(image.source.value, '')
})

test('使用 uni.getImageInfo 下载解码图片，空路径或无效尺寸按失败处理', async () => {
  const previousUni = Reflect.get(globalThis, 'uni')
  const urls: string[] = []
  Reflect.set(globalThis, 'uni', {
    getImageInfo(options: { src: string, success: (info: { path: string, width: number, height: number }) => void }) {
      urls.push(options.src)
      options.success({ path: '/tmp/page.png', width: 1000, height: 1500 })
    },
  })
  try {
    const image = useReferencePageImage()
    assert.equal(await image.load('https://example.test/page.png'), 'ready')
    assert.deepEqual(urls, ['https://example.test/page.png'])
    assert.equal(image.source.value, '/tmp/page.png')
    const signedUrl = 'http://lcvp-files.oss-cn-beijing.aliyuncs.com/page.png?Signature=abc%2Fdef&Expires=123'
    assert.equal(await image.load(signedUrl), 'ready')
    assert.equal(urls[1], signedUrl.replace(/^http:/, 'https:'))
    assert.equal(await image.load('http://localhost:9000/page.png'), 'ready')
    assert.equal(urls[2], 'http://localhost:9000/page.png')
    image.failed()
    assert.equal(image.status.value, 'error')
    const invalid = useReferencePageImage(async () => ({ path: '', width: 0, height: 0 }))
    assert.equal(await invalid.load('invalid'), 'error')
  }
  finally {
    if (previousUni === undefined)
      Reflect.deleteProperty(globalThis, 'uni')
    else
      Reflect.set(globalThis, 'uni', previousUni)
  }
})

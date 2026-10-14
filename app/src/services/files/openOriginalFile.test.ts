import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test as nodeTest } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function setup(platform: 'h5' | 'app' | 'mp-weixin' | 'other') {
  const opened: Record<string, any>[] = []
  const downloads: Record<string, any>[] = []
  const saved: Record<string, any>[] = []
  const images: Record<string, any>[] = []
  const order: string[] = []
  let blocked = false
  let windows = 0
  const tab = { opener: {}, closed: false, location: { href: '' }, close() {
    this.closed = true
  } }
  const uni = {
    downloadFile: (options: Record<string, any>) => {
      downloads.push(options)
      options.success({ statusCode: 200, tempFilePath: '/temp/report.pdf' })
    },
    saveFile: (options: Record<string, any>) => {
      saved.push(options)
      options.success({ savedFilePath: '/saved/report.pdf' })
    },
    openDocument: (options: Record<string, any>) => {
      opened.push(options)
      options.success()
    },
    previewImage: (options: Record<string, any>) => {
      images.push(options)
      options.success()
    },
  }
  const exports: Record<string, any> = {}
  const compiled = ts.transpileModule(readFileSync(new URL('./openOriginalFile.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  runInNewContext(compiled, {
    exports,
    uni,
    require: () => ({ getPlatformInfo: () => ({ platform }) }),
    window: { open: () => {
      windows++
      order.push('window')
      return blocked ? null : tab
    } },
  })
  return { open: exports.openOriginalFile, page: exports.withPdfPage, uni, opened, downloads, saved, images, tab, order, windows: () => windows, block: () => {
    blocked = true
  } }
}

nodeTest('H5 在签发 URL 前同步开新窗口；预览定位物理页，下载使用 attachment 地址', async () => {
  for (const mode of ['preview', 'download']) {
    const context = setup('h5')
    let resolve!: (value: { url: string, expiresIn: number }) => void
    const pending = context.open({ mode, mimeType: 'application/pdf', physicalPageNumber: 3, getUrl: () => {
      context.order.push('sign')
      return new Promise((done) => {
        resolve = done
      })
    } })
    assert.deepEqual(context.order, ['window', 'sign'])
    assert.equal(context.tab.location.href, '')
    resolve({ url: 'https://files.test/report.pdf?signature=fixture', expiresIn: 60 })
    await pending
    assert.equal(context.tab.location.href.endsWith('#page=3'), mode === 'preview')
    assert.equal(context.windows(), 1)
    assert.equal(context.downloads.length, 0)
  }
})

nodeTest('H5 拦截窗口不请求签名；签发失败关闭空窗口并保留后端消息', async () => {
  const blocked = setup('h5')
  blocked.block()
  let requests = 0
  await assert.rejects(blocked.open({ mimeType: 'application/pdf', getUrl: async () => {
    requests++
    return { url: 'fixture', expiresIn: 60 }
  } }), /浏览器拦截/)
  assert.equal(requests, 0)
  const failed = setup('h5')
  await assert.rejects(failed.open({ mimeType: 'application/pdf', getUrl: async () => {
    throw new Error('报告尚未发布')
  } }), /报告尚未发布/)
  assert.equal(failed.tab.closed, true)
})

nodeTest('每次操作获取新地址，明确过期 TTL 最多续签一次且不持久缓存', async () => {
  const context = setup('h5')
  let count = 0
  const getUrl = async () => ({ url: `https://files.test/${++count}.pdf`, expiresIn: count === 1 ? 0 : 60 })
  await context.open({ mimeType: 'application/pdf', getUrl })
  assert.equal(count, 2)
  await context.open({ mimeType: 'application/pdf', getUrl })
  assert.equal(count, 3)
  assert.ok(context.tab.location.href.endsWith('/3.pdf'))
  const expired = setup('mp-weixin')
  let retries = 0
  await assert.rejects(expired.open({ getUrl: async () => {
    retries++
    return { url: 'fixture', expiresIn: 0 }
  } }), /过期/)
  assert.equal(retries, 2)
  assert.equal(expired.downloads.length, 0)
})

nodeTest('App/微信临时文件预览，微信显式 PDF 类型；保存仅在下载动作触发', async () => {
  for (const platform of ['app', 'mp-weixin'] as const) {
    for (const mode of ['preview', 'download']) {
      const context = setup(platform)
      await context.open({ url: 'https://files.test/report.pdf', mode, mimeType: 'application/pdf' })
      assert.equal(context.saved.length, mode === 'download' ? 1 : 0)
      assert.equal(context.opened[0].filePath, mode === 'download' ? '/saved/report.pdf' : '/temp/report.pdf')
      assert.equal(context.opened[0].showMenu, true)
      assert.equal(context.opened[0].fileType, platform === 'mp-weixin' ? 'pdf' : undefined)
    }
  }
})

nodeTest('原生下载 401/403 续签一次；404、网络、打开、保存失败不伪报成功', async () => {
  for (const code of [401, 403]) {
    const context = setup('mp-weixin')
    let signatures = 0
    let downloads = 0
    context.uni.downloadFile = options => options.success({ statusCode: ++downloads === 1 ? code : 200, tempFilePath: '/temp/report.pdf' })
    await context.open({ mimeType: 'application/pdf', getUrl: async () => ({ url: `fixture-${++signatures}`, expiresIn: 60 }) })
    assert.equal(signatures, 2)
    assert.equal(context.opened.length, 1)
  }
  const missing = setup('app')
  missing.uni.downloadFile = options => options.success({ statusCode: 404, tempFilePath: '/temp/error.xml' })
  await assert.rejects(missing.open({ url: 'fixture', mimeType: 'application/pdf' }), /404/)
  assert.equal(missing.opened.length, 0)
  const repeated = setup('mp-weixin')
  let signatures = 0
  repeated.uni.downloadFile = options => options.success({ statusCode: 403 })
  await assert.rejects(repeated.open({ getUrl: async () => ({ url: `fixture-${++signatures}`, expiresIn: 60 }) }), /403/)
  assert.equal(signatures, 2)
  for (const failure of ['download', 'save', 'open']) {
    const context = setup('app')
    if (failure === 'download')
      context.uni.downloadFile = options => options.fail({})
    if (failure === 'save')
      context.uni.saveFile = options => options.fail({})
    if (failure === 'open')
      context.uni.openDocument = options => options.fail({})
    await assert.rejects(context.open({ url: 'fixture', mode: 'download', mimeType: 'application/pdf' }), /失败|无法打开/)
  }
})

nodeTest('离开页面或账号变化后的签发/下载结果不再打开文件；旧图片与物理页定位兼容', async () => {
  const context = setup('mp-weixin')
  let active = true
  context.uni.downloadFile = (options) => {
    active = false
    options.success({ statusCode: 200, tempFilePath: '/temp/report.pdf' })
  }
  await assert.rejects(context.open({ url: 'fixture', isCurrent: () => active }), /取消/)
  assert.equal(context.opened.length, 0)
  const image = setup('h5')
  await image.open({ url: 'https://files.test/original.png' })
  assert.equal(image.images.length, 1)
  assert.equal(image.windows(), 0)
  assert.equal(image.page('https://files.test/original.pdf#old', 2), 'https://files.test/original.pdf#page=2')
})

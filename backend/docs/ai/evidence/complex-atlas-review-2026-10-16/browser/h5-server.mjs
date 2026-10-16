import fs from 'node:fs'
// 仅开发验收：真实 UniApp H5 编译器和组件 + 人工来源 HTTP/SSE；不连接业务服务。
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

async function main() {
  const appRoot = "E:/code/lg/app"
  const sourceRoot = "E:/code/lg/app/docs/ai/evidence/complex-atlas-phase4/fixture-preview"
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vicp-atlas-h5-phase4-')).replaceAll('\\', '/')
  fs.cpSync(`${sourceRoot}/src`, `${root}/src`, { recursive: true })
  fs.copyFileSync(`${sourceRoot}/index.html`, `${root}/index.html`)
  fs.copyFileSync(`${sourceRoot}/matrix.html`, `${root}/matrix.html`)
  fs.writeFileSync(`${root}/package.json`, JSON.stringify({ type: 'module', dependencies: JSON.parse(fs.readFileSync(`${appRoot}/package.json`, 'utf8')).dependencies }))
  fs.symlinkSync(`${appRoot}/node_modules`, `${root}/node_modules`, 'junction')
  for (const dir of ['api', 'components', 'composables', 'constants', 'router', 'services', 'store', 'styles', 'uni_modules', 'utils'])
    fs.symlinkSync(`${appRoot}/src/${dir}`, `${root}/src/${dir}`, 'junction')
  const req = createRequire(`${appRoot}/package.json`)
  process.chdir(root)
  process.env.VITE_ROOT_DIR = root
  process.env.UNI_PLATFORM = 'h5'
  process.env.UNI_INPUT_DIR = `${root}/src`
  process.env.UNI_OUTPUT_DIR = `${root}/dist`
  const { createServer } = req('vite')
  const Uni = req('@dcloudio/vite-plugin-uni').default
  const Components = req('@uni-helper/vite-plugin-uni-components').default
  const AutoImport = req('unplugin-auto-import/vite').default
  const Uno = req('unocss/vite').default
  const fixtures = Object.fromEntries([89, 90, 75].map(p => [p, JSON.parse(fs.readFileSync(`${appRoot}/src/test/fixtures/complex-atlas/page-${p}.json`, 'utf8').replace(/^\uFEFF/, ''))]))
  const log = line => fs.appendFileSync("E:/code/lg/backend/docs/ai/evidence/complex-atlas-review-2026-10-16/browser/h5-requests.log", `${new Date().toISOString()} ${line}\n`)
  function fixture(p) {
    const value = structuredClone(fixtures[p])
    value.page.imageUrl = `/fixture/original/${p}.png`
    return value
  }
  const plugin = { name: 'atlas-isolated-protocol', resolveId(id) {
    if (id === 'virtual:uni-pages')
      return '\0atlas-pages'
  }, load(id) {
    if (id === '\0atlas-pages')
      return 'export const pages = []; export const subPackages = []'
  }, configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url, 'http://127.0.0.1:5187')
      if (url.pathname === '/matrix.html') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8')
        response.end(fs.readFileSync(`${sourceRoot}/matrix.html`))
        return
      }
      if (!url.pathname.startsWith('/fixture/') && !url.pathname.startsWith('/api/'))
        return next()
      log(`${request.method} ${url.pathname}${url.search}`)
      if (url.pathname.startsWith('/api/')) {
        response.statusCode = 403
        response.end('Fixture 禁止业务 API')
        return
      }
      const p = url.searchParams.get('page') || url.pathname.match(/\/(89|90|75)\.png$/)?.[1]
      if (!fixtures[p]) {
        response.statusCode = 404
        response.end('未知隔离页')
        return
      }
      response.setHeader('Cache-Control', 'no-store')
      if (url.pathname === '/fixture/expired.png') {
        response.statusCode = 403
        response.end('隔离签名过期')
        return
      }
      if (url.pathname.startsWith('/fixture/original/')) {
        const bytes = fs.readFileSync(`${appRoot}/../admin-web/docs/ai/evidence/complex-atlas-phase2/source-page-${p}.png`)
        response.setHeader('Content-Type', 'image/png')
        response.end(bytes)
        log(`IMAGE ${p} ${bytes.length} bytes`)
        return
      }
      const page = fixture(p)
      if (url.pathname === '/fixture/detail') {
        const imageUrl = url.searchParams.get('expired') === '1' ? `/fixture/expired.png?page=${p}` : page.page.imageUrl
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ document: { id: page.page.documentId, title: page.page.documentTitle }, location: { pageLabel: p }, original: { fileId: `fixture-original-${p}`, previewUrl: page.page.imageUrl, pageImageUrl: imageUrl }, page: { id: page.page.pageId, pageLabel: p, renderModel: page.renderModel, pageImageUrl: imageUrl } }))
        return
      }
      if (url.pathname === '/fixture/sse') {
        const thick = Number(url.searchParams.get('thickness')) === 25 ? 25 : 20
        page.matches = page.renderModel.constructions.flatMap(c => c.options.filter(o => o.thicknessMm === thick).map(o => ({ pageId: page.page.pageId, confirmedRevision: page.renderModel.confirmedRevision, constructionId: c.constructionId, optionId: o.optionId, fieldKeys: ['thicknessMm', 'totalThermalResistance', 'kValue'] })))
        const answer = `人工源图基线：第 ${p} 页 ${thick}mm 两个构造分别列出。参数相同也保留各自构造，请核对原页。\n\n普通说明：**此演示没有发布或确认任何方案**。`
        page.matches.forEach(m => m.answerOffset = answer.length)
        response.setHeader('Content-Type', 'text/event-stream')
        const emit = (event, data) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        if (url.searchParams.get('order') === 'source-first')
          emit('reference_pages', { referencePages: [page] })
        for (const text of [answer.slice(0, 18), answer.slice(18)]) {
          emit('delta', { text })
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        emit('reference_pages', { referencePages: [page] })
        emit('reference_pages', { referencePages: [page] })
        emit('done', { messageId: `fixture-${p}`, conversationId: 'fixture-phase4', referencePages: [page], finishReason: 'COMPLETED' })
        response.end()
        return
      }
      response.statusCode = 404
      response.end('未知隔离接口')
    })
  } }
  const server = await createServer({ configFile: false, root, cacheDir: `${root}/.cache`, plugins: [plugin, Components({ dts: `${root}/components.d.ts`, dirs: [], resolvers: [{ type: 'component', resolve(name) {
    if (/^Wd[A-Z]/.test(name)) {
      const component = name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
      return { name, from: `@wot-ui/ui/components/${component}/${component}.vue` }
    }
  } }] }), AutoImport({ imports: ['vue', 'pinia', { '@wot-ui/router': ['createRouter', 'useRouter', 'useRoute'] }, { '@wot-ui/ui': ['CommonUtil', 'useToast'] }], dirs: [`${appRoot}/src/composables`], dts: false }), Uni(), Uno({ configFile: `${appRoot}/uno.config.ts` })], define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('http://127.0.0.1:5187'), 'import.meta.env.VITE_ENABLE_API_MOCK': JSON.stringify('false'), 'import.meta.env.VITE_APP_NAME': JSON.stringify('隔离表格验收') }, resolve: { alias: { '@': `${root}/src` } }, server: { host: '127.0.0.1', port: 5187, strictPort: true, fs: { allow: [root, appRoot] } } })
  await server.listen()
  console.log('FIXTURE_PATHS', JSON.stringify({ input: process.env.UNI_INPUT_DIR, root: server.config.root, plugins: server.config.plugins.filter(p => p.name.includes('main')).map(p => p.name) }))
  console.log('ISOLATED_UNI_H5_FIXTURE http://127.0.0.1:5187')
}
void main()

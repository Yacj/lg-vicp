// 阶段5专用：真实三端组件连接随机隔离后端；不模拟业务HTTP/SSE或图片。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const here = import.meta.dirname.replaceAll('\\', '/')
const workspace = path.resolve(here, '../../../../../..').replaceAll('\\', '/')
const bridge = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
for (const base of [bridge.adminBase, bridge.clientBase]) {
  const url = new URL(base)
  if (url.hostname !== '127.0.0.1') throw Error('仅允许本次本机隔离后端')
}
function protocol(kind) {
  return { name: `real-isolated-${kind}`, resolveId(id) { if (id === 'virtual:uni-pages') return '\0atlas-pages' }, load(id) { if (id === '\0atlas-pages') return 'export const pages = []; export const subPackages = []' }, configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname
      if (pathname === '/test-session') {
        response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ documentId: bridge.documentId, versionId: bridge.versionId, pages: bridge.pages, conversations: bridge.conversations, ...(kind === 'h5' ? { accessToken: bridge.clientToken } : {}) }))
        return
      }
      if (!pathname.startsWith('/api/')) return next()
      const target = new URL(request.url, kind === 'h5' ? bridge.clientBase : bridge.adminBase)
      const headers = { ...request.headers, host: target.host, authorization: `Bearer ${kind === 'h5' ? bridge.clientToken : bridge.adminToken}` }
      // 请求日志不含令牌、签名URL或正文；SSE直接转发，不合成来源。
      fs.appendFileSync(`${here}/../browser-requests.log`, `${new Date().toISOString()} ${kind} ${request.method} ${pathname}\n`)
      const upstream = http.request(target, { method: request.method, headers }, result => { response.writeHead(result.statusCode, result.headers); result.pipe(response) })
      upstream.on('error', () => { response.statusCode = 502; response.end('隔离后端不可用') })
      request.pipe(upstream)
    })
  } }
}
const adminRoot = `${workspace}/admin-web`, appRoot = `${workspace}/app`
const reqB = createRequire(`${adminRoot}/package.json`)
const { createServer: createB } = await import(pathToFileURL(reqB.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(reqB.resolve('@vitejs/plugin-vue')).href)
const bRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vicp-atlas-b-phase5-')).replaceAll('\\', '/')
fs.copyFileSync(`${here}/Atlas.vue`, `${bRoot}/Atlas.vue`)
fs.copyFileSync(`${here}/main-b.js`, `${bRoot}/main.js`)
fs.writeFileSync(`${bRoot}/index.html`, '<html lang="zh-CN"><meta charset="utf-8"><div id="app"></div><script type="module" src="/main.js"></script></html>')
fs.writeFileSync(`${bRoot}/package.json`, '{"type":"module"}')
fs.symlinkSync(`${adminRoot}/node_modules`, `${bRoot}/node_modules`, 'junction')
const defineB = Object.fromEntries(Object.entries({ VITE_APP_API_BASEURL: 'http://127.0.0.1:5189', VITE_APP_TITLE: '隔离联合验收', VITE_APP_PREFIX: 'atlas-phase5', VITE_BUILD_MOCK: 'false', VITE_OPEN_PROXY: 'false' }).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]))
const b = await createB({ configFile: false, root: bRoot, plugins: [protocol('b'), vue()], define: defineB, resolve: { alias: { '@': `${adminRoot}/src`, vue: reqB.resolve('vue/dist/vue.runtime.esm-bundler.js'), pinia: `${adminRoot}/node_modules/pinia`, 'tdesign-vue-next': `${adminRoot}/node_modules/tdesign-vue-next` }, dedupe: ['vue'] }, server: { host: '127.0.0.1', port: 5189, strictPort: true, fs: { allow: [bRoot, workspace] } } })
await b.listen()

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vicp-atlas-h5-phase5-')).replaceAll('\\', '/')
fs.cpSync(`${here}/h5`, `${root}/src`, { recursive: true })
fs.writeFileSync(`${root}/index.html`, '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="app"></div><script type="module" src="/src/main.ts"></script></html>')
fs.writeFileSync(`${root}/package.json`, JSON.stringify({ type: 'module', dependencies: JSON.parse(fs.readFileSync(`${appRoot}/package.json`, 'utf8')).dependencies }))
fs.symlinkSync(`${appRoot}/node_modules`, `${root}/node_modules`, 'junction')
for (const dir of ['api', 'components', 'composables', 'constants', 'router', 'services', 'store', 'styles', 'uni_modules', 'utils']) fs.symlinkSync(`${appRoot}/src/${dir}`, `${root}/src/${dir}`, 'junction')
const req = createRequire(`${appRoot}/package.json`)
process.chdir(root)
process.env.VITE_ROOT_DIR = root; process.env.UNI_PLATFORM = 'h5'; process.env.UNI_INPUT_DIR = `${root}/src`; process.env.UNI_OUTPUT_DIR = `${root}/dist`
const { createServer } = req('vite')
const Uni = req('@dcloudio/vite-plugin-uni').default, Components = req('@uni-helper/vite-plugin-uni-components').default, AutoImport = req('unplugin-auto-import/vite').default, Uno = req('unocss/vite').default
const h = await createServer({ configFile: false, root, cacheDir: `${root}/.cache`, plugins: [protocol('h5'), Components({ dts: `${root}/components.d.ts`, dirs: [], resolvers: [{ type: 'component', resolve(name) { if (/^Wd[A-Z]/.test(name)) return { name, from: `@wot-ui/ui/components/${name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}/${name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}.vue` } } }] }), AutoImport({ imports: ['vue', 'pinia', { '@wot-ui/router': ['createRouter', 'useRouter', 'useRoute'] }, { '@wot-ui/ui': ['CommonUtil', 'useToast'] }], dirs: [`${appRoot}/src/composables`], dts: false }), Uni(), Uno({ configFile: `${appRoot}/uno.config.ts` })], define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('http://127.0.0.1:5188'), 'import.meta.env.VITE_ENABLE_API_MOCK': JSON.stringify('false'), 'import.meta.env.VITE_APP_NAME': JSON.stringify('隔离联合验收') }, resolve: { alias: { '@': `${root}/src` } }, server: { host: '127.0.0.1', port: 5188, strictPort: true, fs: { allow: [root, appRoot] } } })
await h.listen()
console.log('REAL_ISOLATED_COMPONENT_UAT B=http://127.0.0.1:5189 H5=http://127.0.0.1:5188')


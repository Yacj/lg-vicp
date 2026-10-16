// UI Fixture 验证：复用正式 Vue / UniApp 组件，不模拟真实 HTTP/SSE 或生产资料。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const here = import.meta.dirname.replaceAll('\\', '/')
const workspace = path.resolve(here, '../../../../..').replaceAll('\\', '/')
const admin = `${workspace}/admin-web`, app = `${workspace}/app`
const models = JSON.parse(fs.readFileSync(`${here}/models.json`, 'utf8'))
const originals = Object.fromEntries(JSON.parse(fs.readFileSync(`${here}/manifest.json`, 'utf8')))
function fixture() { return { name: 'atlas-layout-fixture', configureServer(server) {
  server.middlewares.use((req, res, next) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (url.pathname === '/fixture') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(models[url.searchParams.get('page') || '53'])); return }
    if (url.pathname === '/original' && originals[url.searchParams.get('page')]) { res.setHeader('Content-Type', 'image/png'); fs.createReadStream(originals[url.searchParams.get('page')]).pipe(res); return }
    next()
  })
} } }
const reqB = createRequire(`${admin}/package.json`)
const { createServer: viteB } = await import(pathToFileURL(reqB.resolve('vite')).href)
const { default: vue } = await import(pathToFileURL(reqB.resolve('@vitejs/plugin-vue')).href)
const bRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vicp-atlas-layout-b-')).replaceAll('\\', '/')
fs.symlinkSync(`${admin}/node_modules`, `${bRoot}/node_modules`, 'junction')
fs.writeFileSync(`${bRoot}/package.json`, '{"type":"module"}')
fs.writeFileSync(`${bRoot}/index.html`, '<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="app"></div><script type="module" src="/main.js"></script></html>')
fs.writeFileSync(`${bRoot}/main.js`, `import {createApp} from 'vue';import TDesign from 'tdesign-vue-next';import 'tdesign-vue-next/es/style/index.css';import App from './App.vue';createApp(App).use(TDesign).mount('#app')`)
fs.writeFileSync(`${bRoot}/App.vue`, `<script setup>import {ref,onMounted} from 'vue';import Content from '@/components/business/knowledge/KnowledgeStructuredContent.vue';const page=ref('53'),model=ref(),image=ref(false);async function load(){image.value=false;model.value=await fetch('/fixture?page='+page.value).then(r=>r.json())};onMounted(load)</script><template><main style="padding:20px"><p>原图人工核对 Fixture · 正式 B 端组件 · 非线上审核记录</p><select v-model="page" @change="load"><option v-for="n in [22,53,89,90,75]" :value="String(n)">原图 {{n}}</option></select><button @click="image=!image">切换原图 / 表格</button><h2>{{model?.pageTitle}}</h2><p>印刷页码 {{model?.pageLabel}}</p><img v-if="image" :src="'/original?page='+page" style="max-width:100%"><Content v-else-if="model" :model="model" :matches="[]" :has-original-image="true" @view-original="image=true" /></main></template>`)
const b = await viteB({ configFile: false, root: bRoot, plugins: [fixture(), vue()], resolve: { alias: { '@': `${admin}/src`, vue: reqB.resolve('vue/dist/vue.runtime.esm-bundler.js'), 'tdesign-vue-next': `${admin}/node_modules/tdesign-vue-next` }, dedupe: ['vue'] }, server: { host: '127.0.0.1', port: 5299, strictPort: true, fs: { allow: [bRoot, workspace] } } })
await b.listen()
const hRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vicp-atlas-layout-h5-')).replaceAll('\\', '/')
fs.mkdirSync(`${hRoot}/src/pages`, { recursive: true })
fs.symlinkSync(`${app}/node_modules`, `${hRoot}/node_modules`, 'junction')
for (const dir of ['api', 'components', 'composables', 'constants', 'router', 'services', 'store', 'styles', 'uni_modules', 'utils']) fs.symlinkSync(`${app}/src/${dir}`, `${hRoot}/src/${dir}`, 'junction')
fs.writeFileSync(`${hRoot}/package.json`, JSON.stringify({ type: 'module', dependencies: JSON.parse(fs.readFileSync(`${app}/package.json`, 'utf8')).dependencies }))
fs.writeFileSync(`${hRoot}/index.html`, '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="app"></div><script type="module" src="/src/main.ts"></script></html>')
fs.writeFileSync(`${hRoot}/src/main.ts`, `import {createSSRApp} from 'vue';import App from './App.vue';import '@/styles/index.scss';export function createApp(){return {app:createSSRApp(App)}}`)
fs.writeFileSync(`${hRoot}/src/App.vue`, '<script>export default {}</script>')
fs.writeFileSync(`${hRoot}/src/manifest.json`, JSON.stringify({ name: '图集表格 Fixture', appid: '__UNI__ATLAS_LAYOUT', versionName: '1.0.0', versionCode: '100', uniStatistics: { enable: false }, h5: { router: { mode: 'hash' } } }))
fs.writeFileSync(`${hRoot}/src/pages.json`, JSON.stringify({ pages: [{ path: 'pages/index', style: { navigationStyle: 'custom' } }] }))
fs.writeFileSync(`${hRoot}/src/pages/index.vue`, `<script setup>import {ref} from 'vue';import Table from '@/components/ai/ThermalPageTable.vue';const page=ref('53'),model=ref(),image=ref(false);function load(n){page.value=String(n);image.value=false;uni.request({url:'/fixture?page='+page.value,success:r=>model.value=r.data})};load(53)</script><template><view style="padding:12px"><view>人工核对 Fixture · 正式 UniApp 组件</view><view style="display:flex;gap:8px;margin:12px 0"><button v-for="n in [22,53,89,90,75]" size="mini" @click="load(n)">{{n}}</button></view><view>{{model?.pageTitle}}</view><view style="margin:8px 0">印刷页码 {{model?.pageLabel}}</view><button size="mini" @click="image=!image">切换原图 / 表格</button><image v-if="image" :src="'/original?page='+page" mode="widthFix" style="width:100%"/><Table v-else-if="model" :constructions="model.constructions" :matches="[]"/><view v-for="note in model?.notes" style="margin-top:8px;font-size:12px">{{note}}</view></view></template>`)
process.chdir(hRoot)
process.env.UNI_PLATFORM = 'h5'; process.env.VITE_ROOT_DIR = hRoot; process.env.UNI_INPUT_DIR = `${hRoot}/src`; process.env.UNI_OUTPUT_DIR = `${hRoot}/dist`
const reqH = createRequire(`${app}/package.json`)
const { createServer: viteH } = reqH('vite')
const Uni = reqH('@dcloudio/vite-plugin-uni').default
const h = await viteH({ configFile: false, root: hRoot, cacheDir: `${hRoot}/.cache`, plugins: [fixture(), Uni()], resolve: { alias: { '@': `${hRoot}/src` } }, server: { host: '127.0.0.1', port: 5298, strictPort: true, fs: { allow: [hRoot, app] } } })
await h.listen()
console.log('FIXTURE_PREVIEW B=http://127.0.0.1:5299 H5=http://127.0.0.1:5298')

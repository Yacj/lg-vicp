import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
export async function resolve(specifier, context, nextResolve) {
  const local = specifier.startsWith('@/')
    ? path.join(root, 'src', specifier.slice(2))
    : specifier.startsWith('.') && context.parentURL?.startsWith('file:') ? fileURLToPath(new URL(specifier, context.parentURL)) : null
  if (local) {
    for (const candidate of [local, `${local}.ts`, `${local}.vue`, path.join(local, 'index.ts')]) {
      if (existsSync(candidate) && statSync(candidate).isFile())
        return { url: pathToFileURL(candidate).href, shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}
export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || (!url.endsWith('.ts') && !url.endsWith('.vue')))
    return nextLoad(url, context)
  const filename = fileURLToPath(url)
  // Node SSR 测试不运行 uni-app 的平台编译和 uni API；第三方富文本以原有测试替身渲染。
  // 正式页面仍显式导入真实组件，实际 H5 渲染另在浏览器验收，不能由此替身证明。
  if (filename === path.join(root, 'src/uni_modules/mp-html/components/mp-html/mp-html.vue')) {
    return { format: 'module', shortCircuit: true, source: `import { h } from 'vue'; export default { props: ['content'], render() { return h('section', { innerHTML: this.content }); } };` }
  }
  let source = await readFile(filename, 'utf8')
  if (url.endsWith('.vue')) {
    const { descriptor } = parse(source, { filename })
    source = compileScript(descriptor, { id: filename, inlineTemplate: true, templateOptions: { compilerOptions: { isCustomElement: tag => ['view', 'text', 'image', 'scroll-view'].includes(tag) } } }).content
  }
  return { format: 'module', shortCircuit: true, source: ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText }
}

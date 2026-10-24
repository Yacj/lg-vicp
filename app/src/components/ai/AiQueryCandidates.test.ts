import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import { renderToString } from 'vue/server-renderer'
import * as solution from '../../utils/aiSolution'

for (const current of [true, false]) {
  test(`候选卡片明确区分本次命中和历史回看：${current}`, async () => {
    const source = readFileSync(new URL('./AiQueryCandidates.vue', import.meta.url), 'utf8')
    const { descriptor } = parse(source)
    const code = compileScript(descriptor, { id: 'candidate-presentation', inlineTemplate: true }).content
    const exports: Record<string, any> = {}
    runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
      exports,
      require: (name: string) => name === 'vue' ? vue : name === '@/utils/aiSolution' ? solution : {},
    })
    const result = { queryRevision: 2, matchesCurrentQuery: current,
      candidates: [{ candidateId: 'valid', position: 1, sourceType: 'REFERENCE', confirmationEligible: true, schemeName: '已发布做法', thicknessMm: 25 }] }
    const app = vue.createSSRApp(exports.default, { result, selectedIds: [], disabled: false, notice: '' })
    app.component('wd-button', { render() { return vue.h('button', this.$slots.default?.()) } })
    const html = await renderToString(app)
    assert.match(html, current ? /本次可选参考方案/ : /上次查询的参考方案/)
    assert.equal(html.includes('不符合最新筛选条件'), !current)
    assert.match(html, /已发布做法/)
    assert.match(html, /加入方案/)
    assert.equal(result.candidates[0]?.confirmationEligible, true)
  })
}

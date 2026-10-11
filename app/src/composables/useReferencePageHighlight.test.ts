import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, nextTick } from 'vue'
import { referenceFixture } from '../test/fixtures/referencePage'
import { useReferencePageHighlight } from './useReferencePageHighlight'
test('选择方案优先定位，同页多命中切换，取消/重新显示；切换原图不重复滚动', async () => {
  const fixture = referenceFixture()
  fixture.matches.push({ constructionId: 'A1-4', optionId: 'A1-4-25', fieldKeys: ['kValue'] })
  const calls: string[] = []
  const scope = effectScope()
  const state = scope.run(() => useReferencePageHighlight(() => ({ pageId: 'page', model: fixture.renderModel, matches: fixture.matches, preferred: fixture.matches[1] }), id => calls.push(id)))!
  await nextTick(); await nextTick()
  assert.equal(state.active.value?.optionId, 'A1-4-25')
  assert.deepEqual(calls, ['reference-construction-1-option-3'])
  state.navigate(1); await nextTick(); await nextTick()
  assert.equal(state.active.value?.optionId, 'A1-3-18')
  assert.equal(calls.length, 2)
  state.tab.value = '原始页面'; await nextTick()
  state.tab.value = '页面内容'; await nextTick(); await nextTick()
  assert.equal(calls.length, 2)
  state.toggle(); await nextTick(); assert.equal(state.active.value, undefined)
  state.toggle(); await nextTick(); await nextTick()
  assert.equal(state.matches.value.length, 2)
  assert.equal(calls.length, 3)
  scope.stop()
})

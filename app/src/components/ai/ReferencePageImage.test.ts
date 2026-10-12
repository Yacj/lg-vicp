import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { referencePageImageTitle } from '@/utils/referencePage'
import ReferencePageImage from './ReferencePageImage.vue'

async function render(status: 'loading' | 'ready' | 'error' | 'empty', refreshing = false) {
  const app = createSSRApp({ render: () => h(ReferencePageImage, {
    title: referencePageImageTitle('建筑外墙热工计算参考选用表（III型VICP预制混凝土夹心外墙板）'),
    source: '/tmp/original-page.png',
    status,
    refreshing,
  }) })
  app.component('wd-button', { render() {
    return h('button', this.$slots.default?.())
  } })
  app.component('wd-loading', { render() {
    return h('span', 'loading')
  } })
  app.component('wd-empty', { props: ['tip'], render() {
    return h('section', [this.$props.tip, this.$slots.bottom?.()])
  } })
  return renderToString(app)
}

test('正常参考页只有正式标题、完整图片和一个全屏按钮', async () => {
  const html = await render('ready')
  assert.ok(html.includes('III型VICP预制混凝土夹心外墙板（建筑外墙热工计算参考选用表）'))
  assert.ok(html.includes('src="/tmp/original-page.png"'))
  assert.ok(html.includes('mode="widthFix"'))
  assert.ok(html.includes('全屏查看'))
  assert.equal((html.match(/<button/g) || []).length, 1)
  assert.ok(!html.includes('来源：'))
  assert.ok(!html.includes('图集号：'))
  assert.ok(!html.includes('页面内容'))
})

test('加载中与续签显示进度，失败或缺图使用 Empty 和重试，不渲染空白图片', async () => {
  for (const html of [await render('loading'), await render('ready', true)]) {
    assert.ok(html.includes('正在加载图片'))
    assert.ok(!html.includes('<image'))
  }
  for (const [state, tip] of [['error', '图片加载失败'], ['empty', '暂无原页图片']] as const) {
    const html = await render(state)
    assert.ok(html.includes(tip))
    assert.ok(html.includes('重新加载图片'))
    assert.ok(!html.includes('<image'))
    assert.ok(!html.includes('全屏查看'))
  }
})

test('标题调整保留正式型号，不修改一般页标题', () => {
  assert.equal(referencePageImageTitle('建筑外墙热工计算参考选用表(II型VICP预制混凝土夹心外墙板)'), 'II型VICP预制混凝土夹心外墙板（建筑外墙热工计算参考选用表）')
  assert.equal(referencePageImageTitle(' 节点构造（续） '), '节点构造（续）')
})

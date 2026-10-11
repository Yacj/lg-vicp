import TDesign from 'tdesign-vue-next'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'
import RecognitionTextSection from './RecognitionTextSection.vue'

const apps: ReturnType<typeof createApp>[] = []
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = '' })
async function mount(readonly = false) {
  const props = reactive({ pageId: 'page-1', readonly, fullText: '<h2>页面标题</h2><p>原文段落</p><table><tr><td>18mm</td><td>2.880</td></tr></table>' })
  const element = document.createElement('div'); document.body.append(element)
  const app = createApp({ render: () => h(RecognitionTextSection, props) }); apps.push(app)
  app.use(TDesign).mount(element); await nextTick()
  return { element, props }
}
describe('识别校验中的页面内容', () => {
  it('默认 HTML 阅读，只有主动编辑才显示原文输入框，预览不改原数据', async () => {
    const { element, props } = await mount()
    const original = props.fullText
    expect(element.querySelector('textarea')).toBeNull()
    expect(element.querySelector('h2')?.textContent).toBe('页面标题')
    expect(element.querySelector('td')?.textContent).toBe('18mm')
    element.querySelector('button')!.click(); await nextTick()
    expect(element.querySelector('textarea')?.value).toBe(original)
    element.querySelector('button')!.click(); await nextTick()
    expect(element.querySelector('textarea')).toBeNull()
    expect(props.fullText).toBe(original)
  })
  it('只读时仍为可读正文，切页或权限收回退出编辑模式', async () => {
    const { element, props } = await mount()
    element.querySelector('button')!.click(); await nextTick()
    props.pageId = 'page-2'; await nextTick()
    expect(element.querySelector('textarea')).toBeNull()
    element.querySelector('button')!.click(); await nextTick()
    props.readonly = true; await nextTick()
    expect(element.querySelector('textarea')).toBeNull()
    expect(element.querySelector('button')).toBeNull()
    expect(element.querySelector('h2')?.textContent).toBe('页面标题')
  })
})

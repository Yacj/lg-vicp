import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from 'vue'
import AppMarkdown from './AppMarkdown.vue'

const mountedApps: Array<ReturnType<typeof createApp>> = []

function mount(props: Record<string, unknown>) {
  const container = document.createElement('div')
  document.body.append(container)
  const app = createApp(AppMarkdown, props)
  app.mount(container)
  mountedApps.push(app)
  return container
}

afterEach(() => {
  mountedApps.splice(0).forEach(app => app.unmount())
  document.body.innerHTML = ''
})

describe('AppMarkdown', () => {
  it('renders markdown headings and emphasis', () => {
    const container = mount({
      content: '## 保温系统\n\n外墙应使用 **岩棉板**。',
    })

    expect(container.querySelector('h2')?.textContent).toBe('保温系统')
    expect(container.querySelector('strong')?.textContent).toBe('岩棉板')
  })

  it('escapes embedded HTML before parsing markdown', () => {
    const container = mount({
      content: '<script>document.cookie</script>\n\n**安全**',
    })

    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('<script>document.cookie</script>')
    expect(container.querySelector('strong')?.textContent).toBe('安全')
  })

  it('accepts pre-rendered html for citation overlays', () => {
    const container = mount({
      html: '<p>答案 <span class="vicp-citation">[资料1]</span></p>',
    })

    expect(container.querySelector('.vicp-citation')?.textContent).toBe('[资料1]')
  })
})

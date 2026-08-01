import TDesign from 'tdesign-vue-next'
import { defineComponent, h, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

// jsdom 无 canvas，stub vue-echarts 作为浏览器能力替身。
// factory 直接使用 import 绑定（vitest 提升后仍可用），不引用模块体变量。
vi.mock('vue-echarts', () => ({
  default: defineComponent({
    props: {
      option: { type: Object, default: undefined },
      autoresize: { type: [Boolean, Object], default: true },
    },
    setup: (_props, { expose }) => {
      const root = ref<HTMLElement | null>(null)
      expose({ resize: vi.fn(), root })
      return () => h('div', { class: 'stub-chart', ref: root })
    },
  }),
}))

import AppChart from './AppChart.vue'

let app: ReturnType<typeof createApp> | null = null

function mountChart(props: Record<string, unknown> = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  app = createApp(AppChart, {
    option: null,
    height: 300,
    ...props,
  })
  app.use(TDesign)
  app.mount(container)
  return container
}

afterEach(() => {
  app?.unmount()
  app = null
  document.body.innerHTML = ''
})

describe('AppChart states', () => {
  it('renders empty state when option is null without loading', () => {
    const container = mountChart({ emptyText: '暂无趋势数据' })

    expect(container.textContent).toContain('暂无趋势数据')
    expect(container.querySelector('.stub-chart')).toBeNull()
  })

  it('renders error state when error is set', () => {
    const container = mountChart({
      error: true,
      errorTitle: '加载失败',
      option: null,
    })

    expect(container.textContent).toContain('加载失败')
    expect(container.querySelector('.app-error-state')).not.toBeNull()
  })

  it('renders skeleton loading while keeping the chart mounted', () => {
    const container = mountChart({ loading: true, option: {} })

    expect(container.querySelector('.app-chart__loading')).not.toBeNull()
    expect(container.querySelector('.stub-chart')).not.toBeNull()
  })

  it('keeps explicit container height', () => {
    const container = mountChart({ height: 240 })

    expect((container.querySelector('.app-chart') as HTMLElement).style.height).toBe('240px')
  })

  it('passes through a css variable height for responsive charts', () => {
    const container = mountChart({ height: 'var(--dashboard-chart-height, 300px)' })

    expect((container.querySelector('.app-chart') as HTMLElement).style.height)
      .toBe('var(--dashboard-chart-height, 300px)')
  })
})
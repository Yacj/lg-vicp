import { afterEach, vi } from 'vitest'
import { AxiosError } from 'axios'
import { httpClient } from '@/api/http/client'

// 浏览器能力替身（网络）：测试环境没有后端，jsdom 的 XHR 会向本机端口发起真实请求并长期
// 挂起，组件因此一直停留在加载态。这里在 API 客户端传输层安装“网络不可达”替身，让请求
// 立即以网络级错误失败（与浏览器离线行为一致），组件按既有 catch 分支落到诚实空状态。
// 该替身不返回任何业务数据；需要协议夹具的测试可覆写 httpClient.defaults.adapter 后复原。
httpClient.defaults.adapter = config =>
  Promise.reject(new AxiosError(
    `测试环境网络不可达（浏览器能力替身）: ${String(config.method ?? 'GET').toUpperCase()} ${config.url ?? ''}`,
    AxiosError.ERR_NETWORK,
    config,
  ))

// jsdom 未实现 scrollIntoView，TDesign 表单 scroll-to-first-error 依赖它
Object.defineProperty(Element.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
})

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  })),
})

const appearanceAttributes = [
  'data-theme',
  'data-layout',
  'data-sidebar-theme',
  'data-content-width',
  'data-density',
  'data-tabs-style',
  'data-radius',
  'data-primary-color',
  'data-fixed-header',
]

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  document.documentElement.className = ''
  document.documentElement.style.colorScheme = ''
  for (let index = 1; index <= 10; index += 1) {
    document.documentElement.style.removeProperty(`--td-brand-color-${index}`)
  }
  appearanceAttributes.forEach(attribute => document.documentElement.removeAttribute(attribute))
  vi.mocked(window.matchMedia).mockReset()
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    dispatchEvent: vi.fn(),
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  }))
})

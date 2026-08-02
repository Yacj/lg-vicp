import { afterEach, vi } from 'vitest'

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

import { afterEach, vi } from 'vitest'

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
  'data-system-theme-preset',
  'data-component-theme-preset',
  'data-sync-theme-colors',
  'data-fixed-header',
]

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  document.documentElement.className = ''
  document.documentElement.style.colorScheme = ''
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

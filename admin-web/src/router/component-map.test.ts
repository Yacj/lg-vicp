import { describe, expect, it } from 'vitest'
import {
  dynamicComponentOptions,
  getDynamicComponentPath,
  normalizeDynamicComponentKey,
  resolveDynamicComponent,
} from './component-map'

describe('dynamic component whitelist', () => {
  it('enumerates every current views page with a safe key and readable path', () => {
    expect(dynamicComponentOptions.map(option => option.value)).toEqual(expect.arrayContaining([
      'Home',
      'home/index',
      'system/dept/index',
      'system/dept/members',
      'system/dict/index',
      'system/dict/items',
    ]))
    expect(dynamicComponentOptions.find(option => option.value === 'system/dept/members')).toMatchObject({
      label: '@/views/system/dept/members.vue',
      path: '@/views/system/dept/members.vue',
      value: 'system/dept/members',
    })
  })

  it('normalizes known aliases and paths without expanding the whitelist', () => {
    expect(normalizeDynamicComponentKey('Home')).toBe('Home')
    expect(normalizeDynamicComponentKey('home/index.vue')).toBe('home/index')
    expect(normalizeDynamicComponentKey('@/views/system/dept/members.vue')).toBe('system/dept/members')
    expect(normalizeDynamicComponentKey('@src/views/system/dict/items.vue')).toBe('system/dict/items')
    expect(getDynamicComponentPath('system/dept/members')).toBe('@/views/system/dept/members.vue')
    expect(normalizeDynamicComponentKey('system/not-registered')).toBeNull()
    expect(normalizeDynamicComponentKey('../../views/system/dept/members.vue')).toBeNull()
    expect(normalizeDynamicComponentKey('https://example.com/page')).toBeNull()
  })

  it('resolves only registered loaders', () => {
    expect(resolveDynamicComponent('system/dept/members')).toBeTypeOf('function')
    expect(resolveDynamicComponent('system/not-registered')).toBeNull()
    expect(resolveDynamicComponent('__proto__')).toBeNull()
  })
})
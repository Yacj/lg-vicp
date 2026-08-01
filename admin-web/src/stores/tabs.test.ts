import type { AppTab } from './tabs'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTabsStore } from './tabs'

const home: AppTab = {
  affix: true,
  closable: false,
  fullPath: '/',
  keepAlive: true,
  name: 'Home',
  pinned: false,
  title: '工作台',
}

function tab(index: number): AppTab {
  return {
    affix: false,
    closable: true,
    fullPath: `/page-${index}`,
    keepAlive: index === 1,
    name: `Page${index}`,
    pinned: false,
    title: `页面 ${index}`,
  }
}

describe('tabs store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('opens tabs and derives KeepAlive names', () => {
    const store = useTabsStore()
    store.open(home)
    store.open(tab(1))
    store.open(tab(2))

    expect(store.tabs).toHaveLength(3)
    expect(store.cachedRouteNames).toEqual(['Home', 'Page1'])
  })

  it('never closes the fixed home tab', () => {
    const store = useTabsStore()
    store.open(home)
    expect(store.close('/')).toBe('/')
    expect(store.tabs).toEqual([home])
  })

  it('returns the adjacent route after closing the active tab', () => {
    const store = useTabsStore()
    store.open(home)
    store.open(tab(1))
    store.open(tab(2))

    expect(store.close('/page-2')).toBe('/page-1')
    expect(store.activePath).toBe('/page-1')
    expect(store.tabs.map(item => item.fullPath)).toEqual(['/', '/page-1'])
  })

  it('supports closing left, right and other tabs by target path', () => {
    const store = useTabsStore()
    store.open(home)
    store.open(tab(1))
    store.open(tab(2))
    store.open(tab(3))

    expect(store.closeLeft('/page-2')).toBe('/page-2')
    expect(store.tabs.map(item => item.fullPath)).toEqual(['/', '/page-2', '/page-3'])

    expect(store.closeRight('/page-2')).toBe('/page-2')
    expect(store.tabs.map(item => item.fullPath)).toEqual(['/', '/page-2'])

    store.open(tab(3))
    expect(store.closeOthers('/page-3')).toBe('/page-3')
    expect(store.tabs.map(item => item.fullPath)).toEqual(['/', '/page-3'])
  })

  it('protects pinned tabs and supports pinning, moving and refreshing', () => {
    const store = useTabsStore()
    store.open(home)
    store.open(tab(1))
    store.open(tab(2))

    store.pin('/page-1')
    expect(store.tabs.find(item => item.fullPath === '/page-1')).toMatchObject({
      closable: false,
      pinned: true,
    })
    expect(store.close('/page-1')).toBe('/page-2')

    store.move('/page-2', 1)
    expect(store.tabs.map(item => item.fullPath)).toEqual(['/', '/page-2', '/page-1'])

    const version = store.refresh('/page-2')
    expect(version).toBe(1)
    expect(store.refreshingPath).toBe('/page-2')
    store.completeRefresh('/page-2')
    expect(store.refreshingPath).toBeNull()
  })

  it('closes all closable tabs while retaining fixed tabs', () => {
    const store = useTabsStore()
    store.open(home)
    store.open(tab(1))
    store.open(tab(2))

    expect(store.closeAll()).toBe('/')
    expect(store.tabs.map(item => item.fullPath)).toEqual(['/'])
  })
})

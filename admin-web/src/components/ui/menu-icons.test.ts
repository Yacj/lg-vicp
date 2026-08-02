import { AppIcon as TDesignAppIcon } from 'tdesign-icons-vue-next'
import { manifest } from 'tdesign-icons-vue-next'
import { describe, expect, it } from 'vitest'
import {
  canonicalizeMenuIcon,
  filterMenuIcons,
  MENU_ICON_OPTIONS,
  isKnownMenuIcon,
  resolveMenuIcon,
  resolveMenuIconValue,
  searchMenuIcons,
} from './menu-icons'

describe('menu icon registry', () => {
  it('exposes the manifest icons and local registry as safe options', () => {
    expect(MENU_ICON_OPTIONS.map(option => option.value)).toContain('tdesign:system-setting')
    expect(MENU_ICON_OPTIONS.map(option => option.value)).toContain('local:analytics')
    expect(MENU_ICON_OPTIONS.map(option => option.value)).toContain('local:knowledge')
    expect(MENU_ICON_OPTIONS.filter(option => option.kind === 'tdesign')).toHaveLength(manifest.length)
    expect(MENU_ICON_OPTIONS.every(option => option.kind === 'local' || option.component)).toBe(true)
  })

  it('filters safe options by their registry source', () => {
    expect(filterMenuIcons(MENU_ICON_OPTIONS, 'all')).toBe(MENU_ICON_OPTIONS)
    expect(filterMenuIcons(MENU_ICON_OPTIONS, 'tdesign').every(option => option.kind === 'tdesign')).toBe(true)
    expect(filterMenuIcons(MENU_ICON_OPTIONS, 'local').every(option => option.kind === 'local')).toBe(true)
    expect(filterMenuIcons(MENU_ICON_OPTIONS, 'local').map(option => option.value)).toContain('local:analytics')
  })

  it('keeps legacy values and resolves unknown values safely', () => {
    expect(isKnownMenuIcon('SETTINGS')).toBe(true)
    expect(canonicalizeMenuIcon('SETTINGS')).toBe('tdesign:system-setting')
    expect(resolveMenuIconValue('home').kind).toBe('tdesign')
    expect(resolveMenuIcon('home')).not.toBe(TDesignAppIcon)
    expect(isKnownMenuIcon('remote-icon')).toBe(false)
    expect(resolveMenuIcon('remote-icon')).toBe(TDesignAppIcon)
    expect(resolveMenuIconValue('local:analytics').kind).toBe('local')
    expect(resolveMenuIconValue('local:analytics').source).toBeTruthy()
    expect(resolveMenuIconValue('local:not-registered').kind).toBe('fallback')
  })

  it('searches the manifest stem and translated label index', () => {
    expect(searchMenuIcons('系统').map(option => option.value)).toContain('tdesign:system-setting')
    expect(searchMenuIcons('分析').map(option => option.value)).toContain('local:analytics')
    expect(searchMenuIcons('ability-open').map(option => option.value)).toContain('tdesign:ability-open')
    expect(searchMenuIcons('does-not-exist')).toEqual([])
  })
})

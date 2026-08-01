import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const layoutSource = fs.readFileSync(path.resolve(__dirname, 'AdminLayout.vue'), 'utf8')
const layoutStyles = fs.readFileSync(path.resolve(__dirname, '../styles/layout.css'), 'utf8')
const sidebarSource = fs.readFileSync(path.resolve(__dirname, '../components/ui/AppSidebar.vue'), 'utf8')
const headerSource = fs.readFileSync(path.resolve(__dirname, '../components/ui/AppHeader.vue'), 'utf8')

describe('admin layout workbench outlet', () => {
  it.each([
    ['side', 'admin-layout--side'],
    ['top', 'admin-layout--top'],
    ['mixed', 'admin-layout--mixed'],
    ['dual', 'admin-layout--dual'],
    ['mobile', 'admin-layout--mobile'],
  ])('keeps the %s layout as an independent DOM branch', (_layout, className) => {
    expect(layoutSource).toContain(className)
  })

  it('keeps desktop and mobile navigation entries available', () => {
    expect(layoutSource).toContain('AppMobileNavigation')
    expect(layoutSource).toContain('navigation.fullMenus.value')
    expect(layoutSource).toContain('has-context-menu')
  })

  it('keeps the dual workspace rows explicit and avoids repeating the module title when tabs are enabled', () => {
    expect(layoutSource).toContain('v-if="!settingsStore.settings.showTabs"')
    expect(layoutStyles).toContain('grid-template-areas:\n    \'header\'\n    \'tabs\'\n    \'content\';')
    expect(layoutStyles).toContain('.admin-layout--dual .admin-layout__workspace > .admin-layout__header')
    expect(layoutStyles).toContain('.admin-layout--dual .admin-layout__workspace > .admin-layout__tabs')
    expect(layoutStyles).toContain('.admin-layout--dual .admin-layout__workspace > .admin-layout__content')
  })
  it('keeps the desktop shell and its scrolling regions bounded', () => {
    expect(layoutStyles).toContain('height: 100dvh')
    expect(layoutStyles).toContain('overflow: hidden')
    expect(layoutStyles).toContain('.admin-layout__content {')
    expect(layoutStyles).toContain('overflow: auto')
    expect(sidebarSource).toContain('overflow-y: auto')
    expect(sidebarSource).toContain('min-height: 0')
    expect(headerSource).toContain('\'is-fixed\'')
    expect(layoutStyles).toContain('data-fixed-header=\'false\'')
  })
})

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const layoutSource = fs.readFileSync(path.resolve(__dirname, 'AdminLayout.vue'), 'utf8')
const layoutStyles = fs.readFileSync(path.resolve(__dirname, '../styles/layout.css'), 'utf8')
const sidebarSource = fs.readFileSync(path.resolve(__dirname, '../components/ui/AppSidebar.vue'), 'utf8')
const headerSource = fs.readFileSync(path.resolve(__dirname, '../components/ui/AppHeader.vue'), 'utf8')
// 行尾统一为 LF，避免 Windows CRLF 差异导致断言失败
const normalizedStyles = layoutStyles.replace(/\r\n/g, '\n')

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

  it('keeps the dual workspace rows explicit without a dedicated breadcrumb row', () => {
    expect(layoutSource).toContain('AppBreadcrumb')
    expect(normalizedStyles).toContain('grid-template-areas:\n    \'header\'\n    \'tabs\'\n    \'content\';')
    expect(normalizedStyles).toContain('.admin-layout--dual .admin-layout__workspace > .admin-layout__header')
    expect(normalizedStyles).not.toContain('.admin-layout--dual .admin-layout__workspace > .admin-layout__breadcrumb-bar')
    expect(normalizedStyles).toContain('.admin-layout--dual .admin-layout__workspace > .admin-layout__tabs')
    expect(normalizedStyles).toContain('.admin-layout--dual .admin-layout__workspace > .admin-layout__content')
  })

  it('renders side/dual breadcrumbs inside the header and top/mixed on a dedicated bar', () => {
    expect(layoutSource.match(/:items="navigation\.breadcrumbItems\.value"/g)).toHaveLength(4)
    expect(layoutSource.match(/#breadcrumb/g)).toHaveLength(3)
    expect(layoutSource.match(/admin-layout__breadcrumb-bar/g)).toHaveLength(2)
    expect(layoutSource).toContain('admin-layout__mobile-title')
    expect(layoutSource).not.toContain('admin-layout__module-title')
    // side/dual 的面包屑位于 Header 折叠按钮之后的插槽，独立行样式只服务 top/mixed
    expect(headerSource).toContain('app-header__start :deep(.t-breadcrumb)')
    expect(normalizedStyles).toContain('.admin-layout--mixed .admin-layout__workspace > .admin-layout__breadcrumb-bar')
    expect(normalizedStyles).toContain('.admin-layout--top > .admin-layout__breadcrumb-bar')
  })
  it('keeps the desktop shell and its scrolling regions bounded', () => {
    expect(normalizedStyles).toContain('height: 100dvh')
    expect(normalizedStyles).toContain('overflow: hidden')
    expect(normalizedStyles).toContain('.admin-layout__content {')
    expect(normalizedStyles).toContain('overflow: auto')
    expect(sidebarSource).toContain('overflow-y: auto')
    expect(sidebarSource).toContain('min-height: 0')
    expect(headerSource).toContain('\'is-fixed\'')
    expect(normalizedStyles).toContain('data-fixed-header=\'false\'')
  })
})

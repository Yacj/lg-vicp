import { describe, expect, it } from 'vitest'
import type { SystemMenu } from '@/types/system-management'
import {
  buildMenuTree,
  collectMenuSubtreeIdsFromFlat,
  filterMenuTree,
  normalizeMenuForm,
  toMenuTreeOptions,
  validateMenuConfiguration,
  validateMenuForm,
  type SystemMenuForm,
} from './system-menu'

function menu(overrides: Partial<SystemMenu> = {}): SystemMenu {
  return {
    component: null,
    createdAt: '',
    enabled: true,
    icon: null,
    id: 'menu-1',
    isExternal: false,
    menuType: 'MENU',
    name: '菜单',
    parentId: null,
    permissionCode: null,
    routePath: '/menu-1',
    sortOrder: 0,
    updatedAt: '',
    visible: true,
    ...overrides,
  }
}

function form(overrides: Partial<SystemMenuForm> = {}): SystemMenuForm {
  return {
    component: 'home/index',
    enabled: true,
    icon: 'home',
    isExternal: false,
    menuType: 'MENU',
    name: '菜单',
    parentId: undefined,
    permissionCode: '',
    routePath: '/menu',
    sortOrder: 0,
    visible: true,
    ...overrides,
  }
}

describe('system menu utilities', () => {
  it('builds a stable tree and promotes orphan nodes without losing them', () => {
    const tree = buildMenuTree([
      menu({ id: 'child-b', name: 'B', parentId: 'root', sortOrder: 2 }),
      menu({ id: 'orphan', name: '孤儿', parentId: 'missing', sortOrder: 3 }),
      menu({ id: 'root', menuType: 'DIRECTORY', name: '根', routePath: null, sortOrder: 1 }),
      menu({ id: 'child-a', name: 'A', parentId: 'root', sortOrder: 2 }),
    ])

    expect(tree.map(node => node.id)).toEqual(['root', 'orphan'])
    expect(tree[0]?.children.map(node => node.id)).toEqual(['child-a', 'child-b'])
  })

  it('terminates on parent cycles and keeps cycle members visible for correction', () => {
    const tree = buildMenuTree([
      menu({ id: 'a', name: 'A', parentId: 'b' }),
      menu({ id: 'b', name: 'B', parentId: 'a' }),
    ])

    expect(tree.length).toBeGreaterThan(0)
    expect(tree.flatMap(node => [node, ...node.children]).map(node => node.id)).toEqual(['a', 'b'])
  })

  it('keeps matching descendants together with their ancestor chain', () => {
    const tree = buildMenuTree([
      menu({ id: 'root', menuType: 'DIRECTORY', name: '系统', routePath: null }),
      menu({ id: 'child', name: '菜单管理', parentId: 'root', routePath: '/system/menu' }),
      menu({ id: 'other', name: '字典', parentId: 'root', routePath: '/system/dict' }),
    ])

    const filtered = filterMenuTree(tree, '菜单')
    expect(filtered.map(node => node.id)).toEqual(['root'])
    expect(filtered[0]?.children.map(node => node.id)).toEqual(['child'])
  })

  it('excludes the edited subtree and buttons from parent choices', () => {
    const items = [
      menu({ id: 'root', menuType: 'DIRECTORY', name: '根', routePath: null }),
      menu({ id: 'child', parentId: 'root', name: '子级' }),
      menu({ id: 'grandchild', parentId: 'child', name: '孙级' }),
      menu({ id: 'button', menuType: 'BUTTON', parentId: 'root', name: '按钮', routePath: null, component: null, icon: null, permissionCode: 'menu:button' }),
    ]
    const tree = buildMenuTree(items)
    const options = toMenuTreeOptions(tree, collectMenuSubtreeIdsFromFlat(items, 'child'))

    expect(options.map(option => option.value)).toEqual(['root'])
    expect(options[0]?.children ?? []).toEqual([])
  })

  it('normalizes fields according to the menu type', () => {
    expect(normalizeMenuForm(form())).toMatchObject({
      icon: 'tdesign:home',
    })
    expect(normalizeMenuForm(form({ menuType: 'BUTTON', component: 'home/index', icon: 'home', isExternal: true, routePath: '/ignored' }))).toMatchObject({
      component: null,
      icon: null,
      isExternal: false,
      menuType: 'BUTTON',
      routePath: null,
    })
    expect(normalizeMenuForm(form({ menuType: 'DIRECTORY', component: 'home/index', isExternal: true }))).toMatchObject({
      component: null,
      isExternal: false,
      menuType: 'DIRECTORY',
    })
    expect(normalizeMenuForm(form({ isExternal: true, routePath: 'https://example.com' }))).toMatchObject({
      component: null,
      isExternal: true,
      routePath: 'https://example.com',
    })
  })

  it('reports invalid permissions, components, paths and external URLs', () => {
    const issues = validateMenuConfiguration([
      menu({ component: 'unknown/component', id: 'unknown', permissionCode: 'missing permission' }),
      menu({ component: 'toString', id: 'inherited-component', name: '继承属性', routePath: '/inherited-component' }),
      menu({ id: 'external', isExternal: true, name: '外链', routePath: 'ftp://example.com' }),
      menu({ id: 'button', menuType: 'BUTTON', name: '根按钮', icon: 'home', permissionCode: 'button:root', routePath: null }),
    ])

    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'UNKNOWN_COMPONENT',
      'INVALID_PERMISSION',
      'INVALID_EXTERNAL_URL',
      'BUTTON_ROOT',
      'INVALID_TYPE_FIELDS',
    ]))
    expect(validateMenuConfiguration([
      menu({ id: 'known-permission', permissionCode: 'system:dept:list' }),
    ])).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_PERMISSION' }),
    ]))
  })

  it('normalizes known component paths to safe whitelist keys', () => {
    expect(normalizeMenuForm(form({ component: '@/views/system/dept/members.vue' })).component).toBe('system/dept/members')
    expect(normalizeMenuForm(form({ component: '@src/views/system/dict/items.vue' })).component).toBe('system/dict/items')
    expect(normalizeMenuForm(form({ component: 'src/views/home/index.vue' })).component).toBe('home/index')
    expect(normalizeMenuForm(form({ component: '../../views/system/dept/members.vue' })).component).toBe('../../views/system/dept/members.vue')
  })

  it('validates manually entered permission codes without resource lookup', () => {
    expect(validateMenuForm(form({ permissionCode: 'system:dept:list' }), [], null)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_PERMISSION' }),
    ]))
    expect(validateMenuForm(form({ permissionCode: 'bad permission' }), [], null)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_PERMISSION' }),
    ]))
    expect(validateMenuForm(form({ menuType: 'BUTTON', component: '', permissionCode: '' }), [], null)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INVALID_PERMISSION' }),
    ]))
  })

  it('rejects unknown manually entered component keys', () => {
    const issues = validateMenuForm(form({ component: 'system/not-registered' }), [], null)

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'UNKNOWN_COMPONENT' }),
    ]))
  })

  it('rejects protocol-relative internal paths', () => {
    const issues = validateMenuConfiguration([
      menu({ routePath: '//cdn.example.com/app', component: 'home/index' }),
    ])

    expect(issues.map(issue => issue.code)).toContain('INVALID_PATH')
  })
})
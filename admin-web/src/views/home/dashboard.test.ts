import type { SidebarMenuItem } from '@/types/menu'
import { describe, expect, it } from 'vitest'
import {
  collectMenuLeaves,
  formatToday,
  getGreeting,
  limitShortcuts,
  projectAvailableShortcuts,
  resolveFirstNavigable,
} from './dashboard'

function menu(overrides: Partial<SidebarMenuItem>): SidebarMenuItem {
  return {
    children: [],
    icon: null,
    id: 'menu-id',
    path: '/menu',
    title: '菜单',
    type: 'MENU',
    ...overrides,
  }
}

describe('dashboard shortcut projection', () => {
  const menus = [
    menu({
      children: [
        menu({ id: 'project-list', path: '/projects', title: '项目列表' }),
        menu({ id: 'denied', path: '/denied', title: '无权页面' }),
      ],
      id: 'project-directory',
      path: '/project-directory',
      title: '项目目录',
      type: 'DIRECTORY',
    }),
    menu({ id: 'home', path: '/', title: '工作台' }),
    menu({ id: 'missing-path', path: null, title: '无路径菜单' }),
  ]

  it('collects leaves without treating directories as shortcuts', () => {
    expect(collectMenuLeaves(menus).map(item => item.id)).toEqual([
      'project-list',
      'denied',
      'home',
      'missing-path',
    ])
  })

  it('keeps only real navigable menu leaves from the permission-trimmed source', () => {
    const shortcuts = projectAvailableShortcuts(menus, path => path === '/projects')

    expect(shortcuts).toEqual([{
      id: 'project-list',
      title: '项目列表',
      description: '进入已授权功能',
      path: '/projects',
      enabled: true,
    }])
  })

  it('limits shortcuts without inventing unavailable capabilities', () => {
    const shortcuts = projectAvailableShortcuts(menus, path => path === '/projects')
    const limited = limitShortcuts(shortcuts)

    expect(limited).toHaveLength(1)
    expect(limited[0]).toMatchObject({ enabled: true, path: '/projects' })
  })

  it('never fabricates routes for missing paths', () => {
    const shortcuts = projectAvailableShortcuts([menu({ id: 'no-path', path: null, title: '无路径' })], () => true)

    expect(shortcuts).toEqual([])
  })

  it('picks the first real navigable route among metric candidates', () => {
    expect(resolveFirstNavigable(['/projects/my', '/projects'], path => path === '/projects')).toBe('/projects')
    expect(resolveFirstNavigable(['/projects/my', '/projects'], () => false)).toBeNull()
  })
})

describe('dashboard welcome text', () => {
  it('derives greeting from hour', () => {
    expect(getGreeting(8)).toBe('上午好')
    expect(getGreeting(12)).toBe('下午好')
    expect(getGreeting(17)).toBe('下午好')
    expect(getGreeting(19)).toBe('晚上好')
    expect(getGreeting(23)).toBe('晚上好')
  })

  it('formats today with weekday', () => {
    const date = new Date(2026, 2, 14)
    expect(formatToday(date)).toContain('2026年3月14日')
  })
})
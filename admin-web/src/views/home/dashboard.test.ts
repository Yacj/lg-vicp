import type { SidebarMenuItem } from '@/types/menu'
import { describe, expect, it } from 'vitest'
import {
  collectMenuLeaves,
  formatToday,
  getGreeting,
  limitShortcuts,
  pickRecentReports,
  projectAvailableShortcuts,
  projectTodoCards,
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
      target: { kind: 'internal', path: '/projects' },
      enabled: true,
    }])
  })

  it('includes safe external targets in dashboard shortcuts', () => {
    const shortcuts = projectAvailableShortcuts([
      menu({
        id: 'docs',
        path: null,
        target: { href: 'https://docs.example.com', kind: 'external' },
        title: '外部文档',
      }),
    ], () => false)

    expect(shortcuts).toEqual([{
      description: '在新窗口打开外部资源',
      enabled: true,
      id: 'docs',
      path: null,
      target: { href: 'https://docs.example.com', kind: 'external' },
      title: '外部文档',
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

describe('dashboard todo projection', () => {
  const categories = [
    { id: 'knowledge', label: '知识资料', description: '需要处理的资料', paths: ['/knowledge/documents'], count: 4 },
    { id: 'product', label: '产品数据', description: '产品与材料数据', paths: ['/products/series', '/masterdata/materials'], count: null },
    { id: 'review', label: '统一审核', description: '审核决议', paths: ['/review-center/queue'], count: 0 },
    { id: 'denied', label: '无权入口', description: '未投影路由', paths: ['/denied'] },
  ]

  it('keeps only categories with a navigable route and normalizes counts', () => {
    const cards = projectTodoCards(categories, path => path !== '/denied')

    expect(cards.map(card => card.id)).toEqual(['knowledge', 'product', 'review'])
    expect(cards.find(card => card.id === 'knowledge')).toMatchObject({
      count: 4,
      path: '/knowledge/documents',
      target: { kind: 'internal', path: '/knowledge/documents' },
    })
    // null 计数归一为 null，0 计数保留（表达"暂无待处理"）
    expect(cards.find(card => card.id === 'product')?.count).toBeNull()
    expect(cards.find(card => card.id === 'review')?.count).toBe(0)
  })

  it('picks the first navigable candidate path per category', () => {
    const cards = projectTodoCards(categories, path => path === '/masterdata/materials')

    expect(cards.map(card => card.id)).toEqual(['product'])
    expect(cards[0]?.path).toBe('/masterdata/materials')
  })
})

describe('recent report aggregation', () => {
  const rows = [
    { id: 'a', reportType: 'TEMPLATE', status: 'READY', publishedAt: null, updatedAt: '2026-09-01T10:00:00Z', conversationTitle: '会话 A', projectName: '项目一' },
    { id: 'b', reportType: 'SUMMARY', status: 'DRAFT', publishedAt: null, updatedAt: '2026-09-03T10:00:00Z', conversationTitle: null, projectName: '项目二' },
    { id: 'c', reportType: 'TEMPLATE', status: 'READY', publishedAt: null, updatedAt: '2026-09-02T10:00:00Z', conversationTitle: '会话 C', projectName: '项目一' },
  ]

  it('sorts by updatedAt descending and honors the limit', () => {
    expect(pickRecentReports(rows, 2).map(row => row.id)).toEqual(['b', 'c'])
  })

  it('returns a new array without mutating the source order', () => {
    const source = [...rows]
    pickRecentReports(rows)
    expect(rows).toEqual(source)
  })
})

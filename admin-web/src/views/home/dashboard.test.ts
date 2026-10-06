import { describe, expect, it } from 'vitest'
import {
  formatToday,
  getGreeting,
  pickRecentReports,
  projectAttentionItems,
  projectMetricCards,
  projectQuickActions,
  QUICK_ACTION_DEFINITIONS,
  resolveFirstNavigable,
} from './dashboard'
import type { DashboardAttentionInput, DashboardMetricInput } from './dashboard'

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

describe('dashboard route resolution', () => {
  it('picks the first real navigable route among candidates', () => {
    expect(resolveFirstNavigable(['/projects/my', '/projects'], path => path === '/projects')).toBe('/projects')
    expect(resolveFirstNavigable(['/projects/my', '/projects'], () => false)).toBeNull()
  })
})

describe('dashboard metric card projection', () => {
  const inputs: DashboardMetricInput[] = [
    { id: 'projects', label: '项目总数', paths: ['/projects'], count: 12, secondaryText: '公开 4 · 私有 8' },
    { id: 'knowledge', label: '待处理知识文档', paths: ['/knowledge/documents'], count: 3, activeStatus: 'warning' },
    { id: 'parsing', label: '解析失败任务', paths: ['/knowledge/parsing-jobs'], count: 0, activeStatus: 'error' },
    { id: 'review', label: '待审核事项', paths: ['/review-center/queue'], count: null, activeStatus: 'warning' },
    { id: 'denied', label: '无权指标', paths: ['/denied'], count: 9 },
  ]

  it('hides cards whose routes are all unreachable', () => {
    const cards = projectMetricCards(inputs, path => path !== '/denied')

    expect(cards.map(card => card.id)).toEqual(['projects', 'knowledge', 'parsing', 'review'])
  })

  it('applies active status only when count is greater than zero', () => {
    const cards = projectMetricCards(inputs, () => true)

    expect(cards.find(card => card.id === 'knowledge')).toMatchObject({ status: 'warning', value: 3 })
    expect(cards.find(card => card.id === 'parsing')).toMatchObject({ status: 'default', value: 0 })
    expect(cards.find(card => card.id === 'review')).toMatchObject({ status: 'default', value: null })
    expect(cards.find(card => card.id === 'projects')).toMatchObject({
      status: 'default',
      secondaryText: '公开 4 · 私有 8',
      path: '/projects',
    })
  })

  it('keeps null counts as unloaded placeholders instead of fabricating zero', () => {
    const cards = projectMetricCards(inputs, () => true)

    expect(cards.find(card => card.id === 'review')?.value).toBeNull()
  })
})

describe('dashboard attention projection', () => {
  const inputs: DashboardAttentionInput[] = [
    {
      id: 'parsing',
      title: '知识解析失败',
      description: '解析任务失败',
      priority: 'medium',
      paths: ['/knowledge/parsing-jobs'],
      count: 5,
    },
    {
      id: 'review',
      title: '统一审核待办',
      description: '审核决议',
      priority: 'high',
      paths: ['/review-center/queue'],
      count: 2,
    },
    {
      id: 'knowledge',
      title: '知识库资料待处理',
      description: '需要处理的文档',
      priority: 'high',
      paths: ['/knowledge/documents'],
      count: 7,
    },
    {
      id: 'empty',
      title: '暂无待处理',
      description: '计数为零',
      priority: 'low',
      paths: ['/reports'],
      count: 0,
    },
    {
      id: 'unloaded',
      title: '计数缺失',
      description: '接口未返回',
      priority: 'high',
      paths: ['/reports'],
      count: null,
    },
    {
      id: 'denied',
      title: '无权事项',
      description: '路由不可达',
      priority: 'high',
      paths: ['/denied'],
      count: 4,
    },
  ]

  it('keeps only items with a real positive count and a navigable route', () => {
    const items = projectAttentionItems(inputs, path => path !== '/denied')

    expect(items.map(item => item.id)).toEqual(['knowledge', 'review', 'parsing'])
  })

  it('sorts by priority first, then by count descending', () => {
    const items = projectAttentionItems(inputs, path => path !== '/denied')

    expect(items.map(item => item.id)).toEqual(['knowledge', 'review', 'parsing'])
    expect(items[0]).toMatchObject({ priority: 'high', count: 7, route: '/knowledge/documents' })
  })

  it('returns an empty list when nothing needs action', () => {
    const items = projectAttentionItems([
      { id: 'a', title: 'A', description: '', priority: 'high', paths: ['/reports'], count: 0 },
      { id: 'b', title: 'B', description: '', priority: 'low', paths: ['/reports'], count: null },
    ], () => true)

    expect(items).toEqual([])
  })
})

describe('dashboard quick action projection', () => {
  it('keeps only actions permitted by permission codes and navigable routes', () => {
    const actions = projectQuickActions(
      QUICK_ACTION_DEFINITIONS,
      permissions => permissions.includes('project.view'),
      () => true,
    )

    expect(actions.map(action => action.id)).toEqual(['project-view'])
  })

  it('drops actions whose route is not registered', () => {
    const actions = projectQuickActions(
      QUICK_ACTION_DEFINITIONS,
      () => true,
      path => path !== '/system/user',
    )

    expect(actions.some(action => action.id === 'system-user')).toBe(false)
    expect(actions.length).toBe(QUICK_ACTION_DEFINITIONS.length - 1)
  })

  it('never fabricates entries when nothing is permitted', () => {
    expect(projectQuickActions(QUICK_ACTION_DEFINITIONS, () => false, () => true)).toEqual([])
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

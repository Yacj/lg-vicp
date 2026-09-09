import { describe, expect, it } from 'vitest'
import type { ProjectItem } from '@/types/project'
import {
  isProjectManager,
  normalizeVisibilityFilter,
  projectDetailTabs,
  projectStatusMeta,
  projectTaskEntries,
  projectVisibilityMeta,
} from './project'

function makeProject(overrides: Partial<ProjectItem> = {}): ProjectItem {
  return {
    id: 'project-1',
    name: '某商业楼节能改造',
    description: null,
    region: null,
    buildingType: null,
    visibility: 'PRIVATE',
    visibilityPolicy: 'LOGGED_IN_USERS',
    status: 'active',
    metadata: null,
    createdById: 'user-1',
    deletedAt: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  }
}

describe('project detail tab projection', () => {
  it('includes audit tab only when the platform audit permission is granted', () => {
    const withoutAudit = projectDetailTabs(false)
    const withAudit = projectDetailTabs(true)

    expect(withoutAudit.map((tab) => tab.key)).toEqual(['overview', 'conversations'])
    expect(withAudit.map((tab) => tab.key)).toEqual(['overview', 'conversations', 'audit'])
  })
})

describe('project task entry projection', () => {
  it('projects the seven task entries in workspace order', () => {
    const entries = projectTaskEntries(makeProject({ region: '上海市' }))

    expect(entries.map((entry) => entry.label)).toEqual([
      '基本信息',
      '项目条件',
      '智能计算',
      '方案选择',
      '材料对比',
      '节点方案',
      '报告',
    ])
  })

  it('prefills candidate conditions with the project region', () => {
    const entries = projectTaskEntries(makeProject({ id: 'p1', region: '上海市浦东新区' }))
    const conditions = entries.find((entry) => entry.key === 'conditions')

    expect(conditions?.route).toBe('/thermal/candidates?regionCode=%E4%B8%8A%E6%B5%B7%E5%B8%82%E6%B5%A6%E4%B8%9C%E6%96%B0%E5%8C%BA')
    expect(conditions?.permissions).toEqual(['system:thermal:list'])
  })

  it('keeps the conditions entry navigable without a region', () => {
    const entries = projectTaskEntries(makeProject({ region: null }))
    const conditions = entries.find((entry) => entry.key === 'conditions')

    expect(conditions?.route).toBe('/thermal/candidates')
  })

  it('scopes scheme history and reports to the project id', () => {
    const entries = projectTaskEntries(makeProject({ id: 'p/1' }))

    expect(entries.find((entry) => entry.key === 'schemes')?.route).toBe('/thermal/calc-records?projectId=p%2F1')
    expect(entries.find((entry) => entry.key === 'reports')?.route).toBe('/reports?projectId=p%2F1')
  })

  it('keeps the overview entry as an in-page tab without a route', () => {
    const entries = projectTaskEntries(makeProject())
    const overview = entries.find((entry) => entry.key === 'overview')

    expect(overview?.route).toBeNull()
    expect(overview?.tabKey).toBe('overview')
    expect(overview?.permissions).toEqual([])
  })
})

describe('project manager rule', () => {
  it('grants management to the creator', () => {
    expect(isProjectManager(makeProject({ createdById: 'user-1' }), 'user-1', false)).toBe(true)
  })

  it('grants management to super admin regardless of ownership', () => {
    expect(isProjectManager(makeProject({ createdById: 'user-1' }), 'user-2', true)).toBe(true)
  })

  it('denies management to other regular users', () => {
    expect(isProjectManager(makeProject({ createdById: 'user-1' }), 'user-2', false)).toBe(false)
  })

  it('does not grant management from a stale server flag', () => {
    expect(isProjectManager(makeProject({ canManage: true, createdById: 'owner-1' }), 'member-1', false)).toBe(false)
  })

  it('denies management when no current user is known', () => {
    expect(isProjectManager(makeProject({ createdById: 'user-1' }), null, false)).toBe(false)
  })
})

describe('project label projection', () => {
  it('maps visibility to public/private labels', () => {
    expect(projectVisibilityMeta('PUBLIC')).toEqual({ label: '公开', status: 'success' })
    expect(projectVisibilityMeta('PRIVATE')).toEqual({ label: '私有', status: 'default' })
  })

  it('maps status to active/deleted labels', () => {
    expect(projectStatusMeta('active')).toEqual({ label: '正常', status: 'success' })
    expect(projectStatusMeta('deleted')).toEqual({ label: '已删除', status: 'disabled' })
  })
})

describe('visibility filter normalization', () => {
  it('normalizes only backend-accepted values', () => {
    expect(normalizeVisibilityFilter('PUBLIC')).toBe('PUBLIC')
    expect(normalizeVisibilityFilter('PRIVATE')).toBe('PRIVATE')
    expect(normalizeVisibilityFilter('')).toBeUndefined()
    expect(normalizeVisibilityFilter('draft')).toBeUndefined()
  })
})
import type { ProjectItem } from '@/types/project'
import { describe, expect, it } from 'vitest'
import {
  formatProjectStatisticsScope,
  formatProjectVisibilityScope,
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
  it('includes report tab by default', () => {
    const withoutAudit = projectDetailTabs({ canViewAiMemory: false, canViewAuditLogs: false })
    expect(withoutAudit.map((tab) => tab.key)).toEqual(['overview', 'conversations', 'reports'])
  })

  it('includes audit tab only when the platform audit permission is granted', () => {
    const withAudit = projectDetailTabs({ canViewAiMemory: false, canViewAuditLogs: true })
    expect(withAudit.map((tab) => tab.key)).toEqual(['overview', 'conversations', 'reports', 'audit'])
  })

  it('includes AI memory tab only for advanced AI conversation permission', () => {
    const hidden = projectDetailTabs({ canViewAiMemory: false, canViewAuditLogs: false })
    const shown = projectDetailTabs({ canViewAiMemory: true, canViewAuditLogs: false })

    expect(hidden.map((tab) => tab.key)).not.toContain('memory')
    expect(shown.map((tab) => tab.key)).toEqual(['overview', 'conversations', 'reports', 'memory'])
  })

  it('hides AI memory when called with the legacy boolean audit flag', () => {
    expect(projectDetailTabs(true).map((tab) => tab.key)).toEqual(['overview', 'conversations', 'reports', 'audit'])
  })
})

describe('project task entry projection', () => {
  it('projects the platform view/delete task entries in workspace order', () => {
    const entries = projectTaskEntries(makeProject({ region: '上海市' }))

    expect(entries.map((entry) => entry.label)).toEqual([
      '基本信息',
      'AI 对话',
      '报告',
      '热工计算',
    ])
  })

  it('scopes thermal calc and reports to the project id', () => {
    const entries = projectTaskEntries(makeProject({ id: 'p/1' }))

    expect(entries.find((entry) => entry.key === 'calc')?.route).toBe('/thermal/calc?projectId=p%2F1')
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
  it('maps visibility to public/private/department labels', () => {
    expect(projectVisibilityMeta('PUBLIC')).toEqual({ label: '公开', status: 'success' })
    expect(projectVisibilityMeta('PRIVATE')).toEqual({ label: '私有', status: 'default' })
    expect(projectVisibilityMeta('DEPARTMENT')).toEqual({ label: '部门可见', status: 'info' })
  })

  it('formats department visibility as 部门名（包含子部门）', () => {
    expect(formatProjectVisibilityScope({
      includeChildDepartments: true,
      ownerDepartmentName: '技术部',
      visibility: 'DEPARTMENT',
    })).toBe('技术部（包含子部门）')
    expect(formatProjectVisibilityScope({
      includeChildDepartments: false,
      ownerDepartmentName: '技术部',
      visibility: 'PRIVATE',
    })).toBe('私有')
  })

  it('maps status to active/deleted labels', () => {
    expect(projectStatusMeta('active')).toEqual({ label: '正常', status: 'success' })
    expect(projectStatusMeta('deleted')).toEqual({ label: '已删除', status: 'disabled' })
  })
})

describe('visibility filter normalization', () => {
  it('normalizes only backend-accepted values', () => {
    expect(normalizeVisibilityFilter('PUBLIC')).toBe('PUBLIC')
    expect(normalizeVisibilityFilter('DEPARTMENT')).toBe('DEPARTMENT')
    expect(normalizeVisibilityFilter('')).toBeUndefined()
    expect(normalizeVisibilityFilter('draft')).toBeUndefined()
  })
})

describe('project statistics scope text', () => {
  it('includes the department count when the backend reports it', () => {
    expect(formatProjectStatisticsScope({ public: 5, private: 7, department: 3 }))
      .toBe('公开 5 · 部门 3 · 私有 7')
  })

  it('omits the department count when the backend does not report it', () => {
    expect(formatProjectStatisticsScope({ public: 5, private: 7 })).toBe('公开 5 · 私有 7')
  })
})

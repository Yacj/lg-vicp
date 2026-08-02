import { describe, expect, it } from 'vitest'
import type { ProjectItem } from '@/types/project'
import {
  isProjectManager,
  normalizeVisibilityFilter,
  projectDetailTabs,
  projectStatusMeta,
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

    expect(withoutAudit.map((tab) => tab.key)).toEqual(['overview', 'files', 'conversations'])
    expect(withAudit.map((tab) => tab.key)).toEqual(['overview', 'files', 'conversations', 'audit'])
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
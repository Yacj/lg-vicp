import { describe, expect, it } from 'vitest'
import type { ReportItem, ShareLink } from '@/types/report'
import {
  canPublishReport,
  canRegenerateReport,
  formatCreatorName,
  formatFileSize,
  getReportTypeLabel,
  isReportInProgress,
  reportStateMeta,
  shareFullUrl,
  shareState,
} from './report'

function report(status: ReportItem['status'], publishedAt: string | null = null): ReportItem {
  return {
    contentJson: null,
    conversationId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdById: 'user-1',
    deletedAt: null,
    errorMessage: null,
    id: 'report-1',
    projectId: 'project-1',
    promptTemplateVersion: null,
    publishedAt,
    reportType: 'energy_design',
    status,
    templateVersion: '1',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('reportStateMeta（六态统一处理）', () => {
  it('maps DRAFT to 草稿', () => {
    expect(reportStateMeta(report('DRAFT'))).toEqual({ label: '草稿', status: 'default', terminal: true })
  })

  it('maps QUEUED to 等待生成（非终态）', () => {
    expect(reportStateMeta(report('QUEUED'))).toEqual({ label: '等待生成', status: 'warning', terminal: false })
  })

  it('maps GENERATING to 生成中（非终态）', () => {
    expect(reportStateMeta(report('GENERATING'))).toEqual({ label: '生成中', status: 'processing', terminal: false })
  })

  it('maps READY to 已完成（终态）', () => {
    expect(reportStateMeta(report('READY'))).toEqual({ label: '已完成', status: 'success', terminal: true })
  })

  it('derives 已发布 from READY + publishedAt', () => {
    expect(reportStateMeta(report('READY', '2026-01-02T00:00:00.000Z')))
      .toEqual({ label: '已发布', status: 'success', terminal: true })
  })

  it('maps FAILED to 失败（终态）', () => {
    expect(reportStateMeta(report('FAILED'))).toEqual({ label: '失败', status: 'error', terminal: true })
  })
})

describe('report action guards（对齐后端约束）', () => {
  it('treats QUEUED and GENERATING as in progress', () => {
    expect(isReportInProgress('QUEUED')).toBe(true)
    expect(isReportInProgress('GENERATING')).toBe(true)
    expect(isReportInProgress('READY')).toBe(false)
  })

  it('regeneration is only allowed for DRAFT or FAILED', () => {
    expect(canRegenerateReport('DRAFT')).toBe(true)
    expect(canRegenerateReport('FAILED')).toBe(true)
    expect(canRegenerateReport('QUEUED')).toBe(false)
    expect(canRegenerateReport('GENERATING')).toBe(false)
    expect(canRegenerateReport('READY')).toBe(false)
  })

  it('publish requires READY without publishedAt', () => {
    expect(canPublishReport(report('READY'))).toBe(true)
    expect(canPublishReport(report('READY', '2026-01-02T00:00:00.000Z'))).toBe(false)
    expect(canPublishReport(report('DRAFT'))).toBe(false)
  })
})

describe('formatters', () => {
  it('formats file sizes with units', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(1023)).toBe('1023 B')
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(1048576)).toBe('1.0 MB')
    expect(formatFileSize(1073741824)).toBe('1.0 GB')
    expect(formatFileSize(null)).toBe('-')
    expect(formatFileSize(undefined)).toBe('-')
  })

  it('shows 我 for the current user and short id otherwise', () => {
    expect(formatCreatorName('user-1', 'user-1')).toBe('我')
    expect(formatCreatorName('user-1', 'other-user')).toBe('user-1'.slice(0, 8))
    expect(formatCreatorName('user-1', null)).toBe('user-1'.slice(0, 8))
  })

  it('labels report types', () => {
    expect(getReportTypeLabel('energy_design')).toBe('节能设计')
    expect(getReportTypeLabel('design_note')).toBe('设计说明')
    expect(getReportTypeLabel('marketing_copy')).toBe('营销文案')
    expect(getReportTypeLabel('unknown_type')).toBe('unknown_type')
  })
})

describe('shareState（对齐后端公开访问校验）', () => {
  function share(partial: Partial<ShareLink> = {}): ShareLink {
    return {
      createdAt: '2026-01-01T00:00:00.000Z',
      createdById: 'user-1',
      enabled: true,
      expiresAt: null,
      id: 'share-1',
      maxViews: null,
      projectId: null,
      snapshotJson: {},
      targetId: 'report-1',
      targetType: 'REPORT',
      title: '分享',
      token: 'token-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
      viewCount: 0,
      ...partial,
    }
  }

  it('treats enabled link without limits as valid', () => {
    expect(shareState(share())).toBe('enabled')
  })

  it('treats disabled link as disabled', () => {
    expect(shareState(share({ enabled: false }))).toBe('disabled')
  })

  it('treats expired link as expired', () => {
    expect(shareState(share({ expiresAt: '2020-01-01T00:00:00.000Z' }))).toBe('expired')
  })

  it('treats exhausted view limit as exhausted', () => {
    expect(shareState(share({ maxViews: 10, viewCount: 10 }))).toBe('exhausted')
    expect(shareState(share({ maxViews: 10, viewCount: 9 }))).toBe('enabled')
  })

  it('builds full share url from origin', () => {
    expect(shareFullUrl('/api/v1/public/shares/abc'))
      .toBe(`${window.location.origin}/api/v1/public/shares/abc`)
  })
})
import { describe, expect, it } from 'vitest'
import type { ReportItem, ShareLink } from '@/types/report'
import {
  buildCreateReportInput,
  buildReportSettingsPreview,
  canApproveOrRejectReport,
  canPublishReport,
  canRegenerateReport,
  canSubmitReportReview,
  filterReportsByAffiliation,
  formatCreatorName,
  formatFileSize,
  formatReportProjectName,
  getReportTypeLabel,
  hasReportProject,
  isReportInProgress,
  REPORT_PROJECT_REQUIRED_MESSAGE,
  REPORT_SETTINGS_COVER_FALLBACK,
  REPORT_SETTINGS_PREVIEW_NOTICE,
  REPORT_SETTINGS_SECTION_HIDDEN_HINT,
  reportStateMeta,
  reportTypeRequiresReview,
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

  it('publish requires READY for AI reports and APPROVED for template reports', () => {
    expect(canPublishReport(report('READY'))).toBe(true)
    expect(canPublishReport(report('READY', '2026-01-02T00:00:00.000Z'))).toBe(false)
    expect(canPublishReport(report('DRAFT'))).toBe(false)
    expect(canPublishReport({ ...report('READY'), reportType: 'technical_scheme' })).toBe(false)
    expect(canPublishReport({ ...report('APPROVED'), reportType: 'technical_scheme' })).toBe(true)
  })

  it('submits review only for completed template-backed reports', () => {
    expect(reportTypeRequiresReview('technical_scheme')).toBe(true)
    expect(reportTypeRequiresReview('ai_conversation')).toBe(false)
    expect(canSubmitReportReview({ reportType: 'technical_scheme', status: 'READY' })).toBe(true)
    expect(canSubmitReportReview({ reportType: 'ai_conversation', status: 'READY' })).toBe(false)
    expect(canApproveOrRejectReport('PENDING_REVIEW')).toBe(true)
    expect(canApproveOrRejectReport('READY')).toBe(false)
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
    expect(getReportTypeLabel('technical_scheme')).toBe('综合技术方案报告')
    expect(getReportTypeLabel('project_brief')).toBe('项目方案简报')
    expect(getReportTypeLabel('material_compare')).toBe('材料对比报告')
    expect(getReportTypeLabel('ai_conversation')).toBe('AI对话整理报告')
    expect(getReportTypeLabel('energy_design')).toBe('建筑节能设计报告')
    expect(getReportTypeLabel('unknown_type')).toBe('unknown_type')
    expect(getReportTypeLabel('technical_scheme', [{
      code: 'technical_scheme',
      description: '',
      enabled: true,
      name: '综合技术方案报告',
      requiresProject: true,
    }])).toBe('综合技术方案报告')
  })

  it('builds ordinary create payloads without template fields', () => {
    expect(buildCreateReportInput({
      reportType: 'material_compare',
      requiresProject: false,
    })).toEqual({
      ok: true,
      input: { reportType: 'material_compare' },
    })
    expect(buildCreateReportInput({
      projectId: 'project-1',
      reportType: 'technical_scheme',
      requiresProject: true,
    })).toEqual({
      ok: true,
      input: { reportType: 'technical_scheme', projectId: 'project-1' },
    })
    expect(buildCreateReportInput({
      reportType: 'technical_scheme',
      requiresProject: true,
    })).toEqual({
      ok: false,
      message: REPORT_PROJECT_REQUIRED_MESSAGE,
    })
    const created = buildCreateReportInput({
      projectId: 'project-1',
      reportType: 'project_brief',
      requiresProject: true,
    })
    expect(created.ok).toBe(true)
    if (created.ok) {
      expect(created.input).not.toHaveProperty('templateId')
      expect(created.input).not.toHaveProperty('templateVersionId')
    }
  })

  it('shows project name or a dash, never 无 / 未关联项目', () => {
    expect(formatReportProjectName({ name: '合肥XX住宅' })).toBe('合肥XX住宅')
    expect(formatReportProjectName({ name: '  ' })).toBe('—')
    expect(formatReportProjectName(null)).toBe('—')
    expect(formatReportProjectName(undefined)).toBe('—')
    expect(formatReportProjectName(null)).not.toBe('无')
    expect(formatReportProjectName(null)).not.toBe('未关联项目')
    expect(formatReportProjectName(null)).not.toContain('所属项目：无')
    expect(hasReportProject('project-1')).toBe(true)
    expect(hasReportProject(null)).toBe(false)
  })

  it('filters my reports into project and standalone groups', () => {
    const items = [
      {
        id: 'r1',
        title: '项目报告',
        reportType: 'energy_design',
        status: 'READY' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
        project: { id: 'p1', name: '合肥XX住宅' },
      },
      {
        id: 'r2',
        title: '独立报告',
        reportType: 'design_note',
        status: 'READY' as const,
        createdAt: '2026-01-02T00:00:00.000Z',
        project: null,
      },
    ]

    expect(filterReportsByAffiliation(items, 'all').map(item => item.id)).toEqual(['r1', 'r2'])
    expect(filterReportsByAffiliation(items, 'linked').map(item => item.id)).toEqual(['r1'])
    expect(filterReportsByAffiliation(items, 'standalone').map(item => item.id)).toEqual(['r2'])
    expect(filterReportsByAffiliation(items, 'standalone')[0]?.project).toBeNull()
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

describe('buildReportSettingsPreview', () => {
  const base = {
    coverTitle: 'VICP智能技术方案',
    defaultExportFormat: 'PDF' as const,
    disclaimerText: '本报告仅供参考。',
    footerText: '页脚说明',
    headerText: '安徽蓝格利通',
    logoUrl: 'https://example.com/logo.png',
    reportTypeLabel: '综合技术方案报告',
    showCalculationProcess: true,
    showDisclaimer: true,
    showSourceReferences: true,
  }

  it('keeps filled cover title, disclaimer and visible sections', () => {
    const preview = buildReportSettingsPreview(base)
    expect(preview.notice).toBe(REPORT_SETTINGS_PREVIEW_NOTICE)
    expect(preview.coverTitle).toBe('VICP智能技术方案')
    expect(preview.headerText).toBe('安徽蓝格利通')
    expect(preview.footerText).toBe('页脚说明')
    expect(preview.logoUrl).toBe('https://example.com/logo.png')
    expect(preview.reportTypeLabel).toBe('综合技术方案报告')
    expect(preview.exportFormatLabel).toBe('PDF')
    expect(preview.disclaimerText).toBe('本报告仅供参考。')
    expect(preview.sections.map(section => section.visible)).toEqual([true, true])
  })

  it('falls back to default cover title when empty', () => {
    expect(buildReportSettingsPreview({ ...base, coverTitle: '  ' }).coverTitle)
      .toBe(REPORT_SETTINGS_COVER_FALLBACK)
  })

  it('hides disclaimer when the switch is off', () => {
    expect(buildReportSettingsPreview({ ...base, showDisclaimer: false }).disclaimerText).toBeNull()
  })

  it('marks calculation and sources as hidden when switches are off', () => {
    const preview = buildReportSettingsPreview({
      ...base,
      showCalculationProcess: false,
      showSourceReferences: false,
    })
    expect(preview.sections).toEqual([
      expect.objectContaining({ key: 'calculation', title: '计算过程', visible: false }),
      expect.objectContaining({ key: 'sources', title: '引用来源', visible: false }),
    ])
    expect(REPORT_SETTINGS_SECTION_HIDDEN_HINT).toBe('按设置不输出')
  })

  it('labels DOCX export as Word', () => {
    expect(buildReportSettingsPreview({ ...base, defaultExportFormat: 'DOCX' }).exportFormatLabel)
      .toBe('Word')
  })
})
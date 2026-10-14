import type { CreateReportResult } from '@/api/types'

export function reportResult(overrides: Partial<CreateReportResult> = {}): CreateReportResult {
  return {
    message: '报告已进入生成队列',
    taskId: 'task-1',
    status: 'QUEUED',
    reused: false,
    solutionSnapshotId: 'snapshot-1',
    report: { id: 'report-1', conversationId: 'conversation-1', projectId: null, reportType: 'technical_scheme', contentJson: null, status: 'QUEUED', errorMessage: null, publishedAt: null, templateVersion: '1', createdById: 'user-1', createdAt: '2026-10-14T08:00:00Z', updatedAt: '2026-10-14T08:00:00Z' },
    ...overrides,
  }
}

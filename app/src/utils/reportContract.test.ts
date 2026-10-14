import type { ReportDetail } from '@/api/types'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test as nodeTest } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { reportResult } from '../test/fixtures/report'
import { solutionFixture } from '../test/fixtures/solution'
import { confirmedReportBody, createdReportTask, reportTaskPresentation } from './aiReportTask'
import { solutionPersistenceSnapshot } from './aiSolution'
import { parseUserSelectionRequest, shouldAutoSelectWhenSingle } from './aiUserSelection'

nodeTest('待确认、缺快照、跨会话及旧生成阶段不可创建；CONFIRMED 只发送真实绑定 ID', () => {
  for (const state of [null, solutionFixture({ stage: 'READY_TO_CONFIRM' }), solutionFixture({ stage: 'CONFIRMED' }), solutionFixture({ stage: 'GENERATED', confirmedSnapshotId: 'snapshot-1' })])
    assert.equal(confirmedReportBody(state, 'conversation-1'), null)
  const state = solutionFixture({ stage: 'CONFIRMED', confirmedSnapshotId: 'snapshot-1' })
  assert.equal(confirmedReportBody(state, 'other'), null)
  assert.deepEqual(confirmedReportBody(state, 'conversation-1'), { reportType: 'technical_scheme', conversationId: 'conversation-1', solutionSnapshotId: 'snapshot-1' })
})

nodeTest('复用 READY/FAILED 沿用报告和任务 ID，兼容旧创建响应', () => {
  for (const status of ['READY', 'FAILED']) {
    const mapped = createdReportTask(reportResult({ status, reused: true }))
    assert.equal(mapped.id, 'report-1')
    assert.equal(mapped.taskId, 'task-1')
    assert.equal(mapped.status, status)
    assert.equal(mapped.reused, true)
    assert.equal(mapped.messageId, null)
  }
  const legacy = reportResult()
  delete legacy.status
  delete legacy.reused
  delete legacy.solutionSnapshotId
  assert.equal(createdReportTask(legacy).status, 'QUEUED')
})

nodeTest('report、task、审核、发布、真实 PDF 格式互不替代', () => {
  const detail: ReportDetail = { report: reportResult().report, project: null, sources: [], solutionSnapshotId: 'snapshot-1', task: null, availableFormats: [] }
  assert.equal(detail.report.contentJson, null)
  const ready = createdReportTask(reportResult({ status: 'READY' }))
  assert.equal(reportTaskPresentation(ready).canPreviewPdf, false)
  const pending = { ...ready, reportStatus: 'GENERATING', task: { id: 't', status: 'COMPLETED' as const, progress: 100, errorMessage: null }, availableFormats: ['HTML' as const] }
  assert.equal(reportTaskPresentation(pending).status, 'GENERATING')
  assert.equal(reportTaskPresentation(pending).canPreviewPdf, false)
  for (const status of ['PENDING_REVIEW', 'APPROVED', 'REJECTED']) {
    const presentation = reportTaskPresentation({ ...ready, reportStatus: status, publishedAt: null })
    assert.equal(presentation.shouldPoll, false)
    assert.equal(presentation.canRetry, false)
    assert.equal(presentation.publicationLabel, '未发布')
    assert.ok(presentation.reviewLabel)
  }
  const published = reportTaskPresentation({ ...ready, reportStatus: 'APPROVED', publishedAt: '2026-10-14', availableFormats: ['PDF'] })
  assert.equal(published.canPreviewPdf, true)
  assert.equal(published.publicationLabel, '已发布')
})

nodeTest('单项报告选择必须可见并由用户触发，普通知识来源继续允许自动选中', () => {
  for (const selectionKind of ['PRODUCT', 'REPORT_TYPE', 'GENERIC', 'KNOWLEDGE_SOURCE']) {
    const request = parseUserSelectionRequest({ type: 'USER_SELECTION', selectionKind, autoSelectWhenSingle: true, options: [{ id: 'only', title: '唯一选项' }], confirmAction: { type: 'GENERATE_REPORT', label: '生成报告' } })
    assert.equal(shouldAutoSelectWhenSingle(request), false)
  }
  const source = parseUserSelectionRequest({ type: 'USER_SELECTION', selectionKind: 'KNOWLEDGE_SOURCE', autoSelectWhenSingle: true, options: [{ id: 'source', title: '正式来源' }] })
  assert.equal(shouldAutoSelectWhenSingle(source), true)
})

nodeTest('启动恢复清除创建锁/错误/请求 revision，不保存签名 URL 或快照缓存', () => {
  const restored = solutionPersistenceSnapshot({ conversation: { id: 'conversation-1' }, solutionState: solutionFixture({ stage: 'CONFIRMED', confirmedSnapshotId: 'snapshot-1' }), solutionReportCreating: true, solutionReportError: '旧错误', solutionReportRequestRevision: 12 })
  assert.equal(restored.solutionReportCreating, false)
  assert.equal(restored.solutionReportError, '')
  assert.equal(restored.solutionReportRequestRevision, 0)
  assert.equal(restored.solutionSnapshot, null)
})

nodeTest('执行真实 reports 模块：创建、PDF 预览及下载精确使用既有 request', () => {
  const calls: unknown[][] = []
  const exports: Record<string, any> = {}
  const source = readFileSync(new URL('../api/modules/reports.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  runInNewContext(compiled, { exports, require: () => ({ request: (...args: unknown[]) => calls.push(args) }) })
  const body = confirmedReportBody(solutionFixture({ stage: 'CONFIRMED', confirmedSnapshotId: 'snapshot-1' }), 'conversation-1')!
  exports.reportApi.create(body)
  exports.reportApi.getArtifactPreviewUrl('report-1', 'PDF')
  exports.reportApi.getArtifactDownloadUrl('report-1', 'PDF')
  assert.equal(JSON.stringify(calls), JSON.stringify([
    ['POST', '/reports', { data: body }],
    ['GET', '/reports/{id}/artifacts/{type}/preview-url', { pathParams: { id: 'report-1', type: 'PDF' } }],
    ['GET', '/reports/{id}/artifacts/{type}/download-url', { pathParams: { id: 'report-1', type: 'PDF' } }],
  ]))
})

import type { MyReportItem } from '@/api/types'
import assert from 'node:assert/strict'
import { test as nodeTest } from 'node:test'
import { reportResult } from '../test/fixtures/report'
import { readReportListStatus, reportTaskPresentation } from './aiReportTask'

const item = (id: string): MyReportItem => ({ id, title: '技术方案报告', reportType: 'technical_scheme', status: 'READY', createdAt: '2026-10-14', project: null })

nodeTest('报告列表通过真实详情 publishedAt 补充，最多四个并发，不按 APPROVED 猜发布', async () => {
  let active = 0
  let peak = 0
  const rows = Array.from({ length: 12 }, (_, index) => item(String(index)))
  const result = await readReportListStatus(rows, async (id) => {
    peak = Math.max(peak, ++active)
    await new Promise<void>(resolve => setImmediate(resolve))
    active--
    return { report: { ...reportResult().report, id, status: 'APPROVED', publishedAt: id === '0' ? '2026-10-14' : null }, sources: [], availableFormats: [] }
  }, () => true)
  assert.equal(peak, 4)
  assert.equal(result[0].publishedAt, '2026-10-14')
  assert.equal(result[1].publishedAt, null)
  assert.equal(result[1].status, 'APPROVED')
  assert.equal(rows[0].status, 'READY')
})

nodeTest('权限/网络失败与错 reportId 不推断发布；离开列表停止后续读取', async () => {
  let current = true
  let calls = 0
  const rows = Array.from({ length: 10 }, (_, index) => item(String(index)))
  const result = await readReportListStatus(rows, async () => {
    calls++
    current = false
    throw new Error('报告不可见')
  }, () => current)
  assert.equal(calls, 1)
  assert.equal(result[0].publishedAt, undefined)
  const wrong = await readReportListStatus([item('report-1')], async () => ({ report: { ...reportResult().report, id: 'other' }, sources: [], availableFormats: [] }), () => true)
  assert.equal(wrong[0].publishedAt, undefined)
  const unknown = reportTaskPresentation({ id: 'r', title: '', projectId: null, reportStatus: 'APPROVED' })
  assert.equal(unknown.publicationLabel, '')
})

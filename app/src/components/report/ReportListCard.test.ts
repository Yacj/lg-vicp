import type { ReportListViewItem } from '@/utils/aiReportTask'
import assert from 'node:assert/strict'
import { test as nodeTest } from 'node:test'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ReportListCard from './ReportListCard.vue'

async function render(status: string, publishedAt?: string | null) {
  const item: ReportListViewItem = { id: 'report', title: '历史技术报告', reportType: 'technical_scheme', status, createdAt: '2026-10-14', project: null, publishedAt }
  return renderToString(createSSRApp({ render: () => h(ReportListCard, { item }) }))
}

nodeTest('历史报告卡保留标题/日期，生成、失败、审核、已发布分别显示；未知发布状态不猜测', async () => {
  for (const [status, label] of [['QUEUED', '报告已进入生成队列'], ['GENERATING', '正在生成报告'], ['FAILED', '报告生成失败'], ['PENDING_REVIEW', '审核中'], ['APPROVED', '审核通过'], ['REJECTED', '审核未通过']]) {
    const html = await render(status)
    for (const text of ['历史技术报告', '2026-10-14', label]) assert.ok(html.includes(text), text)
    assert.ok(!html.includes('未发布'))
  }
  assert.ok((await render('APPROVED', '2026-10-14')).includes('已发布'))
  assert.ok((await render('APPROVED', null)).includes('未发布'))
})

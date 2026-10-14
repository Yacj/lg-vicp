import type { SessionReport } from '@/utils/aiAgentUi'
import assert from 'node:assert/strict'
import { test as nodeTest } from 'node:test'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { reportResult } from '../../test/fixtures/report'
import { createdReportTask } from '../../utils/aiReportTask'
import AiReportTaskCard from './AiReportTaskCard.vue'

async function render(report: SessionReport) {
  const app = createSSRApp({ render: () => h(AiReportTaskCard, { report }) })
  app.component('wd-button', { render() {
    return h('button', this.$slots.default?.())
  } })
  return renderToString(app)
}

nodeTest('创建即支持详情跳转；任务完成、审核与发布分别展示；无 PDF 不显示下载承诺', async () => {
  const pending = await render(createdReportTask(reportResult()))
  assert.ok(pending.includes('报告已进入生成队列'))
  assert.ok(pending.includes('查看报告'))
  assert.ok(!pending.includes('下载 PDF'))
  const approved = await render({ ...createdReportTask(reportResult({ status: 'APPROVED' })), task: { id: 't', status: 'COMPLETED', progress: 100, errorMessage: null } })
  for (const label of ['报告已生成', '任务已完成', '审核通过', '未发布']) assert.ok(approved.includes(label), label)
  const failed = await render({ ...createdReportTask(reportResult({ status: 'FAILED' })), errorMessage: '报告模板已失效' })
  for (const label of ['报告生成失败', '重新生成', '报告模板已失效']) assert.ok(failed.includes(label), label)
  const rejected = await render(createdReportTask(reportResult({ status: 'REJECTED' })))
  assert.ok(rejected.includes('审核未通过'))
  assert.ok(!rejected.includes('正在生成报告'))
})

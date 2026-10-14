import type { ReportDetail, ReportTaskResult } from '@/api/types'
import assert from 'node:assert/strict'
import { test as nodeTest } from 'node:test'
import { reportResult } from '../test/fixtures/report'
import { reportDetailPresentation } from '../utils/aiReportTask'
import { useReportDetail } from './useReportDetail'

function detail(status = 'QUEUED', formats: ReportDetail['availableFormats'] = []): ReportDetail {
  return { report: { ...reportResult().report, status }, sources: [], project: null, solutionSnapshotId: 'snapshot-1', task: null, availableFormats: formats }
}

function setup(get: () => Promise<ReportDetail>, retry: (id: string) => Promise<ReportTaskResult> = async id => ({ message: '', reportId: id, taskId: 'retry', status: 'GENERATING' })) {
  const context = { id: 'report-1', userId: 'user-1' as string | null }
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>()
  let next = 0
  let calls = 0
  const resource = useReportDetail(() => context, { get: async () => {
    calls++
    return get()
  }, retry }, {
    set: (callback) => {
      const id = ++next as unknown as ReturnType<typeof setTimeout>
      timers.set(id, callback)
      return id
    },
    clear: id => timers.delete(id),
  })
  return { context, resource, timers, calls: () => calls }
}

nodeTest('详情独立轮询到真实 report READY；task COMPLETED 不提前停止，无 PDF 不可下载', async () => {
  let status = 'QUEUED'
  const { resource, timers } = setup(async () => ({ ...detail(status), task: { id: 'task', status: 'COMPLETED', progress: 100, errorMessage: null } }))
  await resource.start()
  assert.equal(timers.size, 1)
  assert.equal(reportDetailPresentation(resource.detail.value!).canPreviewPdf, false)
  status = 'GENERATING'
  await resource.refresh()
  assert.equal(timers.size, 1)
  status = 'READY'
  await resource.refresh()
  assert.equal(timers.size, 0)
  assert.equal(reportDetailPresentation(resource.detail.value!).canPreviewPdf, false)
  resource.stop()
})

nodeTest('审核态不无限轮询，PDF 和 publishedAt 分别决定文件与发布', async () => {
  for (const status of ['PENDING_REVIEW', 'APPROVED', 'REJECTED', 'FAILED', 'CANCELLED']) {
    const { resource, timers } = setup(async () => detail(status, ['PDF']))
    await resource.start()
    assert.equal(timers.size, 0)
    const view = reportDetailPresentation(resource.detail.value!)
    assert.equal(view.canPreviewPdf, true)
    assert.equal(view.publicationLabel, '未发布')
    assert.equal(view.canRetry, status === 'FAILED')
    resource.stop()
  }
})

nodeTest('旧 JSON 草稿不是队列任务，不自动轮询或触发生成', async () => {
  const context = setup(async () => detail('DRAFT'))
  await context.resource.start()
  assert.equal(context.timers.size, 0)
  assert.equal(reportDetailPresentation(context.resource.detail.value!).title, '报告草稿，尚未生成')
  assert.equal(await context.resource.retry(), false)
})

nodeTest('隐藏/卸载取消定时器和迟到请求；重新进入立即刷新', async () => {
  let resolve!: (value: ReportDetail) => void
  const context = setup(() => new Promise((done) => {
    resolve = done
  }))
  const first = context.resource.start()
  context.resource.stop()
  resolve(detail('READY', ['PDF']))
  await first
  assert.equal(context.resource.detail.value, null)
  assert.equal(context.timers.size, 0)
  const second = context.resource.start()
  resolve(detail('GENERATING'))
  await second
  assert.equal(context.calls(), 2)
  assert.equal(context.timers.size, 1)
  context.resource.stop()
  assert.equal(context.timers.size, 0)
})

nodeTest('账号切换同 reportId 清旧内容；错误归属响应和无登录状态不复用旧详情', async () => {
  let response = detail('READY', ['PDF'])
  const context = setup(async () => response)
  await context.resource.start()
  context.context.userId = 'user-2'
  response = { ...response, report: { ...response.report, id: 'other' } }
  await context.resource.start()
  assert.equal(context.resource.detail.value, null)
  assert.equal(context.resource.status.value, 'error')
  assert.equal(context.resource.errorMessage.value, '报告详情与当前报告不一致')
  context.context.userId = null
  await context.resource.start()
  assert.equal(context.calls(), 2)
  assert.equal(context.resource.errorMessage.value, '请登录后查看报告')
})

nodeTest('网络失败保留已加载内容，权限/404 失败清缓存并展示后端原文', async () => {
  let fail: Error | null = null
  const context = setup(async () => {
    if (fail)
      throw fail
    return detail('GENERATING')
  })
  await context.resource.start()
  fail = new Error('网络暂时不可用')
  await context.resource.refresh()
  assert.ok(context.resource.detail.value)
  assert.equal(context.resource.errorMessage.value, '网络暂时不可用')
  fail = Object.assign(new Error('请求失败'), { data: { error: { code: 404, message: '报告尚未发布或无权查看' } } })
  await context.resource.refresh()
  assert.equal(context.resource.detail.value, null)
  assert.equal(context.resource.errorMessage.value, '报告尚未发布或无权查看')
  assert.equal(context.timers.size, 0)
})

nodeTest('失败重试只用原 reportId；遵循真实 GENERATING/新 task，不伪造 READY', async () => {
  let retryDone!: (value: ReportTaskResult) => void
  let status = 'FAILED'
  const ids: string[] = []
  const context = setup(async () => detail(status), id => new Promise((done) => {
    ids.push(id)
    retryDone = done
  }))
  await context.resource.start()
  const first = context.resource.retry()
  assert.equal(await context.resource.retry(), false)
  status = 'GENERATING'
  retryDone({ message: '', reportId: 'report-1', taskId: 'retry', status })
  assert.equal(await first, true)
  assert.deepEqual(ids, ['report-1'])
  assert.equal(context.resource.detail.value!.report.status, status)
  assert.equal(context.resource.retrying.value, false)
  assert.equal(context.timers.size, 1)
  context.resource.stop()
})

nodeTest('重试被拒保留真实 FAILED；重试中的卸载/账号变化不回写', async () => {
  const refused = setup(async () => detail('FAILED'), async () => {
    throw new Error('当前用户无权重新生成')
  })
  await refused.resource.start()
  assert.equal(await refused.resource.retry(), false)
  assert.equal(refused.resource.detail.value!.report.status, 'FAILED')
  assert.equal(refused.resource.errorMessage.value, '当前用户无权重新生成')
  let done!: (value: ReportTaskResult) => void
  const stopped = setup(async () => detail('FAILED'), () => new Promise((resolve) => {
    done = resolve
  }))
  await stopped.resource.start()
  const pending = stopped.resource.retry()
  stopped.resource.stop()
  done({ message: '', reportId: 'report-1', taskId: 'retry', status: 'QUEUED' })
  assert.equal(await pending, false)
  assert.equal(stopped.resource.detail.value!.report.status, 'FAILED')
  assert.equal(stopped.timers.size, 0)
})

nodeTest('重试请求未结束时手动刷新不能用旧 FAILED 覆盖重试后的状态', async () => {
  let finishRetry!: (value: ReportTaskResult) => void
  let status = 'FAILED'
  const context = setup(async () => detail(status), () => new Promise((resolve) => {
    finishRetry = resolve
  }))
  await context.resource.start()
  const retry = context.resource.retry()
  await context.resource.refresh()
  assert.equal(context.calls(), 1)
  status = 'GENERATING'
  finishRetry({ message: '', reportId: 'report-1', taskId: 'retry', status })
  assert.equal(await retry, true)
  assert.equal(context.calls(), 2)
  assert.equal(context.resource.detail.value!.report.status, 'GENERATING')
  context.resource.stop()
})

nodeTest('旧轮询响应不能释放重新进入页面后新请求的刷新锁', async () => {
  const resolves: Array<(value: ReportDetail) => void> = []
  const context = setup(() => new Promise((resolve) => {
    resolves.push(resolve)
  }))
  const old = context.resource.start()
  context.resource.stop()
  const current = context.resource.start()
  resolves[0](detail('READY', ['PDF']))
  await old
  assert.equal(context.resource.refreshing.value, true)
  assert.equal(context.resource.detail.value, null)
  await context.resource.refresh()
  assert.equal(context.calls(), 2)
  resolves[1](detail('GENERATING'))
  await current
  assert.equal(context.resource.refreshing.value, false)
  assert.equal(context.timers.size, 1)
  context.resource.stop()
})

import {
  isInProgressReportStatus,
  isTerminalReportStatus,
  mapReportTaskStatus,
  REPORT_COMPLETED_MESSAGE,
  reportTaskTitle,
  shouldPollReportStatus,
} from './aiReportTask.ts'

let failed = 0
let passed = 0

function assert(condition: unknown, name: string) {
  if (condition) {
    passed += 1
    console.log(`ok  ${name}`)
    return
  }
  failed += 1
  console.error(`FAIL  ${name}`)
}

assert(mapReportTaskStatus('QUEUED') === 'QUEUED', 'QUEUED')
assert(mapReportTaskStatus('DRAFT') === 'QUEUED', 'DRAFT 视为进入队列')
assert(reportTaskTitle('QUEUED') === '报告已进入生成队列', 'QUEUED 文案')

assert(mapReportTaskStatus('GENERATING') === 'GENERATING', 'GENERATING')
assert(mapReportTaskStatus('PROCESSING') === 'GENERATING', '旧 PROCESSING 不闪失败')
assert(reportTaskTitle('GENERATING') === '正在生成报告…', 'GENERATING 文案')
assert(isInProgressReportStatus('GENERATING'), '内部 retry 保持生成中')
assert(shouldPollReportStatus('GENERATING'), '生成中继续轮询')
assert(mapReportTaskStatus('GENERATING') !== 'FAILED', '内部 retry 不展示失败')

assert(mapReportTaskStatus('READY') === 'READY', 'READY')
assert(mapReportTaskStatus('PENDING_REVIEW') === 'READY', '审核中仍视为已生成')
assert(reportTaskTitle('READY') === '报告已生成', 'READY 文案')
assert(REPORT_COMPLETED_MESSAGE === '报告已生成。', '聊天正文不塞报告全文')
assert(isTerminalReportStatus('READY'), 'READY 后停止轮询')

assert(mapReportTaskStatus('FAILED') === 'FAILED', 'FAILED')
assert(reportTaskTitle('FAILED') === '报告生成失败', 'FAILED 文案')
assert(isTerminalReportStatus('FAILED'), 'FAILED 后停止轮询，允许 retry')

assert(mapReportTaskStatus('QUEUED') === 'QUEUED', 'retry 后回到 QUEUED')
assert(mapReportTaskStatus('CANCELLED') === 'CANCELLED', 'CANCELLED')
assert(!shouldPollReportStatus('CANCELLED'), '页面退出后终态不再轮询')
assert(shouldPollReportStatus('QUEUED'), '页面回来后恢复 QUEUED 轮询')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  throw new Error(`aiReportTask tests failed: ${failed}`)
}

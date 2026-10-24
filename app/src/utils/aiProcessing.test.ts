import assert from 'node:assert/strict'
import test from 'node:test'
import { finishProcessing, finishProcessingClock, mergeProcessingSources, processingNarrative, processingSeconds, processingSourceLabels, processingTitle, updateProcessingStep } from './aiProcessing.ts'

test('过程按步骤更新，保留多份真实资料且不复述内部字段或物理页码', () => {
  let steps = updateProcessingStep([], { key: 'knowledge', message: '正在查询知识库资料…' })
  steps = updateProcessingStep(steps, { key: 'knowledge', message: '已完成知识库查询', status: 'done' })
  steps = updateProcessingStep(steps, { key: 'sources', message: '已读取以下资料', status: 'done', sources: [{ title: '热工表', pageLabel: 'A7' }] })
  steps = updateProcessingStep(steps, { key: 'sources', message: '已读取以下资料', status: 'done', sources: [{ title: '热工表', pageLabel: 'A7' }, { title: '原表' }] })
  assert.equal(steps.length, 2)
  assert.equal(steps[0].status, 'done')
  assert.deepEqual(steps[1].sources, [{ title: '热工表', pageLabel: 'A7' }, { title: '原表' }])
  assert.deepEqual(mergeProcessingSources([], [{ title: '资料', physicalPageNumber: 37, matchedText: '内部正文', pageId: 'private' }]), [{ title: '资料' }])
  assert.equal(updateProcessingStep(steps, { key: 'bad', message: 'ToolCall #3' }), steps)
  assert.deepEqual(processingSourceLabels([{ title: '热工表', pageLabel: 'A7' }, { title: '热工表', pageLabel: 'A8' }, { title: '热工表' }]), [{ title: '热工表', pages: 'A7、A8' }])
})

test('停止或失败保留已完成记录，不把未完成步骤标成成功', () => {
  const steps = [{ key: 'knowledge', message: '已完成知识库查询', status: 'done' as const }, { key: 'composing', message: '正在整理回答…', status: 'active' as const }]
  for (const status of ['stopped', 'error'] as const) {
    const result = finishProcessing(steps, status)
    assert.equal(result[0].status, 'done')
    assert.equal(result[1].status, status)
    assert.equal(steps[1].status, 'active')
  }
  assert.deepEqual(updateProcessingStep([], { key: 'next', message: '正在理解你的问题…' }).map(item => item.key), ['next'])
})

test('耗时在首次正式回答处冻结，不随正文继续输出、折叠或重复完成而增加', () => {
  const clock = { processingStartedAt: 1000, processingFinishedAt: undefined as number | undefined }
  assert.equal(processingSeconds(clock, 3500), 3)
  finishProcessingClock(clock, 4100)
  finishProcessingClock(clock, 19000)
  assert.equal(processingSeconds(clock, 90000), 4)
  assert.equal(processingTitle(false, 4), '已思考（4秒）')
  assert.equal(processingTitle(true, 3), '思考中（3秒）')
  assert.equal(processingTitle(false, 4, 'STOPPED'), '思考已停止（4秒）')
  assert.equal(processingSeconds({}, 90000), null)
  assert.equal(processingTitle(false, null), '已思考')
})

test('用连贯说明概括实际查询，合并书名并隐藏逐页明细；未执行步骤不加入说明', () => {
  const text = processingNarrative([
    { key: 'preparing', status: 'done', message: '请求已接收' },
    { key: 'understanding', status: 'done', message: '已梳理问题' },
    { key: 'products', status: 'done', message: '已完成产品资料查询' },
    { key: 'sources', status: 'done', message: '已读取以下资料', sources: [{ title: '热工表', pageLabel: 'A7' }, { title: '热工表', pageLabel: 'A8' }] },
  ], false).join('\n')
  assert.ok(text.includes('查阅现有产品资料'))
  assert.equal(text.split('《热工表》').length - 1, 1)
  for (const hidden of ['A7', 'A8', '请求已接收', '已完成产品资料查询', '计算', '对比']) assert.ok(!text.includes(hidden), hidden)
  assert.ok(processingNarrative([{ key: 'knowledge', status: 'stopped', message: '本步已停止' }], false).join('').includes('处理已停止'))
})

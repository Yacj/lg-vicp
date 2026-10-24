import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { getObservation } from './original/observation.mjs?single-flow-v1'

export async function run({ context, page, capture, out, clean }) {
  const previous = await readFile(`${out}/single-flow.json`, 'utf8').catch(() => null)
  if (previous) await writeFile(`${out}/single-flow-before-${Date.now()}.json`, previous)
  const audit = { startedAt: new Date().toISOString(), scope: '单一有效正式参考候选的H5确认与PDF闭环；不证明双方案比较通过', steps: [] }
  const save = () => writeFile(`${out}/single-flow.json`, clean(JSON.stringify(audit, null, 2)))
  const post = async (locator, suffix, name) => {
    const waiting = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(suffix), { timeout: 25000 })
    await locator.click()
    const response = await waiting, result = await response.json()
    audit.steps.push({ name, http: response.status(), success: result.success, result }); await save()
    assert.equal(result.success, true, `${name}业务失败`)
    return result.data
  }
  try {
  await page.goto('http://127.0.0.1:8899/#/pages/assistant/index', { waitUntil: 'networkidle' })
  await page.locator('textarea').waitFor({ state: 'visible' })
  await page.locator('[aria-label="新建对话"]').click()
  const prompt = '查询已发布的VICP-OVERALL参考行，保留输入条件及来源。'
  await page.locator('textarea').fill(prompt)
  const waiting = page.waitForResponse(r => r.request().method() === 'POST' && /\/conversations\/[^/]+\/messages$/.test(new URL(r.url()).pathname))
  await page.locator('[aria-label="发送消息"]').click()
  const stream = await waiting; await stream.finished()
  audit.conversationId = new URL(stream.url()).pathname.split('/')[5]
  await writeFile(`${out}/buttons-query.sse.txt`, clean(await stream.text()))
  await page.waitForFunction(() => document.querySelectorAll('.query-candidates__card').length === 1)
  const before = await getObservation()
  assert.equal(before.solutions.filter(s => s.conversation_id === audit.conversationId).length, 0, '查询不能自动创建选择状态')
  audit.steps.push({ name: 'QUERY_CARDS', count: 1, automaticSelection: false }); await capture('buttons-query-cards'); await save()
  const restored = []
  const observeRestore = response => { const path = new URL(response.url()).pathname; if (path === `/api/v1/ai/conversations/${audit.conversationId}` || path === `/api/v1/ai/conversations/${audit.conversationId}/solution/candidates`) restored.push({ path, http: response.status() }) }
  page.on('response', observeRestore)
  await page.reload({ waitUntil: 'networkidle' })
  await page.goto('http://127.0.0.1:8899/#/pages/conversation-history/index', { waitUntil: 'networkidle' })
  await page.locator('.conversation-card').first().click()
  await page.waitForFunction(() => document.querySelectorAll('.query-candidates__card').length === 1)
  page.off('response', observeRestore)
  assert.ok(restored.some(response => response.path.endsWith('/solution/candidates') && response.http === 200), '历史恢复须重新读取当前有权候选')
  audit.steps.push({ name: 'HISTORY_RESTORE', candidates: 1, requests: restored }); await capture('buttons-history-restored'); await save()
  for (let index = 0; index < 1; index++) {
    await post(page.locator('.query-candidates__card').nth(index).getByText('加入方案', { exact: true }), '/solution/activate', `ADD_${index + 1}`)
  }
  audit.steps.push({name:'COMPARE',status:'NOT_RUN',reason:'本场景只使用一条已核验正式参考行，双方案受35mm规格绑定冲突阻塞'}); await save()
  await page.getByText('选为最终方案', { exact: true }).first().click()
  await post(page.getByText('设为最终方案', { exact: true }), '/solution/actions', 'SET_FINAL')
  await capture('buttons-final-before-confirm')
  const final = (await getObservation()).solutions.find(s => s.conversation_id === audit.conversationId)
  assert.equal(final.stage, 'READY_TO_CONFIRM'); assert.equal(final.confirmed_snapshot_id, null)
  await post(page.getByText('确认生成方案', { exact: true }), '/solution/actions', 'CONFIRM')
  const confirmed = await getObservation(), snapshot = confirmed.snapshots.find(s => s.conversationId === audit.conversationId || s.conversation_id === audit.conversationId)
  assert.ok(snapshot); assert.equal(snapshot.payload.candidates.length, 1); assert.equal(snapshot.payload.alternatives.length, 0)
  audit.snapshotId = snapshot.id; await capture('buttons-confirmed'); await save()
  const report = await post(page.getByText('生成技术方案 PDF', { exact: true }), '/reports', 'CREATE_PDF')
  audit.reportId = report.report.id
  for (let attempt = 0; attempt < 60; attempt++) {
    const current = (await getObservation()).reports.find(r => r.id === audit.reportId)
    if (current?.status === 'READY') { audit.reportStatus = 'READY'; break }
    if (current?.status === 'FAILED') { audit.reportStatus = 'FAILED'; audit.reportError = current.error_message; throw Error(`实际PDF任务失败：${current.error_message ?? '需查看任务错误'}`) }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  assert.equal(audit.reportStatus, 'READY')
  await page.goto(`http://127.0.0.1:8899/#/pages/report-detail/index?id=${audit.reportId}`, { waitUntil: 'networkidle' })
  await page.getByText('预览 PDF', { exact: true }).waitFor({ state: 'visible' })
  await capture('buttons-report-detail')
  audit.status = 'PASS'; audit.finishedAt = new Date().toISOString(); await save()
  return { status: audit.status, steps: audit.steps.length, snapshotId: audit.snapshotId, reportStatus: audit.reportStatus }
  } catch (error) {
    audit.status = 'FAIL'; audit.error = clean(error.message); audit.finishedAt = new Date().toISOString(); await save(); await capture('buttons-failure').catch(() => {})
    return { status: audit.status, steps: audit.steps.map(step => ({ name: step.name, success: step.success })), error: audit.error }
  }
}

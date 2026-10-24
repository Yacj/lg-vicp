import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { getObservation } from './observation.mjs?calculated-report-v1'

export async function run({ page, capture, out, clean }) {
  const matrix = JSON.parse(await readFile(`${out}/matrix.json`, 'utf8'))
  const before = await getObservation()
  const conversationId = matrix.cases.find(item => item.id === 'R3').conversationId
  const lookup = before.states.find(item => item.conversation_id === conversationId).task_state_json.lastReferenceLookup
  assert.equal(lookup.candidates.length, 1)
  const candidate = lookup.candidates[0]
  assert.equal(candidate.sourceType, 'CALCULATED'); assert.equal(candidate.inputSnapshot.thicknessMm, 20)
  const audit = { startedAt: new Date().toISOString(), scope: '原始R3真实模型分层计算20mm记录→真实H5按钮→冻结→PDF，不重新计算', conversationId, calculationId: candidate.calculationId, steps: [] }
  const save = () => writeFile(`${out}/calculated-report-flow.json`, clean(JSON.stringify(audit, null, 2)))
  const post = async (label, suffix) => {
    const waiting = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(suffix), { timeout: 25000 })
    await page.getByText(label, { exact: true }).first().click()
    const response = await waiting, result = await response.json()
    audit.steps.push({ label, success: result.success, result }); await save(); assert.equal(result.success, true, label)
    return result.data
  }
  try {
    const title = before.conversations.find(item => item.id === conversationId).title
    await page.goto('http://127.0.0.1:8889/#/pages/conversation-history/index', { waitUntil: 'networkidle' })
    await page.getByText(title, { exact: true }).first().click()
    await page.locator('.query-candidates__card').waitFor({ state: 'visible' })
    await capture('calculated-current-20mm')
    await post('加入方案', '/solution/activate')
    await page.getByText('选为最终方案', { exact: true }).first().click()
    await post('设为最终方案', '/solution/actions')
    await post('确认生成方案', '/solution/actions')
    const state = await getObservation(), snapshot = state.snapshots.find(item => item.conversation_id === conversationId)
    assert.ok(snapshot); assert.equal(snapshot.payload.candidates[0].calculationId, candidate.calculationId)
    assert.deepEqual(snapshot.payload.candidates[0].resultSnapshot, candidate.resultSnapshot)
    audit.snapshotId = snapshot.id; await capture('calculated-confirmed'); await save()
    const report = await post('生成技术方案 PDF', '/reports')
    audit.reportId = report.report.id; await save()
    for (let attempt = 0; attempt < 90; attempt++) {
      const current = (await getObservation()).reports.find(item => item.id === audit.reportId)
      if (current?.status === 'READY') { audit.reportStatus = 'READY'; break }
      if (current?.status === 'FAILED') throw Error(`实际PDF失败：${current.error_message}`)
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    assert.equal(audit.reportStatus, 'READY')
    assert.equal((await getObservation()).calculations.length, before.calculations.length)
    audit.calculationsUnchanged = true
    await page.goto(`http://127.0.0.1:8889/#/pages/report-detail/index?id=${audit.reportId}`, { waitUntil: 'networkidle' })
    await page.getByText('预览 PDF', { exact: true }).waitFor({ state: 'visible' })
    await capture('calculated-report-detail'); audit.status = 'PASS'; audit.finishedAt = new Date().toISOString(); await save()
    return { status: audit.status, reportStatus: audit.reportStatus, calculationsUnchanged: true }
  } catch (error) {
    audit.status = 'FAIL'; audit.error = clean(error.message); audit.finishedAt = new Date().toISOString(); await save(); await capture('calculated-report-failure').catch(() => {})
    return { status: audit.status, error: audit.error }
  }
}

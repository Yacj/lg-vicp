import { readFile, writeFile } from 'node:fs/promises'
import { getObservation, withModelsUnavailable, readModelState } from './observation.mjs?extras-v2'
export async function run({ context, page, capture, out, clean }) {
  const report = JSON.parse(await readFile(`${out}/extras.json`, 'utf8').catch(() => 'null')) ?? { startedAt: new Date().toISOString(), scope: '固定35轮之外的独立补测；不替换原失败', prompts: [], permissions: [] }
  const save = () => writeFile(`${out}/extras.json`, JSON.stringify(report, null, 2))
  const send = async (id, prompt, fresh = true) => {
    if (fresh) {
      await page.locator('[aria-label="新建对话"]').click()
      await page.waitForFunction(() => document.body.innerText.includes('你好，我是筑小格'))
    }
    const before = await getObservation()
    await page.locator('textarea').fill(prompt)
    const waiting = page.waitForResponse(response => response.request().method() === 'POST' && /\/conversations\/[^/]+\/messages$/.test(new URL(response.url()).pathname), { timeout: 30000 })
    await page.locator('[aria-label="发送消息"]').click()
    const response = await waiting
    await response.finished()
    const body = await response.text()
    await writeFile(`${out}/${id}.sse.txt`, clean(body))
    await page.waitForSelector('[aria-label="发送消息"]', { timeout: 20000 })
    const after = await getObservation()
    const conversationId = new URL(response.url()).pathname.split('/')[5]
    const priorIds = new Set(before.messages.map(message => message.id))
    const message = after.messages.filter(message => !priorIds.has(message.id) && message.conversation_id === conversationId && message.role === 'ASSISTANT').at(-1)
    const record = { id, userMessage: prompt, conversationId, httpStatus: response.status(), contentType: response.headers()['content-type'], transportError: body.startsWith('{') ? JSON.parse(body).error : undefined, answer: message?.content ?? null, decision: message?.metadata?.backendDecision ?? null, snapshotsDelta: after.snapshotCount - before.snapshotCount, reportsDelta: after.reports.length - before.reports.length, calculationDelta: after.calculations.length - before.calculations.length }
    report.prompts.push(record); await capture(id); await save()
    console.log(JSON.stringify({ extra: id, intent: record.decision?.domainIntent }))
    return record
  }
  if (!report.prompts.length) {
    await send('EX-VLCP', '介绍下VLCP产品。')
    await send('EX-TOPIC', '换个话题，介绍下VICP产品。', false)
    await withModelsUnavailable(async info => {
    report.missingModel = { ...info, faultScope: '仅本轮独立随机数据库的模型enabled开关', status: 'RUNNING' }
    try {
      const result = await send('EX-NO-MODEL', '按分层法计算芯材20mm的K，缺参数就说明缺项。', false)
      report.missingModel.status = result.calculationDelta === 0 && result.snapshotsDelta === 0 && result.reportsDelta === 0 ? 'REVIEW_REQUIRED' : 'FAIL'
    } catch (error) {
      report.missingModel.status = 'REVIEW_REQUIRED'
      report.missingModel.transportError = clean(error.message)
      await capture('EX-NO-MODEL-error')
    }
    })
  } else if (report.missingModel?.status === 'RUNNING') {
    await writeFile(`${out}/extras-before-observer-correction.json`, JSON.stringify(report, null, 2))
    const item = report.prompts.find(item => item.id === 'EX-NO-MODEL')
    item.answer = null; item.decision = null
    item.transportError = JSON.parse(await readFile(`${out}/EX-NO-MODEL.sse.txt`, 'utf8')).error
    report.missingModel.status = 'REVIEW_REQUIRED'
    report.observerCorrection = '缺模型返回非SSE业务错误且无新assistant消息；旧采集器误关联上一条产品回答，原记录另存，未重发用户问题。恢复设置后断言Result原型与Array不等；布尔值相同，由只读重验确认。'
  }
  report.missingModel.restoredModelState = await readModelState()
  report.missingModel.restored = report.missingModel.restoredModelState.every(model => model.enabled === true)
  await save()
  const state = await getObservation()
  const tokenB = (await (await fetch('http://127.0.0.1:3319/__uat/user-b')).json()).token
  const read = async (route, token) => {
    const response = await fetch(`http://127.0.0.1:3319${route}`, { headers: { Authorization: `Bearer ${token}` } })
    const data = await response.json()
    return { route, http: response.status, success: data.success, errorCode: data.error?.code }
  }
  report.permissions.push({ kind: 'B_OWN_LIST', ...await read('/api/v1/ai/conversations?clientApp=c_app', tokenB) })
  for (const conversation of state.conversations) report.permissions.push({ kind: 'OTHER_USER_CONVERSATION', ...await read(`/api/v1/ai/conversations/${conversation.id}`, tokenB) })
  const credentials = JSON.parse(await readFile('C:/Users/admin/AppData/Local/Temp/vicp-phase04-private-login.json', 'utf8'))
  const login = await (await fetch('http://127.0.0.1:3319/api/v1/auth/client/login/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...credentials, clientType: 'PC_AI' }) })).json()
  if (login.success) {
    report.permissions.push({ kind: 'PC_OWN_LIST', ...await read('/api/v1/ai/conversations?clientApp=pc_ai', login.data.accessToken) })
    for (const conversation of state.conversations) report.permissions.push({ kind: 'CROSS_CLIENT_CONVERSATION', ...await read(`/api/v1/ai/conversations/${conversation.id}`, login.data.accessToken) })
  } else report.permissions.push({ kind: 'PC_LOGIN', status: 'NOT_RUN', error: login.error })
  report.snapshotArtifactPermissions = state.snapshotCount ? 'REVIEW_REQUIRED' : 'NOT_RUN: 两条真实闭环均未生成Snapshot/PDF'
  await save()
  try {
    await context.setOffline(true)
    await page.locator('[aria-label="查看历史会话"]').click()
    await page.waitForFunction(() => /失败|网络|重试|暂时无法/.test(document.body.innerText), { timeout: 10000 }).catch(() => {})
    report.offline = { injected: '浏览器网络离线，真实界面读取历史', state: await capture('EX-OFFLINE') }
  } finally { await context.setOffline(false) }
  report.finishedAt = new Date().toISOString(); await save()
  return { extraUserTurns: report.prompts.length, permissions: report.permissions.length, modelSettingsRestored: report.missingModel.restored }
}

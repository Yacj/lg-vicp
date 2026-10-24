import { readFile, writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { getObservation } from './observation.mjs?config=2'
const packageRoot = 'C:/Users/admin/xwechat_files/zhai579670_8a65/msg/file/2026-10/小格AI阶段03修复交接包-v3/03-AI修复交接'
export async function run({ context, page, capture, out, clean }) {
  const mode = JSON.parse(await readFile(`${out}/run-mode.json`, 'utf8').catch(() => '{}'))
  if (mode.action === 'pdf') {
    const name = mode.artifactName ?? 'pdf-export'
    assert.match(name, /^[a-z-]+$/)
    const target = `${out}/${name}`
    await mkdir(target) // 不覆盖既有文件核验
    return (await import(`./pdf-audit.mjs?run=${Date.now()}`)).run({ context, page, capture: key => capture(`${name}-${key}`), out: target, clean })
  }
  if (mode.action === 'buttons') return (await import(`./button-flow.mjs?run=${Date.now()}`)).run({ context, page, capture, out, clean })
  if (mode.action === 'calculated-report') return (await import(`./calculated-report-flow.mjs?run=${Date.now()}`)).run({ context, page, capture, out, clean })
  if (mode.action === 'extras') return (await import(`./extras.mjs?run=${Date.now()}`)).run({ context, page, capture, out, clean })
  if (mode.action === 'ui') return (await import('./ui-audit.mjs')).run({ context, page, capture, out, clean })
  if (mode.action === 'table') return (await import('./table-audit.mjs')).run({ context, page, capture, out, clean })
  const frozenBytes = await readFile(`${packageRoot}/baseline/frozen-scenarios.json`)
  const frozen = JSON.parse(frozenBytes)
  const report = { startedAt: new Date().toISOString(), scope: '真实Edge/H5输入发送；当前源码与源库只读副本；模型HTTP/SSE无Mock', frozenSha256: createHash('sha256').update(frozenBytes).digest('hex'), reruns: 0, cases: [], uiActions: [] }
  const save = () => writeFile(`${out}/matrix.json`, clean(JSON.stringify(report, null, 2)))
  const backend = getObservation
  await backend() // 输入前核验全部观察字段；基础设施错误不记业务失败。
  const parseEvents = text => text.replaceAll('\r\n', '\n').split('\n\n').flatMap(block => {
    const lines = block.split('\n'), event = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!event || !data) return []
    try { return [{ event, data: JSON.parse(data) }] } catch { return [{ event, parseError: true }] }
  })
  for (const scenario of frozen.cases.filter(item => !mode.cases || mode.cases.includes(item.id))) {
    const item = { id: scenario.id, prompts: scenario.prompts, turns: [], status: 'RUNNING', chain: {} }
    report.cases.push(item); await save()
    await page.locator('[aria-label="新建对话"]').click()
    await page.waitForFunction(() => document.body.innerText.includes('你好，我是筑小格'), { timeout: 15000 })
    for (const [index, prompt] of scenario.prompts.entries()) {
      const key = `${scenario.id}-T${index + 1}`
      const turn = { turn: index + 1, userMessage: prompt, startedAt: new Date().toISOString(), status: 'RUNNING' }
      item.turns.push(turn); await save()
      const progress = setInterval(() => console.log(JSON.stringify({ progress: key, state: '等待真实模型及SSE完成' })), 30000)
      try {
        const before = await backend()
        await page.locator('textarea').fill(prompt)
        const waiting = page.waitForResponse(response => response.request().method() === 'POST' && /\/conversations\/[^/]+\/messages$/.test(new URL(response.url()).pathname), { timeout: 30000 })
        await page.locator('[aria-label="发送消息"]').click()
        const response = await waiting
        await Promise.race([response.finished(), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('SSE完成超时180秒')), 180000); timer.unref() })])
        const body = await response.text(), events = parseEvents(body)
        await writeFile(`${out}/${key}.sse.txt`, clean(body))
        await page.waitForSelector('[aria-label="发送消息"]', { timeout: 20000 })
        const state = await backend(), done = events.find(event => event.event === 'done')
        const conversationId = new URL(response.url()).pathname.split('/')[5]
        const message = state.messages.find(message => message.id === done?.data?.messageId)
          ?? state.messages.filter(message => message.conversation_id === conversationId && message.role === 'ASSISTANT').at(-1)
        Object.assign(turn, { conversationId, messageId: message?.id, httpStatus: response.status(), contentType: response.headers()['content-type'], submittedBody: response.request().postDataJSON(), events, answer: message?.content, backendDecision: message?.metadata?.backendDecision, snapshotsDelta: state.snapshotCount - before.snapshotCount, reportsDelta: state.reports.length - before.reports.length, calculationDelta: state.calculations.length - before.calculations.length, status: 'EXECUTED_REVIEW_REQUIRED', finishedAt: new Date().toISOString() })
        item.conversationId = conversationId
        await writeFile(`${out}/${key}.backend.json`, clean(JSON.stringify(state, null, 2)))
        await capture(key)
        console.log(JSON.stringify({ completed: key, intent: turn.backendDecision?.domainIntent, reason: turn.backendDecision?.policyReason, snapshotsDelta: turn.snapshotsDelta, reportsDelta: turn.reportsDelta }))
        if (['S5', 'R5'].includes(scenario.id) && index === 5) {
          const button = page.getByText('确认生成方案', { exact: true })
          const action = { case: scenario.id, action: 'UI_CONFIRM', beforeSnapshots: state.snapshotCount, status: 'NOT_RUN', reason: '界面无可用确认入口' }
          report.uiActions.push(action)
          if (await button.count() && await button.first().isVisible() && !/is-disabled/.test(await button.first().getAttribute('class') ?? '')) {
            const waitingAction = page.waitForResponse(response => /\/solution\/actions$/.test(new URL(response.url()).pathname), { timeout: 20000 })
            await button.first().click()
            const confirmed = await waitingAction
            const result = await confirmed.json()
            const after = await backend()
            Object.assign(action, { status: result.success && after.snapshotCount > state.snapshotCount ? 'EXECUTED_REVIEW_REQUIRED' : 'FAIL', result, afterSnapshots: after.snapshotCount })
            await capture(`${scenario.id}-UI-confirm`)
          }
          item.chain.confirm = action.status
        }
        if (['S5', 'R5'].includes(scenario.id) && index === 6) {
          const button = page.getByText('生成技术方案 PDF', { exact: true })
          const action = { case: scenario.id, action: 'UI_PDF', status: 'NOT_RUN', reason: '未形成已确认快照或无PDF入口' }
          report.uiActions.push(action)
          if (item.chain.confirm === 'EXECUTED_REVIEW_REQUIRED' && await button.count() && await button.first().isVisible()) {
            await button.first().click(); action.status = 'CLICKED_PENDING'; await capture(`${scenario.id}-UI-report`)
          }
          item.chain.pdf = action.status
        }
      } catch (error) {
        turn.status = 'FAIL'; turn.error = clean(error.message)
        await capture(`${key}-error`).catch(() => {})
        console.log(JSON.stringify({ failed: key, error: turn.error }))
      } finally { clearInterval(progress); await save() }
    }
    await capture(`${scenario.id}-final`)
    if (['R1', 'R2'].includes(scenario.id)) {
      await page.setViewportSize({ width: 390, height: 844 })
      await capture(`${scenario.id}-390`)
      const layout = await page.evaluate(() => ({ viewport: innerWidth, bodyWidth: document.body.scrollWidth, rootWidth: document.documentElement.scrollWidth, tables: [...document.querySelectorAll('table')].map(table => ({ width: table.getBoundingClientRect().width, scrollWidth: table.scrollWidth })) }))
      await writeFile(`${out}/${scenario.id}-390.layout.json`, JSON.stringify(layout, null, 2))
      await page.setViewportSize({ width: 1280, height: 900 })
    }
    item.status = item.turns.some(turn => turn.status === 'FAIL') ? 'EXECUTION_HAS_FAILURE' : 'EXECUTED_REVIEW_REQUIRED'
    await save()
  }
  report.finishedAt = new Date().toISOString()
  report.userTurns = report.cases.reduce((sum, item) => sum + item.turns.length, 0)
  await save()
  return { executed: report.userTurns, scenarios: report.cases.length, uiActions: report.uiActions.map(({case: scenario, action, status}) => ({case: scenario, action, status})) }
}

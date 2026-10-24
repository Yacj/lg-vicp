import { readFile, writeFile } from 'node:fs/promises'
export async function run({ context, page, capture, out, clean }) {
  const mode = JSON.parse(await readFile(`${out}/run-mode.json`, 'utf8').catch(() => '{}'))
  if (mode.action === 'customer') return (await import('./customer-query.mjs')).run({ context, page, capture, out, clean })
  if (mode.action === 'pdf') return (await import('./original/pdf-audit.mjs')).run({context,page,capture,out,clean})
  if (mode.action === 'ui') return (await import('./original/ui-audit.mjs')).run({page,capture,out})
  if (mode.action === 'table') return (await import('./original/table-audit.mjs')).run({page,capture,out})
  if (mode.action === 'single') return (await import('./single-flow.mjs?run=' + Date.now())).run({context,page,capture,out,clean})
  if (mode.action === 'explore') return (await import('./exploration.mjs')).run({page,capture,out,clean})
  if (mode.action === 'all') {
    const results = []
    for (const action of ['four', 'product', 'parameter', 'original35', 'explore', 'ui', 'table', 'single', 'pdf']) {
      await writeFile(`${out}/run-mode.json`, JSON.stringify({ action }))
      console.log(JSON.stringify({ phase: action, state: '开始真实页面复测' }))
      results.push({ phase: action, result: await run({ context, page, capture, out, clean }) })
    }
    await writeFile(`${out}/all-execution.json`, JSON.stringify(results, null, 2))
    return results.map(({ phase }) => ({ phase, executed: true, reviewRequired: true }))
  }
  if (mode.action === 'product') return (await import('./product-chain.mjs')).run({ page, capture, out, clean })
  if (mode.action === 'parameter') return (await import('./product-chain.mjs')).run({ page, capture, out, clean, parameterMode: true })
  if (mode.action === 'original35') return (await import('./original/matrix.mjs')).run({ context, page, capture, out, clean })
  const original = JSON.parse(await readFile('D:/work/lg-vicp/backend/docs/ai/evidence/conversation-integrity-2026-10-20/production-original-cases.json', 'utf8'))
  const report = { environment: '隔离真实资料副本 + 真实H5 + 当前DeepSeek Chat，未修改原问', cases: [], startedAt: new Date().toISOString() }
  const save = () => writeFile(`${out}/four-original-cases.json`, clean(JSON.stringify(report, null, 2)))
  const parse = text => text.replaceAll('\r\n', '\n').split('\n\n').flatMap(block => {
    const lines = block.split('\n'), event = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!event || !data) return []
    try { return [{ event, data: JSON.parse(data) }] } catch { return [{ event, invalidJson: true }] }
  })
  async function turn(prompt, key) {
    await page.locator('textarea').fill(prompt)
    const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && /\/conversations\/[^/]+\/messages$/.test(new URL(response.url()).pathname), { timeout: 30000 })
    await page.locator('[aria-label="发送消息"]').click()
    const response = await responsePromise
    const timer = setInterval(() => console.log(JSON.stringify({ waiting: key, realModel: true })), 30000)
    try {
      await response.finished()
      const text = await response.text(), events = parse(text)
      await writeFile(`${out}/${key}.sse.txt`, clean(text))
      await page.waitForSelector('[aria-label="发送消息"]', { timeout: 30000 })
      const state = await (await fetch('http://127.0.0.1:4339/__uat/evidence')).json()
      const done = events.find(event => event.event === 'done')
      const message = state.messages.find(message => message.id === done?.data?.messageId)
      await capture(key)
      return { prompt, httpStatus: response.status(), messageId: message?.id, answer: message?.content,
        backendDecision: message?.metadata?.backendDecision, events, status: 'EXECUTED_REVIEW_REQUIRED' }
    } finally { clearInterval(timer) }
  }
  for (const [index, scenario] of original.cases.entries()) {
    const item = { key: `G${index + 1}`, productionConversationId: scenario.id, turns: [] }
    report.cases.push(item)
    await page.locator('[aria-label="新建对话"]').click()
    await page.waitForFunction(() => document.body.innerText.includes('你好，我是筑小格'), { timeout: 15000 })
    const prompts = scenario.messages.filter(message => message.role === 'USER').slice(0, index === 2 ? 1 : 2).map(message => message.content)
    for (const [turnIndex, prompt] of prompts.entries()) {
      const key = `${item.key}-T${turnIndex + 1}`
      try { item.turns.push(await turn(prompt, key)) }
      catch (error) { item.turns.push({ prompt, status: 'FAIL', error: clean(error.message) }) }
      await save()
      console.log(JSON.stringify({ completed: key, intent: item.turns.at(-1).backendDecision?.domainIntent, reason: item.turns.at(-1).backendDecision?.policyReason }))
    }
  }
  report.finishedAt = new Date().toISOString()
  await save()
  return report.cases.map(item => ({ key: item.key, turns: item.turns.length, review: true }))
}

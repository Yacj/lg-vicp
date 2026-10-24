import { readFile, writeFile } from 'node:fs/promises'
export async function run({ page, capture, out, clean }) {
  const mode = JSON.parse(await readFile(`${out}/run-mode.json`, 'utf8'))
  const questions = mode.questions ?? ['保温板自身热阻 有传热8.3的保温板么']
  const report = { liveH5: true, realUpstream: true, startedAt: new Date().toISOString(), turns: [] }
  await page.locator('[aria-label="新建对话"]').click()
  await page.waitForFunction(() => document.body.innerText.includes('你好，我是筑小格'))
  for (const [index, question] of questions.entries()) {
    const key = `C1-T${index + 1}`
    await page.locator('textarea').fill(question)
    const waiting = page.waitForResponse(r => r.request().method() === 'POST' && /\/conversations\/[^/]+\/messages$/.test(new URL(r.url()).pathname))
    await page.locator('[aria-label="发送消息"]').click()
    const response = await waiting
    await response.finished()
    await writeFile(`${out}/${key}.sse.txt`, clean(await response.text()))
    await page.waitForSelector('[aria-label="发送消息"]')
    const state = await (await fetch('http://127.0.0.1:4339/__uat/evidence')).json()
    const conversationId = new URL(response.url()).pathname.split('/')[5]
    const message = state.messages.filter(m => m.conversation_id === conversationId && m.role === 'ASSISTANT').at(-1)
    report.turns.push({ question, conversationId, answer: message?.content, metadata: message?.metadata, httpStatus: response.status(), status: 'EXECUTED_REVIEW_REQUIRED' })
    await capture(key)
    await writeFile(`${out}/customer-query.json`, clean(JSON.stringify(report, null, 2)))
    console.log(JSON.stringify({ completed: key, intent: message?.metadata?.backendDecision?.domainIntent }))
  }
  await writeFile(`${out}/backend-evidence.json`, clean(JSON.stringify(await (await fetch('http://127.0.0.1:4339/__uat/evidence')).json(), null, 2)))
  return { executed: report.turns.length, reviewRequired: true }
}

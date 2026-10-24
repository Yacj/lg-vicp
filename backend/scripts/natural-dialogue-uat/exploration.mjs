import { writeFile } from 'node:fs/promises'
export async function run({ page, capture, out, clean, parameterMode = false }) {
  const questions = ['先帮我认认，III型VICP复合保温板（真空绝热板）是什么', '别列那么多，用我能听懂的话说', '那这个板有什么参数能查', '导热那个数是什么意思呀', '先不看这个了，介绍一下石墨聚苯板', '它的导热数值在哪页能看到', '那还有比它低的么'];
  const report = { scope: '源码冻结后补充探索；同一执行者编写，不冒称独立人工盲测', startedAt: new Date().toISOString(), turns: [] }
  await page.locator('[aria-label="新建对话"]').click()
  await page.waitForFunction(() => document.body.innerText.includes('你好，我是筑小格'), { timeout: 15000 })
  for (const [index, question] of questions.entries()) {
    const key = `E1-T${index + 1}`
    await page.locator('textarea').fill(question)
    const waiting = page.waitForResponse(response => response.request().method() === 'POST' && /\/conversations\/[^/]+\/messages$/.test(new URL(response.url()).pathname), { timeout: 30000 })
    await page.locator('[aria-label="发送消息"]').click()
    const response = await waiting
    const timer = setInterval(() => console.log(JSON.stringify({ waiting: key })), 30000)
    try {
      await response.finished()
      const text = await response.text()
      await writeFile(`${out}/${key}.sse.txt`, clean(text))
      await page.waitForSelector('[aria-label="发送消息"]', { timeout: 30000 })
      const state = await (await fetch('http://127.0.0.1:4339/__uat/evidence')).json()
      const conversationId = new URL(response.url()).pathname.split('/')[5]
      const message = state.messages.filter(message => message.conversation_id === conversationId && message.role === 'ASSISTANT').at(-1)
      report.turns.push({ question, answer: message?.content, metadata: message?.metadata, httpStatus: response.status(), status: 'EXECUTED_REVIEW_REQUIRED' })
      await capture(key)
      console.log(JSON.stringify({ completed: key, intent: message?.metadata?.backendDecision?.domainIntent, reason: message?.metadata?.backendDecision?.policyReason }))
    } catch (error) { report.turns.push({ question, error: clean(error.message), status: 'FAIL' }) }
    finally {
      clearInterval(timer)
      await writeFile(`${out}/exploration.json`, clean(JSON.stringify(report, null, 2)))
    }
  }
  return report.turns.map((turn, index) => ({ turn: index + 1, status: turn.status }))
}

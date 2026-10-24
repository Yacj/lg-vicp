import { writeFile } from 'node:fs/promises'
export async function run({ page, capture, out, clean, parameterMode = false }) {
  const questions = parameterMode
    ? ['只查正式材料参数，导热系数小于0.01', '改成0.02', '改成大于0.2', '换个话题，热阻是什么', '改成0.03']
    : ['介绍一下I型VICP复合保温板', '这个产品的导热系数是多少', '这个参数还有哪些产品', '我想找导热系数相同的其他产品', '有哪些比它更低的']
  const report = { scope: '用户授权的知识库产品连续咨询，真实H5/DeepSeek；非原35问', startedAt: new Date().toISOString(), turns: [] }
  await page.locator('[aria-label="新建对话"]').click()
  await page.waitForFunction(() => document.body.innerText.includes('你好，我是筑小格'), { timeout: 15000 })
  for (const [index, question] of questions.entries()) {
    const key = `${parameterMode ? 'P2' : 'P1'}-T${index + 1}`
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
      await writeFile(`${out}/${parameterMode ? 'parameter-continuation' : 'product-chain'}.json`, clean(JSON.stringify(report, null, 2)))
    }
  }
  return report.turns.map((turn, index) => ({ turn: index + 1, status: turn.status }))
}

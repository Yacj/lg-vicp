import { chromium } from 'playwright-core'
import { readFile, writeFile } from 'node:fs/promises'
import readline from 'node:readline'
const out = 'D:/work/lg-vicp/backend/docs/ai/evidence/phase04-retest-2026-10-19/h5-run-02'
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }))
const clean = text => String(text).replace(/https?:[^\s"<>]+/g, url => url.split('?')[0]).replace(/Bearer\s+[\w.-]+/gi, 'Bearer [REDACTED]')
page.on('console', event => { if (['error', 'warning'].includes(event.type())) errors.push({ type: event.type(), message: clean(event.text()) }) })
async function capture(name) {
  const state = await page.evaluate(() => ({ url: location.href, text: document.body.innerText, inputs: [...document.querySelectorAll('input,textarea')].map(e => ({ tag: e.tagName, placeholder: e.getAttribute('placeholder'), type: e.getAttribute('type') })), buttons: [...document.querySelectorAll('button,[aria-label],[role=checkbox]')].map(e => ({ text: e.innerText, label: e.getAttribute('aria-label'), role: e.getAttribute('role'), class: e.className })) }))
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false })
  await writeFile(`${out}/${name}.dom.json`, JSON.stringify(state, null, 2))
  await writeFile(`${out}/${name}.console.json`, JSON.stringify(errors, null, 2))
  return state
}
async function command(cmd) {
  if (cmd.action === 'login') {
    const credentials = JSON.parse(await readFile('C:/Users/admin/AppData/Local/Temp/vicp-phase04-private-login.json', 'utf8'))
    await page.goto('http://127.0.0.1:8879/#/pages/login', { waitUntil: 'networkidle' })
    await page.locator('input[type=number]').fill(credentials.phone)
    await page.locator('input[type=password]').fill(credentials.password)
    await page.locator('.wd-checkbox').click()
    const waiting = page.waitForResponse(response => response.url().includes('/auth/client/login/password'))
    await page.getByText('登录', { exact: true }).click()
    if (!(await (await waiting).json()).success) throw new Error('隔离测试账号登录失败')
    await page.goto('http://127.0.0.1:8879/', { waitUntil: 'networkidle' })
    await page.getByText('去问问筑小格', { exact: true }).first().click()
    await page.locator('textarea').waitFor({ state: 'visible' })
    return await capture('assistant-authenticated')
  }
  if (cmd.action === 'goto') await page.goto(cmd.url, { waitUntil: 'networkidle', timeout: 120000 })
  if (cmd.action === 'click') {
    const target = cmd.selector ? page.locator(cmd.selector) : page.getByText(cmd.text, { exact: true })
    await target.first().click({ timeout: 15000 })
  }
  if (cmd.action === 'credentials') {
    const credentials = JSON.parse(await readFile('C:/Users/admin/AppData/Local/Temp/vicp-phase04-private-login.json', 'utf8'))
    await page.locator('input[type=number]').fill(credentials.phone)
    await page.locator('input[type=password]').fill(credentials.password)
    return { ready: true, credentialsPrinted: false }
  }
  if (cmd.action === 'viewport') await page.setViewportSize(cmd.viewport)
  if (cmd.action === 'run') return await runMatrix()
  if (cmd.action === 'exit') { await browser.close(); process.exit(0) }
  return await capture(cmd.name ?? 'browser-state')
}
async function runMatrix() { return (await import(`./matrix.mjs?run=${Date.now()}`)).run({ context, page, capture, out, clean }) }
const rl = readline.createInterface({ input: process.stdin, terminal: false })
console.log(JSON.stringify({ ready: true, browser: 'Edge', mode: '真实H5/独立浏览器上下文' }))
for await (const line of rl) {
  try { console.log(JSON.stringify({ result: await command(JSON.parse(line)) })) }
  catch (error) { console.log(JSON.stringify({ error: error.name, message: clean(error.message) })) }
}
await browser.close()

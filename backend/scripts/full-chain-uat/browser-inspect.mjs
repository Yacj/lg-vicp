import { chromium } from 'playwright-core'
import { writeFile } from 'node:fs/promises'
const out = 'D:/work/lg-vicp/backend/docs/ai/evidence/phase04-retest-2026-10-19/h5-run-01'
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto('http://127.0.0.1:8889/', { waitUntil: 'networkidle', timeout: 120000 })
  await page.screenshot({ path: `${out}/initial.png`, fullPage: true })
  const state = await page.evaluate(() => ({ url: location.href, text: document.body.innerText, inputs: [...document.querySelectorAll('input,textarea')].map(e => ({ tag: e.tagName, placeholder: e.getAttribute('placeholder'), type: e.getAttribute('type') })), buttons: [...document.querySelectorAll('button,[aria-label]')].map(e => ({ text: e.innerText, label: e.getAttribute('aria-label') })) }))
  await writeFile(`${out}/initial-dom.json`, JSON.stringify(state, null, 2))
  console.log(JSON.stringify(state))
} finally { await browser.close() }

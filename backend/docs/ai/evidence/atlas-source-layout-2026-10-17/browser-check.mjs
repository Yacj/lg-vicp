import fs from 'node:fs'
import { chromium } from 'playwright-core'
const out = import.meta.dirname
const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p))
if (!executablePath) throw Error('未找到可运行的浏览器')
const browser = await chromium.launch({ executablePath, headless: true })
const results = []
const errors = []
try {
  const b = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  b.on('pageerror', error => errors.push({ client: 'B', message: error.message }))
  await b.goto('http://127.0.0.1:5299')
  await b.locator('tbody .construction-diagram').first().waitFor()
  for (const page of [53, 22, 90, 89, 75]) {
    await b.locator('select').selectOption(String(page))
    await b.waitForFunction(n => document.querySelector('main > p:nth-of-type(2)')?.textContent?.includes(n), String(page))
    await b.screenshot({ path: `${out}/b-${page}-1440.png`, fullPage: true })
    results.push(await b.evaluate(() => ({ client: 'B', width: innerWidth, heading: document.querySelector('h2')?.textContent, codes: [...document.querySelectorAll('tbody .construction-code')].map(el => el.textContent), optionRows: document.querySelectorAll('tr[data-option-id]').length, materialNames: [...document.querySelectorAll('tbody .construction-material')].map(el => el.textContent), tableHeaders: document.querySelector('thead')?.textContent })))
  }
  await b.locator('select').selectOption('53')
  await b.getByRole('button', { name: '切换原图 / 表格' }).click()
  await b.locator('main > img').waitFor()
  await b.waitForFunction(() => document.querySelector('main > img')?.naturalWidth > 0)
  await b.screenshot({ path: `${out}/b-53-original.png`, fullPage: true })
  await b.close()
  for (const width of [320, 375, 430]) {
    const h = await browser.newPage({ viewport: { width, height: 900 }, isMobile: true, deviceScaleFactor: 1, hasTouch: true })
    h.on('pageerror', error => errors.push({ client: 'H5', width, message: error.message }))
    await h.goto('http://127.0.0.1:5298')
    await h.locator('.thermal-table__body').first().waitFor()
    for (const page of [53, 22, 90, 89, 75]) {
      await h.getByText(String(page), { exact: true }).click()
      await h.waitForFunction(n => document.body.textContent.includes('印刷页码 '+n), String(page))
      await h.screenshot({ path: `${out}/h5-${page}-${width}-left.png`, fullPage: true })
      results.push(await h.evaluate(() => ({ client: 'H5', width: innerWidth, groups: [...document.querySelectorAll('.thermal-table__body')].map(g => ({ code: g.querySelector('.thermal-table__code')?.textContent, materialNames: [...g.querySelectorAll('.thermal-table__material')].map(el => el.textContent), cells: [...g.querySelectorAll('.thermal-table__cell')].map(el => ({ text: el.textContent.trim(), col: el.style.gridColumn, row: el.style.gridRow })) })), tableHeaders: document.querySelector('.thermal-table__header')?.textContent, documentOverflow: document.documentElement.scrollWidth > innerWidth })))
      await h.locator('.thermal-table__body-scroll .uni-scroll-view').last().evaluate(el => { el.scrollLeft = el.scrollWidth; el.dispatchEvent(new Event('scroll')) })
      await h.waitForTimeout(300)
      const alignment = await h.evaluate(() => {
        const head = [...document.querySelectorAll('.thermal-table__head-scroll .uni-scroll-view')].at(-1)
        const body = [...document.querySelectorAll('.thermal-table__body-scroll .uni-scroll-view')].at(-1)
        return { head: head.scrollLeft, body: body.scrollLeft, difference: Math.abs(head.scrollLeft - body.scrollLeft) }
      })
      results.push({ client: 'H5', width, page, alignment })
      await h.screenshot({ path: `${out}/h5-${page}-${width}-right.png`, fullPage: true })
    }
    await h.getByText('53', { exact: true }).click()
    await h.getByText('展开构造简图说明', { exact: true }).click()
    await h.locator('.thermal-table__diagram').first().waitFor()
    await h.screenshot({ path: `${out}/h5-53-${width}-diagram.png`, fullPage: true })
    await h.close()
  }
} finally {
  await browser.close()
  fs.writeFileSync(`${out}/browser.json`, JSON.stringify({ scope: '正式 B 与 UniApp H5 组件 + 人工核对 Fixture；本地原图；非生产HTTP/SSE/OSS/原生App', results, errors }, null, 2))
}
if (errors.length) process.exitCode = 1

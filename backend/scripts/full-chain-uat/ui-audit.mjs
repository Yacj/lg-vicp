import { readFile, writeFile } from 'node:fs/promises'
import { getObservation } from './observation.mjs?ui-v3'
export async function run({ page, capture, out }) {
  const report = { startedAt: new Date().toISOString(), checks: [], pixelHighlight: 'NOT_RUN: 原资料未提供核验坐标，界面明确说明未像素框选' }
  const save = () => writeFile(`${out}/ui-audit.json`, JSON.stringify(report, null, 2))
  const matrix = JSON.parse(await readFile(`${out}/matrix.json`, 'utf8'))
  const state = await getObservation()
  async function history(caseId, name) {
    const id = matrix.cases.find(item => item.id === caseId).conversationId
    const title = state.conversations.find(item => item.id === id).title
    await page.goto(`http://127.0.0.1:8889/?uat=${name}#/pages/conversation-history/index`, { waitUntil: 'networkidle' })
    await page.getByText(title, { exact: true }).click()
    await page.locator('textarea').waitFor({ state: 'visible' })
  }
  await history('R1', 'r1table2')
  await page.getByText('全屏看表格', { exact: true }).first().click()
  await page.getByText('完整表格', { exact: true }).waitFor()
  await page.locator('.thermal-table__row--active').waitFor()
  const wide = await capture('R1-table-fullscreen-verified')
  const table = await page.evaluate(() => ({ layout: 'CSS Grid', rows: [...document.querySelectorAll('.thermal-table__row--hit')].map(row => ({ class: row.className, text: row.innerText, background: getComputedStyle(row).backgroundColor })), gridRows: document.querySelectorAll('.thermal-table__row').length }))
  report.checks.push({ id: 'R1_TABLE', state: wide.text.slice(-3000), table, status: 'REVIEW_REQUIRED' }); await save()
  await page.setViewportSize({ width: 390, height: 844 })
  await capture('R1-table-fullscreen-390')
  report.narrow = await page.evaluate(() => ({ viewport: innerWidth, bodyWidth: document.body.scrollWidth, rootWidth: document.documentElement.scrollWidth }))
  await page.setViewportSize({ width: 1280, height: 900 })
  await history('R1', 'r1source6')
  await page.getByText('查看参考页', { exact: true }).nth(1).click()
  await page.waitForFunction(() => document.body.innerText.includes('原始页面'))
  await page.waitForFunction(() => [...document.images].some(image => image.naturalWidth > 200), { timeout: 15000 }).catch(() => {})
  const source6 = await capture('R1-source-page6')
  report.checks.push({ id: 'R1_SECOND_SOURCE', text: source6.text, images: await page.evaluate(() => [...document.images].map(image => ({ width: image.naturalWidth, height: image.naturalHeight }))), status: 'REVIEW_REQUIRED' }); await save()
  await history('R2', 'r2source')
  await page.getByText('查看参考页', { exact: true }).first().click()
  await page.waitForFunction(() => document.body.innerText.includes('原始页面'))
  await page.waitForFunction(() => [...document.images].some(image => image.naturalWidth > 200), { timeout: 15000 }).catch(() => {})
  const roof = await capture('R2-source-original')
  report.checks.push({ id: 'R2_SOURCE', text: roof.text, images: await page.evaluate(() => [...document.images].map(image => ({ width: image.naturalWidth, height: image.naturalHeight }))), status: 'REVIEW_REQUIRED' })
  await page.getByText('全屏查看', { exact: true }).click()
  await capture('R2-source-fullscreen')
  await page.setViewportSize({ width: 390, height: 844 }); await capture('R2-source-fullscreen-390')
  await page.setViewportSize({ width: 1280, height: 900 })
  report.finishedAt = new Date().toISOString(); await save()
  return { checks: report.checks.length, pixelHighlight: report.pixelHighlight }
}

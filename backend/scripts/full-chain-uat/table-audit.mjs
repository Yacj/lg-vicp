import { readFile, writeFile } from 'node:fs/promises'
import { getObservation } from './observation.mjs?table-v3'
export async function run({ page, capture, out }) {
  const result = { startedAt: new Date().toISOString(), note: '保留上次导航中间态空白截图；本次等待完整表格及高亮控件后再采样。表格使用CSS Grid，不以tr元素计数。', pages: [] }
  const matrix = JSON.parse(await readFile(`${out}/matrix.json`, 'utf8'))
  const id = matrix.cases.find(item => item.id === 'R1').conversationId
  const title = (await getObservation()).conversations.find(item => item.id === id).title
  for (const index of [0, 1]) {
    await page.goto(`http://127.0.0.1:8889/?uat=table-final-${index}#/pages/conversation-history/index`, { waitUntil: 'networkidle' })
    await page.getByText(title, { exact: true }).first().click()
    await page.getByText('全屏看表格', { exact: true }).nth(index).click()
    await page.getByText('完整表格', { exact: true }).waitFor()
    await page.getByText('取消高亮', { exact: true }).waitFor()
    await page.locator('.thermal-table__row--active').waitFor()
    const name = index ? 'R1-table-page6' : 'R1-table-page5'
    const state = await capture(`${name}-complete`)
    const first = await page.evaluate(() => ({ hits: document.querySelectorAll('.thermal-table__row--hit').length, active: document.querySelectorAll('.thermal-table__row--active').length, fields: [...document.querySelectorAll('.thermal-table__field--hit')].map(item => item.innerText) }))
    await page.getByText('下一处', { exact: true }).click()
    const next = await capture(`${name}-next`)
    await page.getByText('取消高亮', { exact: true }).click()
    const off = await page.evaluate(() => ({ hits: document.querySelectorAll('.thermal-table__row--hit').length, active: document.querySelectorAll('.thermal-table__row--active').length }))
    await page.getByText('显示高亮', { exact: true }).click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('.thermal-table__row--active').waitFor()
    await capture(`${name}-390-complete`)
    const narrow = await page.evaluate(() => ({ viewport: innerWidth, bodyWidth: document.body.scrollWidth, rootWidth: document.documentElement.scrollWidth }))
    result.pages.push({ index, headingBefore: state.text.slice(0, 220), headingAfter: next.text.slice(0, 220), first, off, narrow })
    await page.setViewportSize({ width: 1280, height: 900 })
  }
  result.finishedAt = new Date().toISOString()
  await writeFile(`${out}/table-audit-complete.json`, JSON.stringify(result, null, 2))
  return result
}

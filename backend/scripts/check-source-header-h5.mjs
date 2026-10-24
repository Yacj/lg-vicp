import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
const out = 'docs/ai/evidence/table-header-repair-2026-10-19'
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const checks = [], errors = [], blocked = []
let currentPage
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.protocol === 'data:' || url.origin === 'http://127.0.0.1:8881') return route.continue()
      blocked.push(`${url.origin}${url.pathname}`); return route.abort()
    })
    const page = await context.newPage()
    currentPage = page
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', event => { if (event.type() === 'error') errors.push(event.text().replace(/https?:[^\s]+/g, url => url.split('?')[0])) })
    // 临时影子App复用已注册的页面入口，内容仅为实际组件+只读快照Fixture。
    await page.goto('http://127.0.0.1:8881/#/pages/reference-table/index', { waitUntil: 'networkidle', timeout: 120000 })
    // 仅核验H5显示组件；直接挂载影子Fixture，隔离不相关的路由条件编译。
    await page.evaluate(async () => {
      const runtime = performance.getEntriesByType('resource').find(entry => entry.name.includes('/@dcloudio/uni-h5-vue/dist/vue.runtime.esm.js'))?.name
      if (!runtime) throw new Error('未加载实际uni H5 Vue运行时')
      const vue = await import(runtime)
      const fixture = await import('/src/pages/reference-table/index.vue')
      const root = document.createElement('div')
      document.body.replaceChildren(root)
      vue.createApp(fixture.default).mount(root)
    })
    await page.locator('.thermal-table__header').waitFor({ timeout: 45000 })
    for (const table of [5, 33, 77]) {
      await page.getByText(`原表${table}`, { exact: true }).click()
      await page.waitForFunction(group => document.querySelector('.thermal-table__header')?.textContent?.includes(group), table === 77 ? '板材主断面' : '外墙主断面')
      for (const fullscreen of [false, true]) {
        if (fullscreen) await page.getByText('全屏看表格', { exact: true }).click()
        const headers = await page.locator('.thermal-table__heading').allTextContents()
        assert.equal(headers.length, 9)
        for (const label of ['热阻', '传热阻R', '传热系数K', table === 77 ? '板材主断面' : '外墙主断面']) assert(headers.some(text => text.trim().startsWith(label)), label)
        assert(!headers.some(text => /源文待核|语义待核|材料层热阻|产品整体热阻|导热系数 λ/.test(text)))
        assert.equal(await page.locator('.thermal-table__field--hit').count(), 4)
        const measured = await page.evaluate(() => {
          const head = document.querySelector('.thermal-table__header'), body = document.querySelector('.thermal-table__body')
          const headCells = [...head.querySelectorAll('.thermal-table__heading')].filter(item => item.style.gridRow !== '1')
          return { viewport: innerWidth, rootWidth: document.documentElement.scrollWidth, headWidth: head.getBoundingClientRect().width, bodyWidth: body.getBoundingClientRect().width, headerColumns: getComputedStyle(head).gridTemplateColumns.split(' ').length, bodyColumns: getComputedStyle(body).gridTemplateColumns.split(' ').length, emptyHeaders: headCells.filter(item => !item.textContent.trim()).length }
        })
        assert(measured.rootWidth <= width + 1, '整页不能横向溢出')
        assert(Math.abs(measured.headWidth - measured.bodyWidth) < 1, '表头正文总宽一致')
        assert.equal(measured.headerColumns, 8); assert.equal(measured.bodyColumns, 8)
        assert.equal(measured.emptyHeaders, 0)
        if (width === 390) {
          await page.locator('.thermal-table__body-scroll .uni-scroll-view').last().evaluate(element => { element.scrollLeft = 325; element.dispatchEvent(new Event('scroll')) })
          await page.waitForFunction(() => {
            const head = [...document.querySelectorAll('.thermal-table__head-scroll .uni-scroll-view')].at(-1), body = [...document.querySelectorAll('.thermal-table__body-scroll .uni-scroll-view')].at(-1)
            return body.scrollLeft > 100 && Math.abs(head.scrollLeft - body.scrollLeft) <= 1
          })
        }
        const cells = await page.locator('.thermal-table__field--hit').allTextContents()
        await page.screenshot({ path: `${out}/table-${table}-${width}-${fullscreen ? 'fullscreen' : 'inline'}.png`, fullPage: false })
        checks.push({ table, width, fullscreen, headers: headers.map(item => item.trim()), ...measured, highlighted: cells.map(item => item.trim()), screenshot: `table-${table}-${width}-${fullscreen ? 'fullscreen' : 'inline'}.png` })
        if (fullscreen) await page.getByText('退出全屏', { exact: true }).last().click()
      }
      await page.getByText('取消高亮', { exact: true }).click()
      assert.equal(await page.locator('.thermal-table__field--hit').count(), 0)
      await page.getByText('恢复高亮', { exact: true }).click()
      assert.equal(await page.locator('.thermal-table__field--hit').count(), 4)
    }
    await context.close()
  }
  assert.equal(errors.length, 0)
  await writeFile(`${out}/h5-display-checks.json`, JSON.stringify({ status: 'PASS', mode: '真实H5组件/原确认快照Fixture；非真实模型、查询或完整35轮UAT', productionRequests: 0, checks, errors, blocked }, null, 2))
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length, errors: errors.length, productionRequests: 0 }))
} catch (error) {
  if (currentPage) {
    await currentPage.screenshot({ path: `${out}/h5-precheck-failure.png` })
    await writeFile(`${out}/h5-precheck-failure.dom.txt`, `${currentPage.url()}\n${await currentPage.locator('body').innerText()}`)
  }
  await writeFile(`${out}/h5-display-failure.json`, JSON.stringify({ message: error.message, checks, errors, blocked }, null, 2)); throw error
} finally { await browser.close() }

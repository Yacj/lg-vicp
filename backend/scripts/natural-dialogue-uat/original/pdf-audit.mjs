import { writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
export async function run({ context, page, capture, out, clean }) {
  const expectedReportId = new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('id')
  assert.ok(expectedReportId, 'PDF核验必须绑定详情页请求的报告ID')
  const evidence = { transport: '真实H5报告详情按钮与实际签名文件请求', expectedReportId, startedAt: new Date().toISOString(), operations: [] }
  for (const [mode, label] of [['preview', '预览 PDF'], ['download', '下载 PDF']]) {
    let resolveDownload
    const downloaded = new Promise(resolve => { resolveDownload = resolve })
    const downloadPages = [page]
    const onDownload = download => resolveDownload(download)
    const onPage = popup => { downloadPages.push(popup); popup.on('download', onDownload) }
    page.on('download', onDownload); context.on('page', onPage)
    const requestFailures = []
    const failure = request => requestFailures.push({ url: clean(request.url()), failure: request.failure()?.errorText })
    context.on('requestfailed', failure)
    const browserPdfResponse = context.waitForEvent('response', { predicate: response => response.headers()['content-type']?.includes('application/pdf') === true, timeout: 25000 }).catch(() => null)
    const signedResponse = page.waitForResponse(response => response.url().includes(`/artifacts/PDF/${mode}-url`), { timeout: 20000 })
    const popupPromise = context.waitForEvent('page', { timeout: 20000 })
    await page.getByText(label, { exact: true }).click()
    const response = await signedResponse, result = await response.json(), popup = await popupPromise
    assert.ok(new URL(response.url()).pathname.includes(`/reports/${expectedReportId}/artifacts/`), '详情页实际操作的报告ID须与访问目标一致')
    if (!result.success || !result.data?.url) throw Error(`${mode} did not obtain authorized URL`)
    assert.ok(new URL(result.data.url).pathname.includes(`/reports/unassigned/${expectedReportId}/`), '实际文件必须属于目标报告')
    const actualBrowserResponse = await browserPdfResponse
    const fileResponse = await context.request.get(result.data.url)
    const bytes = await fileResponse.body()
    const item = { mode, apiStatus: response.status(), browserFileStatus: actualBrowserResponse?.status() ?? null, fileStatus: fileResponse.status(), contentType: fileResponse.headers()['content-type'], bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), pdfMagic: bytes.subarray(0, 5).toString() === '%PDF-', popupCreated: true }
    await writeFile(`${out}/real-h5-${mode}.pdf`, bytes)
    if (mode === 'download') {
      const download = await Promise.race([downloaded, new Promise(resolve => { const timer=setTimeout(()=>resolve(null),8000);timer.unref() })])
      item.browserDownloadCaptured = !!download
      if (download) {
        await download.saveAs(`${out}/real-browser-download.pdf`)
        const actual = await (await import('node:fs/promises')).readFile(`${out}/real-browser-download.pdf`)
        item.browserDownloadSha256 = createHash('sha256').update(actual).digest('hex')
        item.browserDownloadMatches = item.browserDownloadSha256 === item.sha256
        item.suggestedFilename = download.suggestedFilename()
      }
    }
    page.off('download',onDownload);context.off('page',onPage)
    for(const itemPage of downloadPages) itemPage.off('download',onDownload)
    await popup.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {})
    item.popupUrl = clean(popup.url())
    item.requestFailures = requestFailures
    context.off('requestfailed', failure)
    if (mode === 'preview') await popup.screenshot({ path: `${out}/pdf-preview-browser.png` }).then(() => { item.screenshot = 'pdf-preview-browser.png' }).catch(error => { item.browserCaptureError = clean(error.message) })
    await popup.close().catch(() => {})
    evidence.operations.push(item)
    await capture(`pdf-${mode}-after`)
  }
  evidence.finishedAt = new Date().toISOString()
  await writeFile(`${out}/pdf-ui-audit-02.json`, JSON.stringify(evidence, null, 2))
  return evidence
}

import { onScopeDispose, ref, watch } from 'vue'

export interface ReportPdfPage { pageNumber: number, pageCount: number, imageDataUrl: string, pdfSha256: string }
interface Context { visible: boolean, reportId: string, userId: string | null }

export function useReportPdfPages(context: () => Context, fetchPage: (id: string, page: number) => Promise<ReportPdfPage>) {
  const page = ref<ReportPdfPage | null>(null)
  const loading = ref(false)
  const error = ref('')
  const zoom = ref(100)
  const requestedPage = ref(1)
  let revision = 0
  let pdfHash = ''

  async function loadPage(number: number) {
    if (!context().visible || !context().userId || loading.value)
      return
    const requestRevision = ++revision
    const id = context().reportId
    const userId = context().userId
    const current = () => context().visible && revision === requestRevision && id === context().reportId && userId === context().userId
    loading.value = true
    requestedPage.value = number
    error.value = ''
    try {
      const value = await fetchPage(id, number)
      if (!current())
        return
      if (value.pageNumber !== number || value.pageCount < number || !value.imageDataUrl.startsWith('data:image/png;base64,'))
        throw new Error('这页暂时无法显示，请重试')
      if (pdfHash && value.pdfSha256 !== pdfHash)
        throw new Error('报告文件已更新，请关闭预览后重新打开')
      pdfHash = value.pdfSha256
      page.value = value
    }
    catch (cause) {
      if (current())
        error.value = cause instanceof Error ? cause.message : '页面加载失败，请重试或下载 PDF 查看'
    }
    finally {
      if (current())
        loading.value = false
    }
  }

  function reset() {
    revision++
    page.value = null
    pdfHash = ''
    error.value = ''
    loading.value = false
    zoom.value = 100
    requestedPage.value = 1
  }
  watch([() => context().visible, () => context().reportId, () => context().userId], () => {
    reset()
    if (context().visible)
      void loadPage(1)
  }, { immediate: true })
  onScopeDispose(reset)
  return { page, loading, error, zoom, requestedPage, loadPage }
}

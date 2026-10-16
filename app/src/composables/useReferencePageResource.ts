import type { AiReferencePage } from '@/api/reference-page'
import type { AiSourceDetail, AiSourceLocatorQuery } from '@/api/types'
import { computed, ref } from 'vue'

/** 来源页与图片续签共用现有网络层；限制一次自动续签，避免错误图片无限请求。 */
export function useReferencePageResource(input: () => { locator: AiSourceLocatorQuery, context?: AiReferencePage }, request: (locator: AiSourceLocatorQuery) => Promise<AiSourceDetail>) {
  const detail = ref<AiSourceDetail | null>(null)
  const status = ref<'loading' | 'ready' | 'error'>('loading')
  const errorMessage = ref('')
  const refreshingImage = ref(false)
  const imageFailed = ref(false)
  const imageRevision = ref(0)
  let sequence = 0
  let automaticRefreshUsed = false
  const pageImageUrl = computed(() => detail.value?.original.pageImageUrl || detail.value?.page?.pageImageUrl || '')

  async function fetchDetail(): Promise<'ready' | 'error' | 'stale'> {
    const revision = ++sequence
    const { locator, context } = input()
    try {
      const response = await request(locator)
      if (revision !== sequence)
        return 'stale'
      if (locator.pageId && response.page?.id !== locator.pageId)
        throw new Error('引用页面不一致')
      if (context && response.document.id !== context.page.documentId)
        throw new Error('引用资料不一致')
      if (context?.renderModel?.confirmedRevision && response.page?.renderModel?.confirmedRevision && context.renderModel.confirmedRevision !== response.page.renderModel.confirmedRevision)
        throw new Error('来源确认版本已变化，请返回对话重新查询')
      detail.value = response
      errorMessage.value = ''
      return 'ready'
    }
    catch (error) {
      if (revision !== sequence)
        return 'stale'
      const failure = error as { message?: unknown, data?: { requestId?: unknown, error?: { message?: unknown, code?: unknown } } }
      const message = failure?.data?.error?.message || failure?.message
      errorMessage.value = typeof message === 'string' ? message : '请求失败，请稍后重试'
      // 只记录来源定位和错误摘要，不输出令牌、完整响应或签名图片地址。
      console.warn('[ReferencePage] 来源详情加载失败', { documentId: locator.documentId, pageId: locator.pageId, sectionId: locator.sectionId, blockId: locator.blockId, chunkId: locator.chunkId, message: errorMessage.value, code: failure?.data?.error?.code, requestId: failure?.data?.requestId })
      return 'error'
    }
  }
  async function load(): Promise<void> {
    status.value = 'loading'
    errorMessage.value = ''
    const result = await fetchDetail()
    if (result === 'stale')
      return
    if (result === 'ready') {
      status.value = 'ready'
      automaticRefreshUsed = false
      imageFailed.value = false
    }
    else {
      status.value = 'error'
    }
  }
  async function recoverImage(manual = false): Promise<void> {
    if (refreshingImage.value)
      return
    imageFailed.value = true
    if (!manual && automaticRefreshUsed)
      return
    automaticRefreshUsed = true
    refreshingImage.value = true
    try {
      if (await fetchDetail() === 'ready') {
        imageRevision.value++
        imageFailed.value = !pageImageUrl.value
      }
    }
    finally {
      refreshingImage.value = false
    }
  }
  function imageLoaded(): void {
    imageFailed.value = false
  }
  function cancel(): void {
    sequence++
  }
  return { detail, status, errorMessage, pageImageUrl, refreshingImage, imageFailed, imageRevision, load, recoverImage, imageLoaded, cancel }
}

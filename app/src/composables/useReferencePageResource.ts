import type { AiReferencePage } from '@/api/reference-page'
import type { AiSourceDetail, AiSourceLocatorQuery } from '@/api/types'
import { computed, ref } from 'vue'

/** 来源页与图片续签共用现有网络层；限制一次自动续签，避免错误图片无限请求。 */
export function useReferencePageResource(input: () => { locator: AiSourceLocatorQuery, context?: AiReferencePage }, request: (locator: AiSourceLocatorQuery) => Promise<AiSourceDetail>) {
  const detail = ref<AiSourceDetail | null>(null)
  const status = ref<'loading' | 'ready' | 'error'>('loading')
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
      detail.value = response
      return 'ready'
    }
    catch {
      return revision === sequence ? 'error' : 'stale'
    }
  }
  async function load(): Promise<void> {
    status.value = 'loading'
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
  return { detail, status, pageImageUrl, refreshingImage, imageFailed, imageRevision, load, recoverImage, imageLoaded, cancel }
}

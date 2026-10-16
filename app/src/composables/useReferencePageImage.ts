import { ref } from 'vue'
import { resolveApiBaseURL } from '@/api/core/base-url'
import { useAuthStore } from '@/store/auth'

interface ReferenceImageInfo {
  path: string
  width: number
  height: number
}

interface ReferenceImageLocator { pageId: string, confirmedRevision?: string }
function releaseTemporaryImage(path: string) {
  // #ifdef H5
  if (path.startsWith('blob:')) URL.revokeObjectURL(path)
  // #endif
}
async function resolveImage(url: string, locator?: ReferenceImageLocator): Promise<ReferenceImageInfo> {
  // OSS 签名不依赖协议；已验证 HTTPS 可读取同一签名，避免移动端拦截 HTTP 图片。
  let src = url.replace(/^http:\/\/([^/?#]+\.oss-[^/?#]+\.aliyuncs\.com)(?=\/|$)/i, 'https://$1')
  if (locator?.pageId) {
    const accessToken = useAuthStore().accessToken
    if (!accessToken) throw new Error('请登录后查看原图')
    const revision = locator.confirmedRevision ? `?confirmedRevision=${encodeURIComponent(locator.confirmedRevision)}` : ''
    src = await new Promise<string>((resolve, reject) => uni.downloadFile({
      url: `${resolveApiBaseURL()}/api/v1/ai/knowledge/pages/${encodeURIComponent(locator.pageId)}/image${revision}`,
      header: { Authorization: `Bearer ${accessToken}` },
      success: response => response.statusCode === 200 && response.tempFilePath ? resolve(response.tempFilePath) : reject(new Error('原图读取被拒绝，请刷新来源或重新登录')),
      fail: reject,
    }))
  }
  return new Promise((resolve, reject) => {
    uni.getImageInfo({ src, success: resolve, fail: reject })
  })
}

/** 使用平台读取的图片路径展示和预览，明确区分加载中、无图和读取失败。 */
export function useReferencePageImage(request: (url: string, locator?: ReferenceImageLocator) => Promise<ReferenceImageInfo> = resolveImage) {
  const source = ref('')
  const status = ref<'loading' | 'ready' | 'error' | 'empty'>('empty')
  let sequence = 0

  async function load(url: string, locator?: ReferenceImageLocator): Promise<'ready' | 'error' | 'empty' | 'stale'> {
    const revision = ++sequence
    releaseTemporaryImage(source.value)
    source.value = ''
    if (!url) {
      status.value = 'empty'
      return 'empty'
    }
    status.value = 'loading'
    try {
      const image = await request(url, locator)
      if (revision !== sequence) {
        releaseTemporaryImage(image.path)
        return 'stale'
      }
      if (!image.path || image.width <= 0 || image.height <= 0)
        throw new Error('图片内容不可读取')
      source.value = image.path
      status.value = 'ready'
      return 'ready'
    }
    catch (error) {
      if (revision !== sequence)
        return 'stale'
      status.value = 'error'
      const failure = error as { errMsg?: string, message?: string }
      const message = failure?.errMsg || failure?.message || '图片读取失败'
      console.warn('[ReferencePageImage] 图片读取失败', message.replace(/https?:\/\/\S+/g, '[图片地址]'))
      return 'error'
    }
  }

  function failed() {
    releaseTemporaryImage(source.value)
    source.value = ''
    status.value = 'error'
  }

  function cancel() {
    sequence++
    releaseTemporaryImage(source.value)
  }

  return { source, status, load, failed, cancel }
}

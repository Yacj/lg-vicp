import { ref } from 'vue'

interface ReferenceImageInfo {
  path: string
  width: number
  height: number
}

function resolveImage(url: string): Promise<ReferenceImageInfo> {
  // OSS 签名不依赖协议；已验证 HTTPS 可读取同一签名，避免移动端拦截 HTTP 图片。
  const src = url.replace(/^http:\/\/([^/?#]+\.oss-[^/?#]+\.aliyuncs\.com)(?=\/|$)/i, 'https://$1')
  return new Promise((resolve, reject) => {
    uni.getImageInfo({ src, success: resolve, fail: reject })
  })
}

/** 使用平台读取的图片路径展示和预览，明确区分加载中、无图和读取失败。 */
export function useReferencePageImage(request: (url: string) => Promise<ReferenceImageInfo> = resolveImage) {
  const source = ref('')
  const status = ref<'loading' | 'ready' | 'error' | 'empty'>('empty')
  let sequence = 0

  async function load(url: string): Promise<'ready' | 'error' | 'empty' | 'stale'> {
    const revision = ++sequence
    source.value = ''
    if (!url) {
      status.value = 'empty'
      return 'empty'
    }
    status.value = 'loading'
    try {
      const image = await request(url)
      if (revision !== sequence)
        return 'stale'
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
    source.value = ''
    status.value = 'error'
  }

  function cancel() {
    sequence++
  }

  return { source, status, load, failed, cancel }
}

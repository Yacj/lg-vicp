import { getPlatformInfo } from '@/services/platform'

export function withPdfPage(url: string, physicalPageNumber?: number | null) {
  if (!physicalPageNumber || physicalPageNumber < 1) {
    return url
  }
  const hashIndex = url.indexOf('#')
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url
  return `${base}#page=${physicalPageNumber}`
}

function looksLikeImage(url: string, mimeType?: string | null) {
  if (mimeType?.startsWith('image/')) {
    return true
  }
  return /\.(?:png|jpe?g|webp|gif)(?:\?|#|$)/i.test(url)
}

/**
 * 打开知识库正式原文件。H5 可用 #page= 定位物理页；小程序 / App 下载后系统预览，页码由阅读页先行展示。
 */
export function openOriginalFile(options: {
  url: string
  mimeType?: string | null
  physicalPageNumber?: number | null
}) {
  const { url, mimeType, physicalPageNumber } = options
  if (looksLikeImage(url, mimeType)) {
    uni.previewImage({ urls: [url] })
    return Promise.resolve()
  }

  if (getPlatformInfo().platform === 'h5') {
    window.open(withPdfPage(url, physicalPageNumber), '_blank')
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    uni.downloadFile({
      url,
      success: (result) => {
        uni.openDocument({
          filePath: result.tempFilePath,
          showMenu: true,
          success: () => resolve(),
          fail: () => reject(new Error('无法打开文件')),
        })
      },
      fail: () => reject(new Error('文件下载失败')),
    })
  })
}

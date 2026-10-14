import type { DownloadUrlResult } from '@/api/types'
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
export async function openOriginalFile(options: {
  url?: string
  /** 每次用户操作重新向业务接口签发；只在本次操作内使用。 */
  getUrl?: () => Promise<DownloadUrlResult>
  mimeType?: string | null
  physicalPageNumber?: number | null
  mode?: 'preview' | 'download'
  isCurrent?: () => boolean
}) {
  const { mimeType, physicalPageNumber } = options
  const platform = getPlatformInfo().platform
  const current = options.isCurrent ?? (() => true)
  const assertCurrent = () => {
    if (!current())
      throw new Error('文件操作已取消')
  }
  assertCurrent()

  // 签发 URL 前同步创建窗口，保留用户点击激活，避免 await 后被弹窗拦截。
  let browserWindow: Window | null = null
  if (platform === 'h5' && (!looksLikeImage(options.url ?? '', mimeType) || options.mode === 'download')) {
    if (typeof window === 'undefined')
      throw new Error('当前环境不支持文件预览')
    browserWindow = window.open('about:blank', '_blank')
    if (!browserWindow)
      throw new Error('文件窗口被浏览器拦截，请允许弹出窗口后重试')
    browserWindow.opener = null
  }

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const requestedAt = Date.now()
      const signed = options.getUrl ? await options.getUrl() : { url: options.url ?? '', expiresIn: Number.POSITIVE_INFINITY }
      assertCurrent()
      if (!signed.url)
        throw new Error('报告文件地址为空，请刷新后重试')
      if (signed.expiresIn <= 0 || Date.now() - requestedAt >= signed.expiresIn * 1000) {
        if (options.getUrl && attempt === 0)
          continue
        throw new Error('文件地址已过期，请重新点击获取')
      }

      if (looksLikeImage(signed.url, mimeType) && options.mode !== 'download') {
        browserWindow?.close()
        await new Promise<void>((resolve, reject) => {
          uni.previewImage({ urls: [signed.url], success: () => resolve(), fail: () => reject(new Error('无法打开图片')) })
        })
        return
      }

      if (platform === 'h5') {
        if (!browserWindow || browserWindow.closed)
          throw new Error('文件窗口已关闭，请重新点击打开')
        browserWindow.location.href = options.mode === 'download' ? signed.url : withPdfPage(signed.url, physicalPageNumber)
        return
      }

      if (typeof uni.downloadFile !== 'function' || typeof uni.openDocument !== 'function')
        throw new Error('当前平台不支持文件下载与打开')
      try {
        const localPath = await new Promise<string>((resolve, reject) => {
          uni.downloadFile({
            url: signed.url,
            success: (result) => {
              if (typeof result.statusCode === 'number' && result.statusCode !== 200) {
                reject(Object.assign(new Error(`文件下载失败（HTTP ${result.statusCode}），请重新获取`), { statusCode: result.statusCode }))
                return
              }
              if (!result.tempFilePath) {
                reject(new Error('文件下载失败，未获得临时文件'))
                return
              }
              resolve(result.tempFilePath)
            },
            fail: () => reject(new Error('文件下载失败，请检查网络及下载域名配置')),
          })
        })
        assertCurrent()
        let filePath = localPath
        if (options.mode === 'download') {
          if (typeof uni.saveFile !== 'function')
            throw new Error('当前平台不支持文件保存，请使用预览中的导出菜单')
          filePath = await new Promise<string>((resolve, reject) => {
            uni.saveFile({ tempFilePath: localPath, success: result => result.savedFilePath ? resolve(result.savedFilePath) : reject(new Error('文件保存失败')), fail: () => reject(new Error('文件保存失败，请检查可用空间')) })
          })
          assertCurrent()
        }
        await new Promise<void>((resolve, reject) => {
          uni.openDocument({
            filePath,
            ...(mimeType === 'application/pdf' && platform !== 'app' ? { fileType: 'pdf' as const } : {}),
            showMenu: true,
            success: () => resolve(),
            fail: () => reject(new Error('无法打开文件，请检查设备是否支持 PDF 阅读')),
          })
        })
        return
      }
      catch (error) {
        const code = (error as { statusCode?: number }).statusCode
        if (options.getUrl && attempt === 0 && (code === 401 || code === 403))
          continue
        throw error
      }
    }
  }
  catch (error) {
    browserWindow?.close()
    throw error
  }
}

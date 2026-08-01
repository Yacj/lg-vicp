import { getPlatformInfo } from '@/services/platform'

export type AttachmentPickType = 'album' | 'camera' | 'file'
export type AttachmentKind = 'image' | 'file'

export interface AttachmentAsset {
  kind: AttachmentKind
  name: string
  path: string
  mime?: string
  size?: number
  raw?: unknown
}

type AttachmentErrorCode = 'cancelled' | 'unsupported' | 'invalid-file' | 'failed'

export class AttachmentPickerError extends Error {
  constructor(
    message: string,
    public readonly code: AttachmentErrorCode,
  ) {
    super(message)
    this.name = 'AttachmentPickerError'
  }
}

export function isAttachmentCancelled(error: unknown) {
  return error instanceof AttachmentPickerError && error.code === 'cancelled'
}

const allowedFileExtensions = new Set(['doc', 'docx', 'pdf', 'txt'])
const allowedFileAccept = '.doc,.docx,.pdf,.txt,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,text/plain'

function createCancelledError() {
  return new AttachmentPickerError('用户取消了文件选择', 'cancelled')
}

function createFailedError(error: unknown) {
  if (error instanceof AttachmentPickerError) {
    return error
  }

  const message = typeof error === 'object' && error !== null && 'errMsg' in error
    ? String(error.errMsg)
    : ''
  if (/cancel|取消/i.test(message)) {
    return createCancelledError()
  }
  console.error(error)
  return new AttachmentPickerError('附件选择失败，请稍后重试', 'failed')
}

function getExtension(name: string) {
  return name.split('.').pop()?.toLowerCase() || ''
}

function assertAllowedFile(name: string) {
  if (!allowedFileExtensions.has(getExtension(name))) {
    throw new AttachmentPickerError('仅支持 DOC、DOCX、PDF、TXT 文件', 'invalid-file')
  }
}

interface ImageFileMeta {
  name?: string
  type?: string
  size?: number
}

function pickImage(sourceType: 'album' | 'camera') {
  return new Promise<AttachmentAsset[]>((resolve, reject) => {
    uni.chooseImage({
      count: 9,
      sizeType: ['original', 'compressed'],
      sourceType: [sourceType],
      success(result) {
        const tempFilePaths = Array.isArray(result.tempFilePaths) ? result.tempFilePaths : [result.tempFilePaths]
        const tempFiles = (Array.isArray(result.tempFiles)
          ? result.tempFiles
          : result.tempFiles
            ? [result.tempFiles]
            : []) as ImageFileMeta[]

        resolve(tempFilePaths.map((path, index) => ({
          kind: 'image',
          name: tempFiles[index]?.name || `image-${index + 1}`,
          path,
          mime: tempFiles[index]?.type,
          size: tempFiles[index]?.size,
        })))
      },
      fail(error) {
        reject(createFailedError(error))
      },
    })
  })
}

function pickH5Files() {
  return new Promise<AttachmentAsset[]>((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = allowedFileAccept
    input.style.position = 'fixed'
    input.style.left = '-9999px'
    input.style.opacity = '0'

    let settled = false
    let handleCancel = () => {}
    const cleanup = () => {
      input.removeEventListener('cancel', handleCancel)
      input.onchange = null
      input.remove()
    }
    const settleResolve = (assets: AttachmentAsset[]) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(assets)
    }
    const settleReject = (error: unknown) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }
    handleCancel = () => settleReject(createCancelledError())

    input.addEventListener('cancel', handleCancel)
    input.onchange = () => {
      const files = Array.from(input.files || [])
      if (!files.length) {
        handleCancel()
        return
      }

      try {
        files.forEach(file => assertAllowedFile(file.name))
        settleResolve(files.map(file => ({
          kind: 'file',
          name: file.name,
          path: URL.createObjectURL(file),
          mime: file.type,
          size: file.size,
          raw: file,
        })))
      }
      catch (error) {
        settleReject(createFailedError(error))
      }
    }

    document.body.appendChild(input)
    input.click()
  })
}

interface WechatFileResult {
  tempFiles?: Array<{
    name: string
    path: string
    size?: number
    type?: string
  }>
}

interface WechatUniApi {
  chooseMessageFile?: (options: {
    count: number
    type: 'file'
    extension: string[]
    success: (result: WechatFileResult) => void
    fail: (error: unknown) => void
  }) => void
}

function pickWechatFiles() {
  return new Promise<AttachmentAsset[]>((resolve, reject) => {
    const chooseMessageFile = (uni as typeof uni & WechatUniApi).chooseMessageFile
    if (!chooseMessageFile) {
      reject(new AttachmentPickerError('当前微信版本不支持文件选择', 'unsupported'))
      return
    }

    chooseMessageFile({
      count: 9,
      type: 'file',
      extension: [...allowedFileExtensions],
      success(result) {
        try {
          const files = result.tempFiles || []
          files.forEach(file => assertAllowedFile(file.name))
          resolve(files.map(file => ({
            kind: 'file',
            name: file.name,
            path: file.path,
            mime: file.type,
            size: file.size,
          })))
        }
        catch (error) {
          reject(createFailedError(error))
        }
      },
      fail(error) {
        reject(createFailedError(error))
      },
    })
  })
}

export function pickAttachment(type: AttachmentPickType) {
  const platform = getPlatformInfo().platform

  if (type === 'album') {
    if (platform === 'h5' || platform === 'mp-weixin') {
      return pickImage('album')
    }
  }

  if (type === 'camera') {
    if (platform === 'h5' || platform === 'mp-weixin') {
      return pickImage('camera')
    }
  }

  if (type === 'file') {
    if (platform === 'h5') {
      return pickH5Files()
    }
    if (platform === 'mp-weixin') {
      return pickWechatFiles()
    }
  }

  return Promise.reject(new AttachmentPickerError('App 附件能力暂未适配', 'unsupported'))
}

function previewH5Document(asset: AttachmentAsset) {
  if (typeof window === 'undefined') {
    return Promise.reject(new AttachmentPickerError('当前环境不支持文件预览', 'unsupported'))
  }

  const previewWindow = window.open(asset.path, '_blank')
  if (!previewWindow) {
    return Promise.reject(new AttachmentPickerError('文件预览窗口被浏览器拦截', 'failed'))
  }

  return Promise.resolve()
}

function previewWechatDocument(asset: AttachmentAsset) {
  return new Promise<void>((resolve, reject) => {
    uni.openDocument({
      filePath: asset.path,
      showMenu: true,
      success: () => resolve(),
      fail: error => reject(createFailedError(error)),
    })
  })
}

export function previewAttachment(asset: AttachmentAsset, attachments: AttachmentAsset[]) {
  const platform = getPlatformInfo().platform

  if (asset.kind === 'image') {
    const imageUrls = attachments.filter(item => item.kind === 'image').map(item => item.path)
    return new Promise<void>((resolve, reject) => {
      uni.previewImage({
        urls: imageUrls,
        current: asset.path,
        success: () => resolve(),
        fail: error => reject(createFailedError(error)),
      })
    })
  }

  if (platform === 'h5') {
    return previewH5Document(asset)
  }

  if (platform === 'mp-weixin') {
    return previewWechatDocument(asset)
  }

  return Promise.reject(new AttachmentPickerError('App 附件预览暂未适配', 'unsupported'))
}

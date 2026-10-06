import type { ApiEnvelope, UploadCompleteResult, UploadIntentBody, UploadIntentResult } from '@/api/types'
import type { AttachmentAsset } from '@/services/attachments'
import { fileApi } from '@/api/modules/files'
import { getPlatformInfo } from '@/services/platform'

type SupportedMime = UploadIntentBody['mimeType']

const MIME_BY_EXTENSION: Record<string, SupportedMime> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}

const EXTENSION_BY_MIME: Record<SupportedMime, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/png': 'png',
  'image/jpeg': 'jpg',
}

const SUPPORTED_MIMES = new Set<string>(Object.values(MIME_BY_EXTENSION))

export interface UploadMeta {
  fileName: string
  mimeType: SupportedMime
}

export function extensionOf(value: string) {
  return /\.([a-z0-9]+)$/i.exec(value)?.[1]?.toLowerCase() || ''
}

/** mime 可信则用 mime，否则回退扩展名；都对不上返回 null */
export function resolveUploadMeta(asset: AttachmentAsset): UploadMeta | null {
  const extension = extensionOf(asset.name) || extensionOf(asset.path)
  const mimeType = asset.mime && SUPPORTED_MIMES.has(asset.mime)
    ? asset.mime as SupportedMime
    : MIME_BY_EXTENSION[extension]
  if (!mimeType) {
    return null
  }

  const fileName = extensionOf(asset.name) ? asset.name : `${asset.name}.${EXTENSION_BY_MIME[mimeType]}`
  return { fileName, mimeType }
}

export function readAssetBytes(asset: AttachmentAsset): Promise<ArrayBuffer> {
  if (getPlatformInfo().platform === 'h5') {
    if (asset.raw instanceof Blob) {
      return asset.raw.arrayBuffer()
    }
    return fetch(asset.path).then(response => response.arrayBuffer())
  }

  return new Promise((resolve, reject) => {
    uni.getFileSystemManager().readFile({
      filePath: asset.path,
      success: result => resolve(result.data as ArrayBuffer),
      fail: () => reject(new Error('读取文件失败')),
    })
  })
}

/** 对象存储预签名直传：只允许携带后端签名时声明的 headers */
export function putObject(url: string, headers: Record<string, string>, bytes: ArrayBuffer): Promise<void> {
  if (getPlatformInfo().platform === 'h5') {
    return fetch(url, { method: 'PUT', headers, body: bytes }).then((response) => {
      if (!response.ok) {
        throw new Error(`文件直传失败（${response.status}）`)
      }
    })
  }

  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method: 'PUT',
      data: bytes,
      header: headers,
      success: (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve()
        }
        else {
          reject(new Error(`文件直传失败（${response.statusCode}）`))
        }
      },
      fail: () => reject(new Error('文件直传失败，请检查网络')),
    })
  })
}

export async function uploadByIntent(body: UploadIntentBody, bytes: ArrayBuffer) {
  const intent = await fileApi.createUploadIntent(body).send() as ApiEnvelope<UploadIntentResult>
  if (intent.data.mode === 'REUSE' || !intent.data.uploadUrl) {
    return intent.data.fileId
  }

  await putObject(intent.data.uploadUrl, intent.data.headers || {}, bytes)
  const complete = await fileApi.complete(intent.data.fileId).send() as ApiEnvelope<UploadCompleteResult>
  return complete.data.duplicateOfFileId || complete.data.fileId || intent.data.fileId
}

/**
 * 文件预览能力（图片 / PDF / 文本 / 不支持类型提示）。
 * 预览基于已下载的 Blob，避免在页面上直接暴露预签名 URL。
 */

export type PreviewKind = 'image' | 'pdf' | 'text' | 'unsupported'

export interface PreviewDescriptor {
  kind: PreviewKind
  /** 不支持时的原因说明。 */
  reason?: string
}

const TEXT_MIME_PATTERN = /^(text\/|application\/(json|xml|javascript|ecmascript|x-javascript)|application\/x-httpd-php)/
const IMAGE_MIME_PATTERN = /^image\/(png|jpe?g|gif|webp|svg\+xml|bmp|avif)/
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'log', 'json', 'xml', 'yml', 'yaml', 'ini', 'conf'])

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot < 0 || dot === filename.length - 1) {
    return ''
  }
  return filename.slice(dot + 1).toLowerCase()
}

/** 根据 MIME 与文件名判断预览类型。 */
export function resolvePreviewKind(mimeType: string, filename: string): PreviewDescriptor {
  const normalized = mimeType.toLowerCase()
  if (normalized === 'application/pdf') {
    return { kind: 'pdf' }
  }
  if (IMAGE_MIME_PATTERN.test(normalized)) {
    return { kind: 'image' }
  }
  if (TEXT_MIME_PATTERN.test(normalized)) {
    return { kind: 'text' }
  }
  const extension = extensionOf(filename)
  if (extension && TEXT_EXTENSIONS.has(extension)) {
    return { kind: 'text' }
  }
  if (normalized.startsWith('image/')) {
    return { kind: 'image' }
  }
  return {
    kind: 'unsupported',
    reason: '该文件类型暂不支持在线预览，请下载后查看',
  }
}

export const SUPPORTED_PREVIEW_KINDS: PreviewKind[] = ['image', 'pdf', 'text']

/** 创建图片 / PDF 预览地址（调用方负责 revoke）。 */
export function createObjectPreviewUrl(blob: Blob): string {
  return URL.createObjectURL(blob)
}

/** 读取文本文件内容（大小受浏览器内存限制，超大文件由调用方拦截）。 */
export async function readTextBlob(blob: Blob): Promise<string> {
  if (blob.size > 5 * 1024 * 1024) {
    throw new Error('文本文件过大，无法在线预览，请下载后查看')
  }
  return blob.text()
}
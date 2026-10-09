import type { UploadFileContext } from '@/types/file'
import { completeFileUpload, createUploadIntent, uploadFileToPresignedUrl } from '@/api/modules/files'

export interface UploadedPageImage {
  fileId: string
  reused: boolean
}

/** 文件中心的 complete 可将临时文件合并到已有 READY 文件，后续只能使用返回的 fileId。 */
export async function uploadKnowledgePageImage(
  file: File,
  options: { sha256?: string, onProgress: UploadFileContext['onProgress'], signal: AbortSignal },
): Promise<UploadedPageImage> {
  const intent = await createUploadIntent({
    purpose: 'KNOWLEDGE_SOURCE',
    fileName: file.name,
    mimeType: file.type as 'image/png' | 'image/jpeg',
    sizeBytes: file.size,
    sha256: options.sha256,
  })
  if (intent.mode === 'REUSE') {
    return { fileId: intent.fileId, reused: true }
  }
  if (!intent.uploadUrl) {
    throw new Error('未取得页面图片上传地址，请重试')
  }
  await uploadFileToPresignedUrl(intent.uploadUrl, file, {
    signal: options.signal,
    onProgress: options.onProgress,
  })
  const completed = await completeFileUpload(intent.fileId)
  if (!completed.fileId) {
    throw new Error('页面图片上传完成后未返回可用文件，请重试')
  }
  return {
    fileId: completed.fileId,
    reused: completed.fileId !== intent.fileId,
  }
}

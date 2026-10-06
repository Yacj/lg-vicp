import type { AttachmentAsset } from '@/services/attachments'
import {
  CHAT_IMAGE_EXTENSIONS,
  CHAT_IMAGE_MAX_COUNT,
  CHAT_IMAGE_SUGGESTED_MAX_BYTES,
} from '@/constants/chatImage'
import { isAttachmentCancelled, pickChatImages } from '@/services/attachments'
import { extensionOf, readAssetBytes, resolveUploadMeta, uploadByIntent } from '@/services/files/directUpload'

export type ChatImageStatus = 'local' | 'uploading' | 'ready' | 'failed'

export interface ChatImageDraft {
  key: string
  name: string
  path: string
  mime?: string
  size?: number
  fileId?: string
  status: ChatImageStatus
  error?: string
  raw?: unknown
}

function createDraft(asset: AttachmentAsset): ChatImageDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: asset.name,
    path: asset.path,
    mime: asset.mime,
    size: asset.size,
    status: 'local',
    raw: asset.raw,
  }
}

function isAllowedChatImage(asset: AttachmentAsset) {
  const meta = resolveUploadMeta(asset)
  const extension = extensionOf(asset.name) || extensionOf(asset.path)
  const mimeOk = meta?.mimeType === 'image/jpeg' || meta?.mimeType === 'image/png'
  const extOk = CHAT_IMAGE_EXTENSIONS.has(extension)
  return Boolean(mimeOk || extOk)
}

function toAsset(draft: ChatImageDraft): AttachmentAsset {
  return {
    kind: 'image',
    name: draft.name,
    path: draft.path,
    mime: draft.mime,
    size: draft.size,
    raw: draft.raw,
  }
}

export function useChatImageUpload() {
  const toast = useGlobalToast()
  const drafts = ref<ChatImageDraft[]>([])
  const uploading = computed(() => drafts.value.some(item => item.status === 'uploading'))
  const readyFileIds = computed(() => drafts.value.filter(item => item.status === 'ready' && item.fileId).map(item => item.fileId!))
  const remaining = computed(() => CHAT_IMAGE_MAX_COUNT - drafts.value.length)

  function patch(key: string, patchValue: Partial<ChatImageDraft>) {
    drafts.value = drafts.value.map(item => item.key === key ? { ...item, ...patchValue } : item)
  }

  function remove(key: string) {
    drafts.value = drafts.value.filter(item => item.key !== key)
  }

  function clear() {
    drafts.value = []
  }

  async function pick(type: 'album' | 'camera') {
    if (remaining.value <= 0) {
      toast.info(`最多选择 ${CHAT_IMAGE_MAX_COUNT} 张图片`)
      return
    }

    let assets: AttachmentAsset[]
    try {
      assets = await pickChatImages(type, remaining.value)
    }
    catch (error) {
      if (!isAttachmentCancelled(error)) {
        toast.error(error instanceof Error ? error.message : '图片选择失败，请稍后重试')
      }
      return
    }

    const accepted: AttachmentAsset[] = []
    for (const asset of assets) {
      if (drafts.value.length + accepted.length >= CHAT_IMAGE_MAX_COUNT) {
        toast.info(`最多选择 ${CHAT_IMAGE_MAX_COUNT} 张图片`)
        break
      }
      if (!isAllowedChatImage(asset)) {
        toast.info('仅支持 JPG、JPEG、PNG')
        continue
      }
      if (typeof asset.size === 'number' && asset.size > CHAT_IMAGE_SUGGESTED_MAX_BYTES) {
        toast.info('单张图片建议不超过 10MB')
        continue
      }
      accepted.push(asset)
    }

    drafts.value = [...drafts.value, ...accepted.map(createDraft)]
  }

  async function uploadOne(draft: ChatImageDraft) {
    if (draft.status === 'ready' && draft.fileId) {
      return draft.fileId
    }

    const asset = toAsset(draft)
    const meta = resolveUploadMeta(asset)
    if (!meta || (meta.mimeType !== 'image/jpeg' && meta.mimeType !== 'image/png')) {
      patch(draft.key, { status: 'failed', error: '仅支持 JPG、JPEG、PNG' })
      throw new Error('仅支持 JPG、JPEG、PNG')
    }

    patch(draft.key, { status: 'uploading', error: undefined })
    try {
      const bytes = await readAssetBytes(asset)
      if (bytes.byteLength > CHAT_IMAGE_SUGGESTED_MAX_BYTES) {
        throw new Error('单张图片建议不超过 10MB')
      }
      const fileId = await uploadByIntent({
        purpose: 'CHAT_IMAGE',
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        sizeBytes: bytes.byteLength,
      }, bytes)
      patch(draft.key, { status: 'ready', fileId })
      return fileId
    }
    catch (error) {
      const message = error instanceof Error && error.message ? error.message : '图片上传失败，请重试'
      patch(draft.key, { status: 'failed', error: message })
      throw error instanceof Error ? error : new Error(message)
    }
  }

  async function uploadAll() {
    const fileIds: string[] = []
    for (const draft of drafts.value) {
      fileIds.push(await uploadOne(draft))
    }
    return fileIds
  }

  return {
    drafts,
    uploading,
    readyFileIds,
    remaining,
    pick,
    remove,
    clear,
    uploadAll,
  }
}

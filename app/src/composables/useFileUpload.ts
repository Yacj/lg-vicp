import type { MaybeRefOrGetter } from 'vue'
import type { ApiEnvelope, UploadIntentBody, UploadIntentResult } from '@/api/types'
import type { AttachmentAsset, AttachmentPickType } from '@/services/attachments'
import { fileApi } from '@/api/modules/files'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { isAttachmentCancelled, pickAttachment } from '@/services/attachments'
import { getPlatformInfo } from '@/services/platform'

type SupportedMime = UploadIntentBody['mimeType']

/** 后端 file.schemas.ts 只接受四种真实类型；小程序 picker 常缺 mime，扩展名是稳定来源 */
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

export type UploadPhase = 'reading' | 'requesting' | 'uploading' | 'confirming' | 'failed'

export const UPLOAD_PHASE_LABELS: Record<UploadPhase, string> = {
  reading: '读取文件',
  requesting: '创建上传任务',
  uploading: '上传中',
  confirming: '校验并排队解析',
  failed: '上传失败',
}

export interface UploadTask {
  key: string
  name: string
  phase: UploadPhase
  error?: string
}

interface UploadMeta {
  fileName: string
  mimeType: SupportedMime
}

function extensionOf(value: string) {
  return /\.([a-z0-9]+)$/i.exec(value)?.[1]?.toLowerCase() || ''
}

/** mime 可信则用 mime，否则回退扩展名（name 缺失时从临时路径取）；都对不上返回 null 表示不支持 */
function resolveUploadMeta(asset: AttachmentAsset): UploadMeta | null {
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

/**
 * 统一读成 ArrayBuffer 再上传：后端 complete 会校验对象大小与凭证申报值严格一致，
 * byteLength 是唯一在所有平台都精确的大小来源。
 */
function readAssetBytes(asset: AttachmentAsset): Promise<ArrayBuffer> {
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

/** 对象存储预签名直传：只允许携带后端签名时声明的 headers，多余头会导致签名校验失败 */
function putObject(url: string, headers: Record<string, string>, bytes: ArrayBuffer): Promise<void> {
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

/**
 * 项目文件上传状态机：选择 → 读取 → 申请凭证 → 直传 → complete 排队解析。
 * tasks 只保留进行中与失败项；成功后触发 onUploaded 由调用方刷新服务端列表。
 */
export function useFileUpload(options: {
  projectId: MaybeRefOrGetter<string>
  onUploaded?: () => void
}) {
  const toast = useGlobalToast()
  const tasks = ref<UploadTask[]>([])
  const uploading = computed(() => tasks.value.some(task => task.phase !== 'failed'))

  function dismissTask(key: string) {
    tasks.value = tasks.value.filter(task => task.key !== key)
  }

  function patchTask(key: string, patch: Partial<UploadTask>) {
    tasks.value = tasks.value.map(task => task.key === key ? { ...task, ...patch } : task)
  }

  async function runTask(asset: AttachmentAsset, meta: UploadMeta) {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    tasks.value = [...tasks.value, { key, name: meta.fileName, phase: 'reading' }]

    try {
      const bytes = await readAssetBytes(asset)

      patchTask(key, { phase: 'requesting' })
      const intent = await fileApi.createUploadIntent({
        projectId: toValue(options.projectId),
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        sizeBytes: bytes.byteLength,
      }).send() as ApiEnvelope<UploadIntentResult>

      patchTask(key, { phase: 'uploading' })
      await putObject(intent.data.uploadUrl, intent.data.headers, bytes)

      patchTask(key, { phase: 'confirming' })
      await fileApi.complete(intent.data.fileId).send()

      dismissTask(key)
      options.onUploaded?.()
    }
    catch (error) {
      patchTask(key, {
        phase: 'failed',
        error: error instanceof Error && error.message ? error.message : '上传失败，请稍后重试',
      })
    }
  }

  async function pickAndUpload(type: AttachmentPickType) {
    let assets: AttachmentAsset[]
    try {
      assets = await pickAttachment(type)
    }
    catch (error) {
      if (!isAttachmentCancelled(error)) {
        toast.error(error instanceof Error ? error.message : '附件选择失败，请稍后重试')
      }
      return
    }

    const resolved = assets.map(asset => ({ asset, meta: resolveUploadMeta(asset) }))
    const rejected = resolved.filter(item => !item.meta)
    if (rejected.length) {
      toast.info(`已跳过不支持的文件：${rejected.map(item => item.asset.name).join('、')}`)
    }

    // 串行上传：直传走对象存储带宽，弱网下并发只会互相拖慢并放大失败率
    for (const item of resolved) {
      if (item.meta) {
        await runTask(item.asset, item.meta)
      }
    }
  }

  return { tasks, uploading, pickAndUpload, dismissTask }
}

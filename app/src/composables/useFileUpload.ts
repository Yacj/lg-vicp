import type { MaybeRefOrGetter } from 'vue'
import type { AttachmentAsset, AttachmentPickType } from '@/services/attachments'
import type { UploadMeta } from '@/services/files/directUpload'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { isAttachmentCancelled, pickAttachment } from '@/services/attachments'
import { readAssetBytes, resolveUploadMeta, uploadByIntent } from '@/services/files/directUpload'

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

      patchTask(key, { phase: 'uploading' })
      await uploadByIntent({
        projectId: toValue(options.projectId),
        purpose: 'GENERAL',
        fileName: meta.fileName,
        mimeType: meta.mimeType,
        sizeBytes: bytes.byteLength,
      }, bytes)

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

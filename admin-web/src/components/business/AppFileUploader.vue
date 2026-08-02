<script setup lang="ts">
import type {
  RequestMethodResponse,
  SizeLimitObj,
  UploadFile,
  UploadInstanceFunctions,
  UploadRemoveContext,
  UploadValidateType,
} from 'tdesign-vue-next'
import { computed, onBeforeUnmount, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { completeFileUpload, createUploadIntent, uploadFileToPresignedUrl } from '@/api/modules/files'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import type { CompleteUploadResult } from '@/types/file'
import { SUPPORTED_FILE_MIME_TYPES } from '@/types/file'
import type { SupportedFileMimeType } from '@/types/file'

/**
 * 文件上传组件（预签名直传）：
 * - 文件选择（多选 / 拖拽）
 * - 类型白名单限制（与后端 supportedMimeTypes 一致）
 * - 大小限制（默认与后端 MAX_UPLOAD_BYTES 一致）
 * - 上传进度、取消上传、失败重试
 * - 上传完成（返回 fileId / taskId）
 * - 重复文件提示（同名文件过滤）
 */
const props = withDefaults(defineProps<{
  /** 关联项目（可选，用户级文件可不传）。 */
  projectId?: string
  accept?: string
  disabled?: boolean
  draggable?: boolean
  /** 最大文件数量（multiple 时生效）。 */
  max?: number
  multiple?: boolean
  /** 大小上限（MB），默认 50。 */
  maxSizeMB?: number
  tips?: string
  placeholder?: string
}>(), {
  accept: '.pdf,.docx,.png,.jpg,.jpeg',
  disabled: false,
  draggable: true,
  max: 10,
  multiple: true,
  maxSizeMB: 50,
  tips: '',
  placeholder: '选择文件',
})

const emit = defineEmits<{
  success: [file: File, result: CompleteUploadResult]
  error: [file: File, error: unknown]
  progress: [file: File, percent: number]
  duplicate: [file: File]
  rejected: [file: File, reason: string]
  change: [files: UploadFile[]]
}>()

const files = defineModel<UploadFile[]>({ default: () => [] })
const uploadRef = ref<UploadInstanceFunctions | null>(null)
const activeUploads = new Map<File, AbortController>()
const retrying = ref(false)

const sizeLimit = computed<SizeLimitObj>(() => ({
  message: `文件大小不能超过 ${props.maxSizeMB} MB`,
  size: props.maxSizeMB,
  unit: 'MB',
}))

function isSupportedMimeType(type: string): boolean {
  return (SUPPORTED_FILE_MIME_TYPES as readonly string[]).includes(type)
}

function beforeUpload(file: UploadFile): boolean {
  const raw = file.raw
  if (!raw) {
    return false
  }
  if (!isSupportedMimeType(raw.type)) {
    const reason = `暂不支持该文件类型，仅支持 PDF、Word（.docx）、PNG、JPG`
    MessagePlugin.warning(`${raw.name}：${reason}`)
    emit('rejected', raw, reason)
    return false
  }
  return true
}

function onValidate(context: { type: UploadValidateType, files: UploadFile[] }): void {
  if (context.type === 'FILTER_FILE_SAME_NAME') {
    context.files?.forEach((file) => {
      MessagePlugin.warning(`已存在同名文件：${file.name}，请勿重复上传`)
      if (file.raw) {
        emit('duplicate', file.raw)
      }
    })
  }
}

function reportProgress(uploadFile: UploadFile, percent: number): void {
  uploadRef.value?.uploadFilePercent({ file: uploadFile, percent })
  if (uploadFile.raw) {
    emit('progress', uploadFile.raw, percent)
  }
}

async function computeSha256(file: File): Promise<string | undefined> {
  try {
    const buffer = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(digest))
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('')
  }
  catch {
    // SHA-256 为可选校验（后端未传时跳过），失败不影响上传
    return undefined
  }
}

async function uploadOne(uploadFile: UploadFile): Promise<CompleteUploadResult> {
  const raw = uploadFile.raw
  if (!raw) {
    throw new Error('无法读取待上传文件')
  }

  const controller = new AbortController()
  activeUploads.set(raw, controller)

  try {
    const sha256 = await computeSha256(raw)
    const intent = await createUploadIntent({
      fileName: raw.name,
      mimeType: raw.type as SupportedFileMimeType,
      projectId: props.projectId,
      sha256,
      sizeBytes: raw.size,
    })
    await uploadFileToPresignedUrl(intent.uploadUrl, raw, {
      onProgress: (progress) => reportProgress(uploadFile, progress.percent),
      signal: controller.signal,
    })
    const result = await completeFileUpload(intent.fileId)
    reportProgress(uploadFile, 100)
    emit('success', raw, result)
    return result
  }
  catch (error) {
    if (!controller.signal.aborted) {
      emit('error', raw, error)
    }
    throw error
  }
  finally {
    activeUploads.delete(raw)
  }
}

async function requestMethod(value: UploadFile | UploadFile[]): Promise<RequestMethodResponse> {
  const list = Array.isArray(value) ? value : [value]
  try {
    const results = await Promise.all(list.map(uploadOne))
    return { response: { results }, status: 'success' }
  }
  catch (error) {
    return {
      error: normalizeFeedbackError(error).message,
      response: {},
      status: 'fail',
    }
  }
}

/** 失败重试：清除失败标记后重新进入上传队列。 */
function retryFile(target: UploadFile): void {
  if (!target.raw) {
    return
  }
  target.status = 'waiting'
  target.response = undefined
  uploadRef.value?.uploadFiles()
}

/** 删除（未完成时取消上传）。 */
function removeFile(context: UploadRemoveContext): void {
  const raw = context.file?.raw
  if (raw) {
    activeUploads.get(raw)?.abort()
  }
}

function onChange(value: UploadFile[]): void {
  emit('change', value)
}

function clear(): void {
  activeUploads.forEach(controller => controller.abort())
  activeUploads.clear()
  files.value = []
}

onBeforeUnmount(() => {
  activeUploads.forEach(controller => controller.abort())
  activeUploads.clear()
})

defineExpose({ clear })

function formatSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) {
    return '-'
  }
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function statusLabel(file: UploadFile): string {
  if (file.status === 'success') {
    return '上传完成'
  }
  if (file.status === 'fail') {
    return String(file.response?.error ?? '上传失败')
  }
  if (file.status === 'progress') {
    return `上传中 ${file.percent ?? 0}%`
  }
  return '等待上传'
}
</script>

<template>
  <t-upload
    ref="uploadRef"
    v-model="files"
    :accept="accept"
    :allow-upload-duplicate-file="false"
    :auto-upload="true"
    :before-upload="beforeUpload"
    :disabled="disabled"
    :draggable="draggable"
    :max="max"
    :multiple="multiple"
    :placeholder="placeholder"
    :request-method="requestMethod"
    :show-upload-progress="true"
    :size-limit="sizeLimit"
    theme="file-flow"
    :tips="tips"
    :use-mock-progress="false"
    @change="onChange"
    @remove="removeFile"
    @validate="onValidate"
  >
    <template #fileListDisplay="{ files: displayFiles, onRemove }">
      <div class="app-file-uploader__list">
        <div
          v-for="(file, index) in displayFiles"
          :key="`${file.name}-${index}`"
          class="app-file-uploader__row"
          :class="`is-${file.status ?? 'waiting'}`"
        >
          <t-icon
            class="app-file-uploader__file-icon"
            :name="file.status === 'success' ? 'file-check' : 'file'"
          />
          <div class="app-file-uploader__file">
            <span class="app-file-uploader__name" :title="file.name">{{ file.name }}</span>
            <span class="app-file-uploader__meta">{{ formatSize(file.size) }}</span>
          </div>
          <div class="app-file-uploader__status">
            <t-progress
              v-if="file.status === 'progress'"
              class="app-file-uploader__progress"
              :label="false"
              :percentage="file.percent ?? 0"
            />
            <span v-else :class="`app-file-uploader__status-text is-${file.status ?? 'waiting'}`">
              {{ statusLabel(file) }}
            </span>
          </div>
          <div class="app-file-uploader__actions">
            <t-button
              v-if="file.status === 'fail'"
              :loading="retrying"
              size="small"
              theme="primary"
              variant="text"
              @click="retryFile(file)"
            >
              重试
            </t-button>
            <t-button
              size="small"
              theme="danger"
              variant="text"
              @click="onRemove({ e: $event, file, index })"
            >
              删除
            </t-button>
          </div>
        </div>
      </div>
    </template>
  </t-upload>
</template>

<style scoped>
.app-file-uploader__list {
  display: grid;
  gap: var(--td-size-2);
  margin-top: var(--td-size-3);
}

.app-file-uploader__row {
  display: flex;
  align-items: center;
  gap: var(--td-size-3);
  padding: var(--td-size-2) var(--td-size-3);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-small);
  background: var(--td-bg-color-container);
}

.app-file-uploader__file-icon {
  flex: none;
  color: var(--td-brand-color);
  font-size: var(--td-size-5);
}

.app-file-uploader__row.is-success .app-file-uploader__file-icon {
  color: var(--td-success-color);
}

.app-file-uploader__row.is-fail .app-file-uploader__file-icon {
  color: var(--td-error-color);
}

.app-file-uploader__file {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}

.app-file-uploader__name {
  overflow: hidden;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-file-uploader__meta {
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}

.app-file-uploader__status {
  display: flex;
  flex: none;
  align-items: center;
  min-width: 140px;
}

.app-file-uploader__progress {
  width: 100%;
}

.app-file-uploader__status-text {
  font-size: var(--td-font-size-body-small);
  white-space: nowrap;
}

.app-file-uploader__status-text.is-success {
  color: var(--td-success-color);
}

.app-file-uploader__status-text.is-fail {
  color: var(--td-error-color);
}

.app-file-uploader__status-text.is-waiting {
  color: var(--td-text-color-secondary);
}

.app-file-uploader__actions {
  display: flex;
  flex: none;
  gap: var(--td-size-1);
}
</style>
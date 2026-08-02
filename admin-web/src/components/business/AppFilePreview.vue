<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { downloadUrlToBlob, fetchFileDownloadUrl } from '@/api/modules/files'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import type { FileRecord } from '@/types/file'
import { createObjectPreviewUrl, readTextBlob, resolvePreviewKind } from '@/utils/file-preview'
import type { PreviewKind } from '@/utils/file-preview'

/**
 * 文件预览：图片 / PDF / 文本；不支持的类型提示下载。
 * 预览基于临时 Blob（不暴露预签名 URL），关闭时释放。
 */
const props = withDefaults(defineProps<{
  visible: boolean
  file?: FileRecord | null
}>(), {
  file: null,
})

const emit = defineEmits<{
  close: []
  /** 触发下载（携带已获取的下载地址）。 */
  download: [url: string]
}>()

const kind = ref<PreviewKind>('unsupported')
const reason = ref('')
const objectUrl = ref('')
const textContent = ref('')
const loading = ref(false)
const error = ref<unknown>(null)
const downloadUrl = ref('')
let activeController: AbortController | null = null

const errorMessage = computed(() => (error.value ? normalizeFeedbackError(error.value).message : ''))

watch(
  () => [props.visible, props.file?.id] as const,
  async ([visible, fileId]) => {
    reset()
    if (!visible || !fileId) {
      return
    }
    loading.value = true
    const controller = new AbortController()
    activeController = controller
    try {
      const { url } = await fetchFileDownloadUrl(fileId)
      downloadUrl.value = url
      const { blob, contentType } = await downloadUrlToBlob(url, { signal: controller.signal })
      const descriptor = resolvePreviewKind(contentType || props.file?.mimeType || '', props.file?.originalName || '')
      kind.value = descriptor.kind
      reason.value = descriptor.reason ?? ''
      if (descriptor.kind === 'image' || descriptor.kind === 'pdf') {
        objectUrl.value = createObjectPreviewUrl(blob)
      }
      else if (descriptor.kind === 'text') {
        textContent.value = await readTextBlob(blob)
      }
    }
    catch (cause) {
      if (!controller.signal.aborted) {
        error.value = cause
      }
    }
    finally {
      if (activeController === controller) {
        activeController = null
      }
      loading.value = false
    }
  },
  { immediate: true },
)

function reset(): void {
  activeController?.abort()
  activeController = null
  if (objectUrl.value) {
    URL.revokeObjectURL(objectUrl.value)
    objectUrl.value = ''
  }
  textContent.value = ''
  kind.value = 'unsupported'
  reason.value = ''
  error.value = null
  downloadUrl.value = ''
}

function onClose(): void {
  reset()
  emit('close')
}

function onDownload(): void {
  if (downloadUrl.value) {
    emit('download', downloadUrl.value)
  }
}
</script>

<template>
  <t-dialog
    :visible="visible"
    :header="file?.originalName ?? '文件预览'"
    width="720px"
    :footer="false"
    @close="onClose"
  >
    <div class="app-file-preview">
      <t-loading :loading="loading" show-overlay size="small">
        <div v-if="!loading" class="app-file-preview__body">
          <template v-if="kind === 'image' && objectUrl">
            <img :src="objectUrl" class="app-file-preview__image" :alt="file?.originalName ?? ''" />
          </template>
          <iframe
            v-else-if="kind === 'pdf' && objectUrl"
            :src="objectUrl"
            class="app-file-preview__pdf"
            title="PDF 预览"
          />
          <pre v-else-if="kind === 'text'" class="app-file-preview__text">{{ textContent }}</pre>
          <div v-else-if="error" class="app-file-preview__message">
            <t-icon name="error-circle-filled" class="app-file-preview__message-icon" />
            <span>{{ errorMessage }}</span>
          </div>
          <div v-else class="app-file-preview__message">
            <t-icon name="file-unknown" class="app-file-preview__message-icon" />
            <span>{{ reason || '该文件类型暂不支持在线预览' }}</span>
            <t-button size="small" theme="primary" variant="outline" @click="onDownload">
              下载查看
            </t-button>
          </div>
        </div>
      </t-loading>
    </div>
  </t-dialog>
</template>

<style scoped>
.app-file-preview__body {
  min-height: 360px;
}

.app-file-preview__image {
  display: block;
  max-width: 100%;
  max-height: 60vh;
  margin: 0 auto;
  object-fit: contain;
}

.app-file-preview__pdf {
  display: block;
  width: 100%;
  height: 60vh;
  border: 0;
}

.app-file-preview__text {
  max-height: 60vh;
  margin: 0;
  padding: var(--td-size-4);
  overflow: auto;
  border-radius: var(--td-radius-small);
  background: var(--td-bg-color-container-hover);
  color: var(--td-text-color-primary);
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
}

.app-file-preview__message {
  display: flex;
  min-height: 360px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--td-size-4);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.app-file-preview__message-icon {
  color: var(--td-text-color-placeholder);
  font-size: 40px;
}
</style>
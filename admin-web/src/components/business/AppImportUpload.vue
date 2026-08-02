<script setup lang="ts">
import type {
  RequestMethodResponse,
  SizeLimitObj,
  UploadFile,
  UploadInstanceFunctions,
  UploadRemoveContext,
} from 'tdesign-vue-next'
import { computed, onBeforeUnmount, ref } from 'vue'
import type { CrudUploadHandler } from '@/types/crud'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'

const props = withDefaults(defineProps<{
  handler: CrudUploadHandler
  accept?: string
  disabled?: boolean
  draggable?: boolean
  max?: number
  multiple?: boolean
  placeholder?: string
  sizeLimit?: number | SizeLimitObj
  tips?: string
}>(), {
  accept: '',
  disabled: false,
  draggable: true,
  max: undefined,
  multiple: false,
  placeholder: '选择文件',
  sizeLimit: undefined,
  tips: '',
})

const emit = defineEmits<{
  error: [file: File, error: unknown]
  progress: [file: File, percent: number]
  success: [file: File, result: unknown]
}>()

const files = defineModel<UploadFile[]>({ default: () => [] })
const uploadRef = ref<UploadInstanceFunctions | null>(null)
const activeUploads = new Map<File, AbortController>()
const resolvedMax = computed(() => props.max ?? (props.multiple ? 10 : 1))

function normalizePercent(percent: number): number {
  return Math.min(100, Math.max(0, Math.round(percent)))
}

async function uploadOne(uploadFile: UploadFile): Promise<unknown> {
  if (!uploadFile.raw) {
    throw new Error('无法读取待上传文件')
  }

  const controller = new AbortController()
  activeUploads.set(uploadFile.raw, controller)

  try {
    const result = await props.handler(uploadFile.raw, {
      signal: controller.signal,
      onProgress: (value) => {
        const percent = normalizePercent(value)
        uploadRef.value?.uploadFilePercent({ file: uploadFile, percent })
        emit('progress', uploadFile.raw as File, percent)
      },
    })
    emit('success', uploadFile.raw, result)
    return result
  }
  catch (error) {
    if (!controller.signal.aborted) {
      emit('error', uploadFile.raw, error)
    }
    throw error
  }
  finally {
    activeUploads.delete(uploadFile.raw)
  }
}

async function requestMethod(value: UploadFile | UploadFile[]): Promise<RequestMethodResponse> {
  try {
    const results = await Promise.all((Array.isArray(value) ? value : [value]).map(uploadOne))
    return {
      status: 'success',
      response: { results },
    }
  }
  catch (error) {
    return {
      status: 'fail',
      error: normalizeFeedbackError(error).message,
      response: {},
    }
  }
}

function removeFile(context: UploadRemoveContext): void {
  const raw = context.file?.raw
  if (raw) {
    activeUploads.get(raw)?.abort()
  }
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
</script>

<template>
  <t-upload
    ref="uploadRef"
    v-model="files"
    :accept="accept"
    :auto-upload="true"
    :disabled="disabled"
    :draggable="draggable"
    :max="resolvedMax"
    :multiple="multiple"
    :placeholder="placeholder"
    :request-method="requestMethod"
    :show-upload-progress="true"
    :size-limit="sizeLimit"
    theme="file-flow"
    :tips="tips"
    :use-mock-progress="false"
    @remove="removeFile"
  />
</template>
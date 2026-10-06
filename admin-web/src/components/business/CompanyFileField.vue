<script setup lang="ts">
import type { UploadFile } from 'tdesign-vue-next'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { fetchFileDownloadUrl } from '@/api/modules/files'
import AppFilePicker from '@/components/business/AppFilePicker.vue'
import AppFilePreview from '@/components/business/AppFilePreview.vue'
import AppFileUploader from '@/components/business/AppFileUploader.vue'
import type { CompanySelectedFile } from '@/types/company'
import type { CompleteUploadResult, FileCenterItem } from '@/types/file'
import {
  COMPANY_LOGO_ACCEPT,
  COMPANY_LOGO_MIME_TYPES,
  COMPANY_QUALIFICATION_ACCEPT,
  COMPANY_QUALIFICATION_MIME_TYPES,
  companyAttachmentLabel,
  isImageMime,
} from '@/utils/company'

const props = withDefaults(defineProps<{
  kind: 'logo' | 'qualification'
  fileId?: string
  previewUrl?: string
  mimeType?: string
  fileName?: string
  disabled?: boolean
  readonly?: boolean
}>(), {
  fileId: '',
  previewUrl: '',
  mimeType: '',
  fileName: '',
  disabled: false,
  readonly: false,
})

const emit = defineEmits<{
  change: [file: CompanySelectedFile]
}>()

const replaceVisible = ref(false)
const pickerVisible = ref(false)
const previewVisible = ref(false)
const uploaderFiles = ref<UploadFile[]>([])
const localPreviewUrl = ref('')

const isLogo = computed(() => props.kind === 'logo')
const accept = computed(() => isLogo.value ? COMPANY_LOGO_ACCEPT : COMPANY_QUALIFICATION_ACCEPT)
const allowedMimeTypes = computed(() => isLogo.value ? COMPANY_LOGO_MIME_TYPES : COMPANY_QUALIFICATION_MIME_TYPES)
const pickerAccept = computed(() => isLogo.value ? 'image' : 'image-or-pdf')
const unsupportedTypeMessage = computed(() => isLogo.value
  ? '企业 Logo 仅支持 PNG、JPEG、SVG'
  : '企业资质附件仅支持图片或 PDF')
const displayPreview = computed(() => localPreviewUrl.value || props.previewUrl)
const displayMime = computed(() => props.mimeType)
const hasFile = computed(() => Boolean(props.fileId))
const showImage = computed(() => Boolean(displayPreview.value) && (isLogo.value || isImageMime(displayMime.value)))
const attachmentLabel = computed(() => props.fileName || companyAttachmentLabel(displayMime.value || null))
const canChange = computed(() => !props.disabled && !props.readonly)

const previewFile = computed(() => props.fileId
  ? {
      id: props.fileId,
      mimeType: displayMime.value || 'application/octet-stream',
      originalName: attachmentLabel.value,
    }
  : null)

function revokeLocalPreview(): void {
  if (localPreviewUrl.value) {
    URL.revokeObjectURL(localPreviewUrl.value)
    localPreviewUrl.value = ''
  }
}

watch(() => props.previewUrl, (next) => {
  if (next && localPreviewUrl.value) {
    revokeLocalPreview()
  }
})

onBeforeUnmount(() => {
  revokeLocalPreview()
})

function openReplace(): void {
  if (!canChange.value) {
    return
  }
  uploaderFiles.value = []
  replaceVisible.value = true
}

function closeReplace(): void {
  replaceVisible.value = false
  uploaderFiles.value = []
}

function applyFile(file: CompanySelectedFile): void {
  emit('change', file)
  closeReplace()
}

function onUploaded(file: File, result: CompleteUploadResult): void {
  revokeLocalPreview()
  const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
  if (previewUrl) {
    localPreviewUrl.value = previewUrl
  }
  applyFile({
    fileId: result.fileId,
    mimeType: file.type,
    name: file.name,
    previewUrl: '',
  })
}

async function onPicked(file: FileCenterItem): Promise<void> {
  revokeLocalPreview()
  let previewUrl = ''
  if (file.mimeType.startsWith('image/')) {
    try {
      const result = await fetchFileDownloadUrl(file.id)
      previewUrl = result.url
    }
    catch {
      previewUrl = ''
    }
  }
  applyFile({
    fileId: file.id,
    mimeType: file.mimeType,
    name: file.originalName,
    previewUrl,
  })
}
</script>

<template>
  <div class="company-file-field">
    <div class="company-file-field__preview" :class="{ 'is-logo': isLogo }">
      <img
        v-if="showImage"
        :alt="isLogo ? '企业 Logo' : '资质附件'"
        class="company-file-field__image"
        :src="displayPreview"
      >
      <span v-else class="company-file-field__placeholder">
        {{ hasFile ? attachmentLabel : (isLogo ? '未上传 Logo' : '未上传附件') }}
      </span>
    </div>
    <div class="company-file-field__actions">
      <t-button
        v-if="hasFile"
        theme="default"
        variant="outline"
        @click="previewVisible = true"
      >
        预览
      </t-button>
      <t-button
        v-if="canChange"
        theme="default"
        variant="outline"
        @click="openReplace"
      >
        {{ hasFile ? '更换' : '上传' }}
      </t-button>
    </div>
  </div>

  <t-dialog
    :cancel-btn="{ content: '取消' }"
    :confirm-btn="null"
    :header="isLogo ? '选择企业 Logo' : '选择资质附件'"
    :visible="replaceVisible"
    width="520px"
    @close="closeReplace"
    @update:visible="replaceVisible = $event"
  >
    <AppFileUploader
      :accept="accept"
      :allowed-mime-types="allowedMimeTypes"
      :draggable="false"
      :max="1"
      :multiple="false"
      :placeholder="isLogo ? '上传 Logo' : '上传附件'"
      :tips="unsupportedTypeMessage"
      :unsupported-type-message="unsupportedTypeMessage"
      v-model="uploaderFiles"
      @success="onUploaded"
    />
    <t-button class="company-file-field__picker" theme="default" variant="outline" @click="pickerVisible = true">
      从文件中心选择
    </t-button>
  </t-dialog>

  <AppFilePicker
    :accept="pickerAccept"
    :title="isLogo ? '选择企业 Logo' : '选择资质附件'"
    v-model:visible="pickerVisible"
    @confirm="onPicked"
  />
  <AppFilePreview
    :file="previewFile"
    :visible="previewVisible"
    @close="previewVisible = false"
  />
</template>

<style scoped>
.company-file-field {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-3);
}

.company-file-field__preview {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.company-file-field__preview.is-logo {
  width: 72px;
  height: 72px;
  flex: none;
}

.company-file-field__image {
  width: 72px;
  height: 72px;
  object-fit: contain;
}

.company-file-field__placeholder {
  padding: 0 var(--td-size-3);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.company-file-field__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-size-2);
}

.company-file-field__picker {
  margin-top: var(--td-size-3);
}
</style>

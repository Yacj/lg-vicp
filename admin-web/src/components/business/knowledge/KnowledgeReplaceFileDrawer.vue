<script setup lang="ts">
import type { UploadFile } from 'tdesign-vue-next'
import { ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { replaceKnowledgeDocumentFile } from '@/api/modules/knowledge'
import AppFilePicker from '@/components/business/AppFilePicker.vue'
import AppFileUploader from '@/components/business/AppFileUploader.vue'
import KnowledgeFileCard from '@/components/business/knowledge/KnowledgeFileCard.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import type { CompleteUploadResult, FileCenterItem } from '@/types/file'
import type { KnowledgeSelectedFile } from '@/types/knowledge'
import { knowledgeUserMessage } from '@/utils/knowledge-user'

const props = defineProps<{
  visible: boolean
  documentId: string
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  'replaced': []
}>()

const submitting = ref(false)
const pickerVisible = ref(false)
const uploaderFiles = ref<UploadFile[]>([])
const selectedFile = ref<KnowledgeSelectedFile | null>(null)

function close(): void {
  if (submitting.value) {
    return
  }
  emit('update:visible', false)
}

async function submit(): Promise<void> {
  if (!selectedFile.value) {
    MessagePlugin.warning('请先选择要更换的知识文件')
    return
  }
  submitting.value = true
  try {
    await replaceKnowledgeDocumentFile(props.documentId, { originalFileId: selectedFile.value.fileId })
    emit('replaced')
    emit('update:visible', false)
  }
  catch (cause) {
    MessagePlugin.error(knowledgeUserMessage(normalizeFeedbackError(cause).message))
  }
  finally {
    submitting.value = false
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      selectedFile.value = null
      uploaderFiles.value = []
    }
  },
)
</script>

<template>
  <t-drawer
    :cancel-btn="{ content: '取消', disabled: submitting }"
    :confirm-btn="{ content: '更换并解析', loading: submitting, disabled: submitting || !selectedFile, theme: 'primary' }"
    header="更换文件"
    :visible="visible"
    size="520px"
    @cancel="close"
    @close="close"
    @confirm="submit"
    @update:visible="(value: boolean) => emit('update:visible', value)"
  >
    <p class="knowledge-replace__hint">
      更换文件会创建新的历史版本并自动解析，旧版本仍可查看。
    </p>
    <KnowledgeFileCard
      v-if="selectedFile"
      :file="selectedFile"
      :previewable="false"
      @replace="selectedFile = null"
    />
    <div v-else class="knowledge-replace__upload">
      <AppFileUploader
        accept=".pdf,.docx"
        :max="1"
        :multiple="false"
        placeholder="上传新文件"
        v-model="uploaderFiles"
        @success="(file: File, result: CompleteUploadResult) => { selectedFile = { fileId: result.fileId, name: file.name, mimeType: file.type, sizeBytes: file.size } }"
      />
      <t-button theme="default" variant="outline" @click="pickerVisible = true">
        从文件中心选择
      </t-button>
    </div>
    <AppFilePicker v-model:visible="pickerVisible" @confirm="(file: FileCenterItem) => { selectedFile = { fileId: file.id, name: file.originalName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, fromCenter: true } }" />
  </t-drawer>
</template>

<style scoped>
.knowledge-replace__hint {
  margin: 0 0 var(--td-size-5);
  color: var(--td-text-color-secondary);
}

.knowledge-replace__upload {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-4);
}
</style>

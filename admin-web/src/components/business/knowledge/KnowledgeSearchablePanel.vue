<script setup lang="ts">
import type { UploadFile } from 'tdesign-vue-next'
import { ref } from 'vue'
import AppFilePicker from '@/components/business/AppFilePicker.vue'
import AppFileUploader from '@/components/business/AppFileUploader.vue'
import KnowledgeFileCard from '@/components/business/knowledge/KnowledgeFileCard.vue'
import type { CompleteUploadResult, FileCenterItem } from '@/types/file'
import type { KnowledgeSelectedFile } from '@/types/knowledge'

const props = withDefaults(defineProps<{
  file?: KnowledgeSelectedFile | null
}>(), {
  file: null,
})

const emit = defineEmits<{
  bind: [file: KnowledgeSelectedFile]
  browseOnly: []
}>()

const pickerVisible = ref(false)
const uploaderFiles = ref<UploadFile[]>([])

function emitFile(file: KnowledgeSelectedFile): void {
  emit('bind', file)
}

function onUploaded(file: File, result: CompleteUploadResult): void {
  emitFile({
    fileId: result.fileId,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    fromCenter: false,
  })
}

function onPicked(file: FileCenterItem): void {
  emitFile({
    fileId: file.id,
    name: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    fromCenter: true,
  })
}
</script>

<template>
  <section class="knowledge-searchable">
    <h2>需要补充可搜索文字</h2>
    <p>
      这份 PDF 可以打开查看，但系统读不出其中的文字。请再选一份能搜索文字的版本，提问时才用得上。
    </p>
    <KnowledgeFileCard
      v-if="file"
      :file="file"
      :previewable="false"
      :replaceable="false"
    />
    <div class="knowledge-searchable__actions">
      <t-button theme="primary" variant="outline" @click="pickerVisible = true">
        从文件中心选择
      </t-button>
      <AppFileUploader
        accept=".pdf,.docx"
        :draggable="false"
        :max="1"
        :multiple="false"
        placeholder="上传文字版本"
        v-model="uploaderFiles"
        @success="onUploaded"
      />
      <t-button theme="default" variant="text" @click="emit('browseOnly')">
        只查看原文件
      </t-button>
    </div>
    <AppFilePicker
      v-model:visible="pickerVisible"
      confirm-text="使用此文字版本"
      title="选择可搜索文字版本"
      @confirm="onPicked"
    />
  </section>
</template>

<style scoped>
.knowledge-searchable {
  max-width: 720px;
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-xl);
  border: 1px solid var(--td-warning-color-3);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.knowledge-searchable h2,
.knowledge-searchable p {
  margin: 0;
}

.knowledge-searchable h2 {
  color: var(--td-warning-color);
  font-size: var(--td-font-size-title-medium);
}

.knowledge-searchable p {
  margin: var(--td-size-3) 0 var(--td-size-5);
  color: var(--td-text-color-secondary);
  line-height: 1.7;
}

.knowledge-searchable__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-3);
  margin-top: var(--td-size-5);
}
</style>

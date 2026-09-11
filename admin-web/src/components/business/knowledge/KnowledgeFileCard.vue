<script setup lang="ts">
import type { KnowledgeSelectedFile } from '@/types/knowledge'
import { knowledgeFileKind } from '@/utils/knowledge-user'
import { formatFileSize } from '@/utils/report'

withDefaults(defineProps<{
  file: KnowledgeSelectedFile
  hint?: string
  replaceable?: boolean
  previewable?: boolean
}>(), {
  hint: '',
  replaceable: true,
  previewable: true,
})

const emit = defineEmits<{
  preview: []
  replace: []
}>()
</script>

<template>
  <article class="knowledge-file-card">
    <div class="knowledge-file-card__kind">
      {{ knowledgeFileKind(file.mimeType, file.name) }}
    </div>
    <div class="knowledge-file-card__body">
      <strong>{{ file.name }}</strong>
      <span>{{ formatFileSize(file.sizeBytes) }}</span>
      <span class="knowledge-file-card__ok">已选择</span>
      <p v-if="hint || file.fromCenter" class="knowledge-file-card__hint">
        {{ hint || (file.fromCenter ? '已从文件中心使用，不会重复上传' : '') }}
      </p>
    </div>
    <div class="knowledge-file-card__actions">
      <t-button v-if="previewable" size="small" theme="primary" variant="text" @click="emit('preview')">
        预览
      </t-button>
      <t-button v-if="replaceable" size="small" theme="default" variant="text" @click="emit('replace')">
        更换
      </t-button>
    </div>
  </article>
</template>

<style scoped>
.knowledge-file-card {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: var(--td-size-4);
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-l);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.knowledge-file-card__kind {
  flex: 0 0 auto;
  padding: 2px 8px;
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  border-radius: var(--td-radius-small);
  font-size: var(--td-font-size-body-small);
  font-weight: 600;
}

.knowledge-file-card__body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.knowledge-file-card__body strong {
  overflow: hidden;
  color: var(--td-text-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-file-card__body span,
.knowledge-file-card__hint {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-file-card__ok {
  color: var(--td-success-color);
}

.knowledge-file-card__hint {
  margin: var(--td-size-1) 0 0;
}

.knowledge-file-card__actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--td-size-1);
}
</style>

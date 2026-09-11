<script setup lang="ts">
import KnowledgePageView from '@/components/business/KnowledgePageView.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import type { KnowledgePage } from '@/types/knowledge'
import { knowledgePageLabel } from '@/utils/knowledge-user'

withDefaults(defineProps<{
  title?: string
  page?: KnowledgePage | null
  loading?: boolean
  canPreview?: boolean
}>(), {
  title: '',
  page: null,
  loading: false,
  canPreview: false,
})

const emit = defineEmits<{
  previewPage: []
}>()
</script>

<template>
  <section class="knowledge-parsed-content">
    <div class="knowledge-parsed-content__head">
      <div>
        <h2>{{ title || page?.pageTitle || '解析内容' }}</h2>
        <p v-if="page">
          {{ knowledgePageLabel(page.pageLabel, page.physicalPageNumber) }}
        </p>
      </div>
      <t-button
        v-if="canPreview && page"
        size="small"
        theme="primary"
        variant="outline"
        @click="emit('previewPage')"
      >
        查看原文件对应页
      </t-button>
    </div>

    <t-loading :loading="loading" text="正在加载解析内容">
      <KnowledgePageView
        v-if="page"
        :blocks="page.blocks"
        :full-text="page.extractedText ?? page.parsedText ?? ''"
        :page-image-url="page.pageImageUrl"
        :page-number="page.physicalPageNumber"
      />
      <AppEmptyState
        v-else-if="!loading"
        description="你仍然可以查看解析内容，也可以重新解析或进入高级设置校正章节。"
        size="small"
        title="暂未识别到章节"
      />
    </t-loading>
  </section>
</template>

<style scoped>
.knowledge-parsed-content {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  background: var(--td-bg-color-container);
}

.knowledge-parsed-content__head {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--td-size-4);
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-xl);
  border-bottom: 1px solid var(--td-component-stroke);
}

.knowledge-parsed-content__head h2,
.knowledge-parsed-content__head p {
  margin: 0;
}

.knowledge-parsed-content__head h2 {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
  font-weight: 600;
}

.knowledge-parsed-content__head p {
  margin-top: 4px;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-parsed-content :deep(.ks-page-view) {
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-xl);
}
</style>

<script setup lang="ts">
import type { KnowledgePage } from '@/types/knowledge'
import KnowledgePageView from '@/components/business/KnowledgePageView.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import { knowledgePageLabel } from '@/utils/knowledge-user'

withDefaults(defineProps<{
  title?: string
  page?: KnowledgePage | null
  loading?: boolean
  canPreview?: boolean
  /** 标识机器提取文本通道，不是页面视觉。 */
  machineText?: boolean
  unconfirmed?: boolean
}>(), {
  title: '',
  page: null,
  loading: false,
  canPreview: false,
  machineText: false,
  unconfirmed: false,
})

const emit = defineEmits<{
  previewPage: []
  openGallery: []
  openRecognition: []
}>()
</script>

<template>
  <section class="knowledge-parsed-content">
    <div class="knowledge-parsed-content__head">
      <div>
        <h2>{{ title || page?.pageTitle || '解析内容' }}</h2>
        <p v-if="machineText" class="knowledge-parsed-content__badge">
          机器提取文本 · 非页面视觉
        </p>
        <p v-else-if="page">
          {{ knowledgePageLabel(page.pageLabel, page.physicalPageNumber) }}
        </p>
      </div>
      <t-space>
        <t-button
          v-if="page && !machineText"
          size="small"
          theme="default"
          variant="outline"
          @click="emit('openGallery')"
        >
          查看资料页面
        </t-button>
        <t-button
          v-if="canPreview && page"
          size="small"
          theme="primary"
          variant="outline"
          @click="emit('previewPage')"
        >
          查看原文件对应页
        </t-button>
      </t-space>
    </div>

    <t-loading :loading="loading" text="正在加载解析内容">
      <AppEmptyState
        v-if="page && unconfirmed && !page.parsedText && !page.blocks?.length"
        description="这一页尚未完成识别核对，正式正文暂不可查看。可查看原图或前往核对识别结果。"
        size="small"
        title="页面待核对"
      >
        <template #action><t-button theme="primary" @click="emit('openRecognition')">前往核对</t-button></template>
      </AppEmptyState>
      <KnowledgePageView
        v-else-if="page"
        :blocks="page.blocks"
        :full-text="page.extractedText ?? page.parsedText ?? ''"
        :page-image-url="null"
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

.knowledge-parsed-content__badge {
  display: inline-flex;
  margin-top: 6px;
  padding: 2px 8px;
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  border-radius: var(--td-radius-small);
  font-size: var(--td-font-size-body-small);
}

.knowledge-parsed-content :deep(.ks-page-view) {
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-xl);
}
</style>

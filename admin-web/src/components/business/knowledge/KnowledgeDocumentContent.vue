<script setup lang="ts">
import { computed } from 'vue'
import { renderKnowledgeDocument } from '@/utils/knowledge-document'
import type { HighlightRangeInput } from '@/utils/highlight'
const props = withDefaults(defineProps<{ content?: string | null, ranges?: Array<Pick<HighlightRangeInput, 'charStart' | 'charEnd'>> }>(), { content: '', ranges: () => [] })
const html = computed(() => renderKnowledgeDocument(props.content ?? '', props.ranges))
</script>

<template>
  <article v-if="content" class="knowledge-document-content" v-html="html" />
  <p v-else class="knowledge-document-content__empty">该页暂无正文内容</p>
</template>

<style scoped>
.knowledge-document-content { color: var(--td-text-color-primary); font-size: var(--td-font-size-body-medium); line-height: 1.85; overflow-wrap: anywhere; }
.knowledge-document-content :deep(> :first-child) { margin-top: 0; }
.knowledge-document-content :deep(h1), .knowledge-document-content :deep(h2) { margin: var(--td-size-5) 0 var(--td-size-3); font: var(--td-font-title-medium); }
.knowledge-document-content :deep(h3), .knowledge-document-content :deep(h4), .knowledge-document-content :deep(h5), .knowledge-document-content :deep(h6) { margin: var(--td-size-4) 0 var(--td-size-2); font: var(--td-font-title-small); }
.knowledge-document-content :deep(p) { margin: 0 0 var(--td-size-3); }
.knowledge-document-content :deep(ul), .knowledge-document-content :deep(ol) { padding-left: var(--td-size-6); }
.knowledge-document-content :deep(li) { margin: var(--td-size-1) 0; }
.knowledge-document-content :deep(table) { display: block; max-width: 100%; overflow: auto; border-collapse: collapse; margin: var(--td-size-3) 0; font-variant-numeric: tabular-nums; }
.knowledge-document-content :deep(th), .knowledge-document-content :deep(td) { padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-m); border: 1px solid var(--td-component-stroke); white-space: nowrap; }
.knowledge-document-content :deep(th) { background: var(--td-bg-color-secondarycontainer); font-weight: bold; }
.knowledge-document-content :deep(blockquote) { padding-left: var(--td-size-3); margin-left: 0; border-left: 2px solid var(--td-component-stroke); color: var(--td-text-color-secondary); }
.knowledge-document-content :deep(pre) { overflow: auto; padding: var(--td-size-3); background: var(--td-bg-color-secondarycontainer); }
.knowledge-document-content :deep(a) { color: var(--td-brand-color); }
.knowledge-document-content :deep(mark) { background: var(--td-warning-color-1); color: inherit; }
.knowledge-document-content__empty { color: var(--td-text-color-secondary); }
</style>

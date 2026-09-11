<script setup lang="ts">
import type { KnowledgePageMapping } from '@/types/knowledge'
import { computed } from 'vue'

const props = defineProps<{ mappings: KnowledgePageMapping[], pages?: Array<{ id: string, physicalPageNumber: number, pageLabel: string | null }>, editable?: boolean, saving?: boolean }>()
const emit = defineEmits<{ verify: [mapping: KnowledgePageMapping], autoMatch: [], batchConfirm: [] }>()
const rows = computed(() => props.mappings.map((mapping) => {
  const original = props.pages?.find(page => page.id === mapping.originalPageId)
  return {
    ...mapping,
    originalPhysicalPageNumber: mapping.originalPhysicalPageNumber ?? original?.physicalPageNumber ?? null,
    originalPageLabel: original?.pageLabel ?? mapping.pageLabel,
  }
}))
const methodLabel: Record<string, string> = { PAGE_LABEL: '按页码', TOC_TITLE: '按章节标题', MANUAL: '人工对应' }
</script>

<template>
  <div class="knowledge-mapping">
    <div class="knowledge-mapping__toolbar"><span>把可搜索文字版本的页，对到原文件对应页</span><t-space v-if="editable"><t-button size="small" variant="outline" @click="emit('autoMatch')">自动对应</t-button><t-button size="small" theme="primary" :loading="saving" @click="emit('batchConfirm')">全部确认</t-button></t-space></div>
    <t-table :data="rows" row-key="id" size="small" :columns="[
      { colKey: 'status', title: '状态', width: 70 },
      { colKey: 'pageLabel', title: '印刷页码', width: 110 },
      { colKey: 'searchPhysicalPageNumber', title: '文字版本页', width: 140 },
      { colKey: 'originalPhysicalPageNumber', title: '原文件页', width: 150 },
      { colKey: 'mappingMethod', title: '对应方式', width: 120 },
      { colKey: 'confidence', title: '把握', width: 90 },
      { colKey: 'actions', title: '操作', width: 90 },
    ]">
      <template #status="{ row }"><t-tag size="small" :theme="row.verified ? 'success' : 'warning'">{{ row.verified ? '✓' : '!' }}</t-tag></template>
      <template #pageLabel="{ row }">{{ row.originalPageLabel || row.pageLabel || '—' }}</template>
      <template #originalPhysicalPageNumber="{ row }">{{ row.originalPhysicalPageNumber ?? '待对应' }}</template>
      <template #mappingMethod="{ row }">{{ methodLabel[row.mappingMethod] ?? row.mappingMethod }}</template>
      <template #confidence="{ row }">{{ row.confidence == null ? '—' : `${Math.round(row.confidence * 100)}%` }}</template>
      <template #actions="{ row }"><t-button v-if="editable && !row.verified" size="small" variant="text" theme="primary" @click="emit('verify', row)">确认对应</t-button></template>
    </t-table>
    <div v-if="rows.length === 0" class="knowledge-mapping__empty">还没有页面对应关系。文字版本和原文件页数不同时，需要人工对一下。</div>
  </div>
</template>

<style scoped>
.knowledge-mapping { display: flex; flex-direction: column; gap: 12px; }
.knowledge-mapping__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--td-text-color-secondary); font-size: var(--td-font-size-body-small); }
.knowledge-mapping__empty { padding: 36px 0; color: var(--td-text-color-placeholder); text-align: center; }
</style>

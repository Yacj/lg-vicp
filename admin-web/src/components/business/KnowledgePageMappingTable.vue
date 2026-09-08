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
const methodLabel: Record<string, string> = { PAGE_LABEL: '页码标签', TOC_TITLE: '目录标题', MANUAL: '人工绑定' }
</script>

<template>
  <div class="knowledge-mapping">
    <div class="knowledge-mapping__toolbar"><span>检索文件页 ↔ 正式原文件页，不按物理页号默认相等</span><t-space v-if="editable"><t-button size="small" variant="outline" @click="emit('autoMatch')">自动匹配</t-button><t-button size="small" theme="primary" :loading="saving" @click="emit('batchConfirm')">批量确认</t-button></t-space></div>
    <t-table :data="rows" row-key="id" size="small" :columns="[
      { colKey: 'status', title: '状态', width: 70 },
      { colKey: 'pageLabel', title: '图集页码', width: 110 },
      { colKey: 'searchPhysicalPageNumber', title: '检索文件物理页', width: 140 },
      { colKey: 'originalPhysicalPageNumber', title: '正式原文件物理页', width: 150 },
      { colKey: 'mappingMethod', title: '映射方式', width: 120 },
      { colKey: 'confidence', title: '置信度', width: 90 },
      { colKey: 'actions', title: '操作', width: 90 },
    ]">
      <template #status="{ row }"><t-tag size="small" :theme="row.verified ? 'success' : 'warning'">{{ row.verified ? '✓' : '!' }}</t-tag></template>
      <template #pageLabel="{ row }">{{ row.originalPageLabel || row.pageLabel || '—' }}</template>
      <template #originalPhysicalPageNumber="{ row }">{{ row.originalPhysicalPageNumber ?? '待人工绑定' }}</template>
      <template #mappingMethod="{ row }">{{ methodLabel[row.mappingMethod] ?? row.mappingMethod }}</template>
      <template #confidence="{ row }">{{ row.confidence == null ? '—' : `${Math.round(row.confidence * 100)}%` }}</template>
      <template #actions="{ row }"><t-button v-if="editable && !row.verified" size="small" variant="text" theme="primary" @click="emit('verify', row)">人工绑定</t-button></template>
    </t-table>
    <div v-if="rows.length === 0" class="knowledge-mapping__empty">暂无页面映射。检索文件与正式原文件页数不同或未生成映射时，需要人工绑定。</div>
  </div>
</template>

<style scoped>
.knowledge-mapping { display: flex; flex-direction: column; gap: 12px; }
.knowledge-mapping__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--td-text-color-secondary); font-size: var(--td-font-size-body-small); }
.knowledge-mapping__empty { padding: 36px 0; color: var(--td-text-color-placeholder); text-align: center; }
</style>

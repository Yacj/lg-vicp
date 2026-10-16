<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { KnowledgePageRenderModel, ReferenceHighlight } from '@/types/knowledge-page-render'
import { computed } from 'vue'
import { formatThermalNumber, resolveReferenceHighlights } from '@/utils/knowledge-page-render'
import { constructionLabel, thermalColumnHeader } from '@/utils/knowledge-thermal-labels'

const props = defineProps<{ model: KnowledgePageRenderModel, matches: ReferenceHighlight[], pageId: string, pageLabel?: string | null }>()
const emit = defineEmits<{ locate: [match: ReferenceHighlight] }>()
const rows = computed(() => resolveReferenceHighlights(props.model, props.matches, props.pageId).flatMap((match) => {
  const construction = props.model.constructions.find(item => item.constructionId === match.constructionId)
  const option = construction?.options.find(item => item.optionId === match.optionId)
  return construction && option ? [{ ...option, match, viewerKey: `${construction.constructionId}:${option.optionId}`, label: constructionLabel(construction), pageLabel: props.pageLabel || props.model.pageLabel || '待核' }] : []
}))
const columns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  { colKey: 'label', title: '命中构造', minWidth: 180 },
  ...(['thicknessMm', 'totalThermalResistance', 'kValue'] as const).map((field) => {
    const title = thermalColumnHeader(props.model.constructions, field)
    return { colKey: field, title: `${title.label}${title.unit ? ` (${title.unit})` : ''}`, minWidth: 140, cell: (_: unknown, { row }: { row: TableRowData }) => field === 'thicknessMm' ? String(row[field] ?? '—') : formatThermalNumber(row[field]) }
  }),
  { colKey: 'pageLabel', title: '印刷页码', width: 90 },
])
</script>

<template>
  <section v-if="rows.length" class="answer-match-summary" aria-label="命中参数对比">
    <strong>命中参数对比</strong>
    <t-table :data="rows" :columns="columns" row-key="viewerKey" size="small" bordered table-content-width="800px" />
    <t-space break-line>
      <t-button v-for="row in rows" :key="row.viewerKey" size="small" variant="text" @click="emit('locate', row.match)">
        定位 {{ row.label }} · {{ row.thicknessMm }}mm
      </t-button>
    </t-space>
  </section>
</template>

<style scoped>
.answer-match-summary { overflow-x: auto; margin-bottom: var(--td-size-4); }
.answer-match-summary > strong { display: block; margin-bottom: var(--td-size-2); }
</style>

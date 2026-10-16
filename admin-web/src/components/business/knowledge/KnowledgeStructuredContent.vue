<script setup lang="ts">
import type { KnowledgePageRenderModel, ReferenceHighlight } from '@/types/knowledge-page-render'
import { constructionLabel } from '@/utils/knowledge-thermal-labels'
import KnowledgeDocumentContent from './KnowledgeDocumentContent.vue'
import ThermalOptionTable from './ThermalOptionTable.vue'
defineProps<{ model: KnowledgePageRenderModel, matches: ReferenceHighlight[], active?: ReferenceHighlight, hasOriginalImage?: boolean }>()
const emit = defineEmits<{ viewOriginal: [] }>()
</script>

<template>
  <div>
    <KnowledgeDocumentContent v-for="(paragraph, index) in model.paragraphs" :key="`text-${index}`" :content="paragraph" />
    <p v-if="hasOriginalImage" class="structured-image-hint">构造简图保留在页面原图中。<t-button size="small" variant="text" @click="emit('viewOriginal')">查看构造简图及原页</t-button></p>
    <p class="structured-image-hint">栏目沿用来源原文；源文名称与工程定义不一致时，请结合原图核对。材料层热阻与产品整体热阻分别列示，未给出的值不补算。</p>
    <ThermalOptionTable :constructions="model.constructions" :matches="matches" :active="active" />
    <details v-if="model.constructions.some(item => item.sourceColumns?.length)" class="construction-notes">
      <summary>查看各构造原表栏目与单位</summary>
      <section v-for="construction in model.constructions" :key="construction.constructionId">
        <h3>{{ constructionLabel(construction) }}</h3>
        <ul><li v-for="(column, index) in construction.sourceColumns" :key="index">{{ [column.groupLabel, column.label, column.symbol, column.unit].filter(Boolean).join(' · ') }}{{ column.scope === 'UNKNOWN' ? '（工程含义待核）' : '' }}</li></ul>
      </section>
    </details>
    <template v-for="construction in model.constructions" :key="construction.constructionId">
      <section v-if="construction.notes?.length" class="construction-notes"><h3>{{ construction.constructionCode || construction.title || '构造' }} 备注</h3><KnowledgeDocumentContent v-for="(note, index) in construction.notes" :key="index" :content="note" /></section>
    </template>
    <KnowledgeDocumentContent v-for="(note, index) in model.notes" :key="`note-${index}`" :content="note" />
    <details v-if="model.warnings?.length"><summary>待核对提示（{{ model.warnings.length }}）</summary><ul><li v-for="warning in model.warnings" :key="warning">{{ warning }}</li></ul></details>
  </div>
</template>

<style scoped>
.structured-image-hint { display: flex; flex-wrap: wrap; align-items: center; margin: 0 0 var(--td-size-3); color: var(--td-text-color-secondary); font-size: var(--td-font-size-body-small); }
.construction-notes { margin-top: var(--td-size-4); }
.construction-notes h3 { font-size: var(--td-font-size-title-small); margin: 0 0 var(--td-size-3); }
</style>

<script setup lang="ts">
import type { KnowledgePageRenderModel, ReferenceHighlight } from '@/types/knowledge-page-render'
import ThermalOptionTable from './ThermalOptionTable.vue'
import KnowledgeDocumentContent from './KnowledgeDocumentContent.vue'
defineProps<{ model: KnowledgePageRenderModel, matches: ReferenceHighlight[], active?: ReferenceHighlight, hasOriginalImage?: boolean }>()
const emit = defineEmits<{ viewOriginal: [] }>()
</script>

<template>
  <div>
    <KnowledgeDocumentContent v-for="(paragraph, index) in model.paragraphs" :key="`text-${index}`" :content="paragraph" />
    <p v-if="hasOriginalImage" class="structured-image-hint">构造简图保留在页面原图中。<t-button size="small" variant="text" @click="emit('viewOriginal')">查看构造简图及原页</t-button></p>
    <ThermalOptionTable :constructions="model.constructions" :matches="matches" :active="active" />
    <template v-for="construction in model.constructions" :key="construction.constructionId">
      <section v-if="construction.notes?.length" class="construction-notes"><h3>{{ construction.constructionCode || construction.title || '构造' }} 备注</h3><KnowledgeDocumentContent v-for="(note, index) in construction.notes" :key="index" :content="note" /></section>
    </template>
    <KnowledgeDocumentContent v-for="(note, index) in model.notes" :key="`note-${index}`" :content="note" />
  </div>
</template>

<style scoped>
.structured-image-hint { display: flex; flex-wrap: wrap; align-items: center; margin: 0 0 var(--td-size-3); color: var(--td-text-color-secondary); font-size: var(--td-font-size-body-small); }
.construction-notes { margin-top: var(--td-size-4); }
.construction-notes h3 { font-size: var(--td-font-size-title-small); margin: 0 0 var(--td-size-3); }
</style>

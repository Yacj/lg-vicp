<script setup lang="ts">
import type { KnowledgeConstructionContent, ReferenceHighlight } from '@/types/knowledge-page-render'
import { computed } from 'vue'
import ThermalOptionTable from './ThermalOptionTable.vue'
import KnowledgeDocumentContent from './KnowledgeDocumentContent.vue'

const props = defineProps<{ construction: KnowledgeConstructionContent, matches: ReferenceHighlight[], activeOptionId?: string | null }>()
const title = computed(() => {
  const { title, systemName, constructionCode } = props.construction
  if (title) return title
  if (systemName && constructionCode && systemName.endsWith(constructionCode)) return systemName
  return [systemName, constructionCode].filter(Boolean).join(' ') || '构造'
})
</script>

<template>
  <section class="construction-section" :data-construction-id="construction.constructionId" :class="{ 'is-hit': matches.some(match => match.constructionId === construction.constructionId && !match.optionId) }">
    <header>
      <h3>{{ title }}</h3>
      <span v-if="construction.title && construction.constructionCode">{{ construction.constructionCode }}</span>
      <small v-if="construction.options.length">{{ construction.options.length }} 个厚度档位 · 已展开全部</small>
    </header>
    <ThermalOptionTable v-if="construction.layers.length || construction.options.length" :construction="construction" :matches="matches" :active-option-id="activeOptionId" />
    <KnowledgeDocumentContent v-for="(note, index) in construction.notes" :key="index" :content="note" />
  </section>
</template>

<style scoped>
.construction-section { padding: var(--td-size-4) 0; border-bottom: 1px solid var(--td-component-stroke); scroll-margin-top: var(--td-size-4); }
.construction-section:last-child { border-bottom: 0; }
.construction-section header { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--td-size-3); margin-bottom: var(--td-size-3); }
h3 { margin: 0; }
h3 { font: var(--td-font-title-medium); }
small { font-weight: normal; color: var(--td-text-color-secondary); }
.is-hit { background: var(--td-warning-color-1); }
</style>

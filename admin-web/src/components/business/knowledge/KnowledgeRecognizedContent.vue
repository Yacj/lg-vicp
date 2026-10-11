<script setup lang="ts">
import type { PageRecognitionSystem } from '@/types/knowledge'
import { computed } from 'vue'
import ThermalOptionTable from './ThermalOptionTable.vue'
import KnowledgeDocumentContent from './KnowledgeDocumentContent.vue'
import { recognitionConstructionContent } from '@/utils/knowledge-document'
const props = defineProps<{ systems: PageRecognitionSystem[], notes?: string[] }>()
const constructions = computed(() => props.systems.map(recognitionConstructionContent))
</script>

<template>
  <div class="knowledge-recognized-content">
    <ThermalOptionTable :constructions="constructions" />
    <template v-for="(construction, index) in constructions" :key="index">
      <section v-if="construction.notes?.length" class="knowledge-recognized-content__notes"><h3>{{ construction.constructionCode || construction.title || '构造' }} 备注</h3><KnowledgeDocumentContent v-for="(note, noteIndex) in construction.notes" :key="noteIndex" :content="note" /></section>
    </template>
    <section v-if="notes?.length" class="knowledge-recognized-content__notes"><h3>页面备注</h3><KnowledgeDocumentContent v-for="(note, index) in notes" :key="index" :content="note" /></section>
  </div>
</template>

<style scoped>
.knowledge-recognized-content__notes { padding-top: var(--td-size-4); }
.knowledge-recognized-content__notes h3 { font-size: var(--td-font-size-title-small); margin: 0 0 var(--td-size-3); }
</style>

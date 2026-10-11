<script setup lang="ts">
import type { PageRecognitionSystem } from '@/types/knowledge'
import KnowledgeDocumentContent from '../KnowledgeDocumentContent.vue'
import KnowledgeRecognizedContent from '../KnowledgeRecognizedContent.vue'
import { useKnowledgeTextPreview } from '@/composables/useKnowledgeTextPreview'
const props = withDefaults(defineProps<{ readonly?: boolean, pageId?: string | null, systems?: PageRecognitionSystem[], notes?: string[] }>(), { readonly: false, systems: () => [] })

/** 识别草稿正文：页面全文（用于页面分块与检索）。 */
const fullText = defineModel<string>('fullText', { default: '' })
const { editing, toggle } = useKnowledgeTextPreview(() => ({ readonly: props.readonly, pageId: props.pageId }))
</script>

<template>
  <section class="recognition-text">
    <header class="recognition-text__header"><h3>页面内容</h3><t-button v-if="!readonly" size="small" variant="outline" @click="toggle">{{ editing ? '查看排版' : '编辑原文' }}</t-button></header>
    <t-form v-if="editing" label-align="top">
      <t-form-item label="页面原文">
      <t-textarea
        v-model="fullText"
        :autosize="{ minRows: 4, maxRows: 10 }"
        :disabled="readonly"
        placeholder="AI 识别出的页面文字，可在确认前人工修正"
      />
      </t-form-item>
    </t-form>
    <template v-else-if="systems.length">
      <KnowledgeRecognizedContent :systems="systems" :notes="notes" />
      <details v-if="fullText" class="recognition-text__original"><summary>查看页面原文</summary><KnowledgeDocumentContent :content="fullText" /></details>
    </template>
    <KnowledgeDocumentContent v-else :content="fullText" />
  </section>
</template>

<style scoped>
.recognition-text { min-width: 0; padding: var(--td-size-4); border: 1px solid var(--td-component-stroke); border-radius: var(--td-radius-default); background: var(--td-bg-color-container); }
.recognition-text__header { display: flex; justify-content: space-between; align-items: center; gap: var(--td-size-3); margin-bottom: var(--td-size-3); }
.recognition-text__header h3 { margin: 0; font-size: var(--td-font-size-title-small); }
.recognition-text__original { padding-top: var(--td-size-3); }
.recognition-text__original summary { cursor: pointer; color: var(--td-brand-color); margin-bottom: var(--td-size-3); }
</style>

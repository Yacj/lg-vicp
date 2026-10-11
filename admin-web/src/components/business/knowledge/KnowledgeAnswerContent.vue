<script setup lang="ts">
import type { KnowledgeReferencePageBlock } from '@/types/knowledge'
import { computed } from 'vue'
import AppMarkdown from '@/components/ui/AppMarkdown.vue'
import KnowledgeAnswerReferencePage from './KnowledgeAnswerReferencePage.vue'
import { knowledgeAnswerContent } from '@/utils/knowledge-answer'
const props = defineProps<{ answer: string, referencePages: KnowledgeReferencePageBlock[], complete: boolean, hasSources: boolean }>()
const content = computed(() => knowledgeAnswerContent(props.answer, props.referencePages))
</script>

<template>
  <div class="knowledge-answer-content">
    <div v-for="(block, index) in content.blocks" :key="index" class="knowledge-answer-content__block">
      <AppMarkdown :content="block.content" />
      <KnowledgeAnswerReferencePage v-for="group in block.groups" :key="group.key" :group="group" />
    </div>
    <p v-if="complete && content.unplacedCount" class="knowledge-answer-content__hint" role="status">部分匹配方案暂无法关联到回答段落，可通过引用来源查看原页。</p>
    <p v-else-if="complete && hasSources && !referencePages.length" class="knowledge-answer-content__hint" role="status">本次引用未提供匹配档位，可通过引用来源查看原页。</p>
  </div>
</template>

<style scoped>
.knowledge-answer-content { min-width: 0; }
.knowledge-answer-content__block + .knowledge-answer-content__block { margin-top: var(--td-size-2); }
.knowledge-answer-content__hint { color: var(--td-text-color-secondary); font-size: var(--td-font-size-body-small); margin-bottom: 0; }
</style>

<script setup lang="ts">
import type { KnowledgeAnswerMatchGroup } from '@/utils/knowledge-answer'
import { computed, ref } from 'vue'
import { useReferenceHighlight } from '@/composables/useReferenceHighlight'
import { hasRenderModel } from '@/utils/knowledge-page-render'
import KnowledgeAnswerMatchSummary from './KnowledgeAnswerMatchSummary.vue'
import KnowledgePageImage from './KnowledgePageImage.vue'
import KnowledgeStructuredContent from './KnowledgeStructuredContent.vue'
import ReferenceHighlightBar from './ReferenceHighlightBar.vue'

const props = defineProps<{ group: KnowledgeAnswerMatchGroup }>()
const model = computed(() => hasRenderModel(props.group.renderModel) ? props.group.renderModel : null)
const mode = ref<'table' | 'image'>('table')
const showTable = computed(() => mode.value === 'table' && !!model.value)
const root = ref<HTMLElement | null>(null)
const highlight = useReferenceHighlight(() => ({ model: model.value, matches: props.group.matches, pageId: props.group.page.pageId }), () => root.value, () => showTable.value, false)
function locate(match: { constructionId?: string | null, optionId?: string | null }): void {
  const target = highlight.matches.value.findIndex(item => item.constructionId === match.constructionId && item.optionId === match.optionId)
  if (target < 0) {
    return
  }
  mode.value = 'table'
  highlight.navigate(target - highlight.index.value)
}
</script>

<template>
  <section ref="root" class="knowledge-answer-reference-page" aria-label="回答引用的完整页面">
    <header>
      <div><strong>{{ model?.pageTitle || group.page.documentTitle }}</strong><span>印刷页码：{{ group.page.pageLabel || model?.pageLabel || '未标注' }}</span></div>
      <t-space size="small">
        <t-button v-if="model" size="small" :variant="showTable ? 'base' : 'outline'" @click="mode = 'table'">完整表格</t-button>
        <t-button v-if="group.page.imageUrl" size="small" :variant="!showTable ? 'base' : 'outline'" @click="mode = 'image'">完整原图</t-button>
      </t-space>
    </header>
    <template v-if="showTable && model">
      <KnowledgeAnswerMatchSummary :model="model" :matches="group.matches" :page-id="group.page.pageId" :page-label="group.page.pageLabel" @locate="locate" />
      <ReferenceHighlightBar :count="highlight.matches.value.length" :index="highlight.index.value" :enabled="highlight.enabled.value" :unresolved="highlight.matches.value.length < group.matches.length" @navigate="highlight.navigate" @toggle="highlight.toggle" />
      <KnowledgeStructuredContent :model="model" :matches="highlight.enabled.value ? highlight.matches.value : []" :active="highlight.active.value" :has-original-image="!!group.page.imageUrl" @view-original="mode = 'image'" />
    </template>
    <template v-else>
      <p class="knowledge-answer-reference-page__hint">完整原页包含构造简图。{{ model ? '切换到完整表格可查看命中行和字段高亮。' : '当前来源未提供表格定位数据，先展示完整原页。' }}</p>
      <KnowledgePageImage :image-url="group.page.imageUrl" :page-id="group.page.pageId" :title="model?.pageTitle || group.page.documentTitle" />
    </template>
  </section>
</template>

<style scoped>
.knowledge-answer-reference-page { margin: var(--td-size-4) 0; padding: var(--td-size-4); border: 1px solid var(--td-component-stroke); border-radius: var(--td-radius-default); min-width: 0; }
.knowledge-answer-reference-page header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--td-size-3); margin-bottom: var(--td-size-3); }
.knowledge-answer-reference-page header span { display: block; margin-top: var(--td-size-1); color: var(--td-text-color-secondary); }
.knowledge-answer-reference-page__hint { color: var(--td-text-color-secondary); font-size: var(--td-font-size-body-small); }
</style>

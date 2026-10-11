<script setup lang="ts">
import type { KnowledgePagePresentation, ReferenceHighlight } from '@/types/knowledge-page-render'
import type { HighlightRangeInput } from '@/utils/highlight'
import { computed, ref, watch } from 'vue'
import KnowledgePageImage from './KnowledgePageImage.vue'
import KnowledgeStructuredContent from './KnowledgeStructuredContent.vue'
import ReferenceHighlightBar from './ReferenceHighlightBar.vue'
import KnowledgeRecognizedContent from './KnowledgeRecognizedContent.vue'
import KnowledgeDocumentContent from './KnowledgeDocumentContent.vue'
import { pageReferenceMatches, useKnowledgePageTab, useKnowledgePageWarnings } from '@/composables/useKnowledgePageViewer'
import { useReferenceHighlight } from '@/composables/useReferenceHighlight'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { hasRenderModel, optionHasWarning } from '@/utils/knowledge-page-render'

const props = withDefaults(defineProps<KnowledgePagePresentation & {
  pageId?: string | null
  pageLabel?: string | null
  pageTitle?: string | null
  parsedText?: string | null
  pageImageUrl?: string | null
  warnings?: string[]
  highlights?: ReferenceHighlight[]
  initialTab?: 'structured' | 'image'
  canReview?: boolean
  textHighlights?: Array<Pick<HighlightRangeInput, 'charStart' | 'charEnd'>>
}>(), { initialTab: 'structured', highlights: () => [], warnings: () => [] })
const emit = defineEmits<{ review: [] }>()
const tab = useKnowledgePageTab(() => ({ pageId: props.pageId, initialTab: props.initialTab }))
const root = ref<HTMLElement | null>(null)
const { canAccess } = usePermissionAccess()
const canInspect = computed(() => canAccess({ permissions: ['system:knowledge:debug', 'system:knowledge:page:review', 'system:knowledge:page:confirm'] }))
const canDebug = computed(() => canAccess({ permissions: ['system:knowledge:debug'] }))
const reviewAllowed = computed(() => props.canReview && canAccess({ permissions: ['system:knowledge:page:review', 'system:knowledge:page:confirm', 'system:knowledge:page:recognize'] }))
watch(canInspect, (allowed) => { if (!allowed && tab.value === 'recognition') tab.value = 'structured' })
const model = computed(() => hasRenderModel(props.renderModel) ? props.renderModel : null)
const incomingMatches = computed(() => [...props.highlights, ...pageReferenceMatches(props)].filter(match => match.optionId || match.constructionId || match.fieldKeys?.length))
const highlight = useReferenceHighlight(() => ({ model: model.value, matches: incomingMatches.value, pageId: props.pageId }), () => root.value, () => tab.value === 'structured')
const warnings = useKnowledgePageWarnings(() => model.value, () => [...props.warnings, ...(props.confirmedStructuredData?.warnings ?? [])])
const hasAnomaly = computed(() => !!warnings.value.length || model.value?.constructions.some(section => section.options.some(optionHasWarning)) || props.confirmedStructuredData?.systems.some(system => system.options?.some(optionHasWarning)))
const displayTitle = computed(() => props.pageTitle || model.value?.pageTitle || '页面内容')
const debugData = computed(() => JSON.stringify(props.confirmedStructuredData ?? model.value, null, 2))
</script>

<template>
  <section ref="root" class="knowledge-page-viewer">
    <header class="knowledge-page-viewer__heading"><h2>页面标题：{{ displayTitle }}</h2><span>印刷页码：{{ pageLabel || model?.pageLabel || '未标注' }}</span></header>
    <t-tabs v-model="tab">
      <t-tab-panel value="image" label="页面原图" :destroy-on-hide="false">
        <KnowledgePageImage :image-url="pageImageUrl" :title="displayTitle" />
      </t-tab-panel>
      <t-tab-panel value="structured" label="页面内容" :destroy-on-hide="false">
        <ReferenceHighlightBar v-if="incomingMatches.length" :count="highlight.matches.value.length" :index="highlight.index.value" :enabled="highlight.enabled.value" :unresolved="highlight.matches.value.length < incomingMatches.length" @navigate="highlight.navigate" @toggle="highlight.toggle" />
        <!-- <div v-if="hasAnomaly" class="knowledge-page-viewer__warning" role="status">
          <span>识别数据可能存在异常</span>
          <t-button v-if="reviewAllowed" size="small" variant="text" @click="emit('review')">进入识别校验</t-button>
          <span v-else>请联系有识别校验权限的管理员核对。</span>
        </div> -->
        <!-- <KnowledgeStructuredContent v-if="model" :model="model" :matches="highlight.enabled.value ? highlight.matches.value : []" :active="highlight.active.value" :has-original-image="!!pageImageUrl" @view-original="tab = 'image'" /> -->
        <template v-else-if="confirmedStructuredData?.systems.length">
          <KnowledgeRecognizedContent :systems="confirmedStructuredData.systems" :notes="confirmedStructuredData.notes" />
          <details v-if="parsedText || confirmedStructuredData.fullText" class="knowledge-page-viewer__original"><summary>查看页面原文</summary><KnowledgeDocumentContent :content="parsedText || confirmedStructuredData.fullText" /></details>
        </template>
        <template v-else>
          <p class="knowledge-page-viewer__unavailable">当前按原文排版展示</p>
          <KnowledgeDocumentContent :content="parsedText || confirmedStructuredData?.fullText" :ranges="textHighlights" />
        </template>
      </t-tab-panel>
      <!-- <t-tab-panel v-if="canInspect" value="recognition" label="识别结果">
        <p class="knowledge-page-viewer__hint">{{ confirmedStructuredData ? '以下为已确认的识别结果，可与页面原图核对。' : '尚未确认识别结果。' }}</p>
        <KnowledgeRecognizedContent v-if="confirmedStructuredData" :systems="confirmedStructuredData.systems" :notes="confirmedStructuredData.notes" />
        <KnowledgeStructuredContent v-else-if="model" :model="model" :matches="[]" />
        <p v-else>暂无识别数据</p>
        <ul v-if="warnings.length"><li v-for="warning in warnings" :key="warning">{{ warning }}</li></ul>
        <details v-if="canDebug"><summary>调试 JSON</summary><pre class="knowledge-page-viewer__json">{{ debugData }}</pre></details>
      </t-tab-panel> -->
    </t-tabs>
  </section>
</template>

<style scoped>
.knowledge-page-viewer { min-width: 0; color: var(--td-text-color-primary); }
.knowledge-page-viewer__heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--td-size-3); margin-bottom: var(--td-size-3); }
h2 { margin: 0; font-size: var(--td-font-size-title-small); overflow-wrap: anywhere; }
.knowledge-page-viewer__heading span, .knowledge-page-viewer__unavailable { color: var(--td-text-color-secondary); }
.knowledge-page-viewer :deep(.t-tabs__content) { padding-top: var(--td-size-3); }
.knowledge-page-viewer__warning { display: flex; flex-wrap: wrap; align-items: center; gap: var(--td-size-3); padding: var(--td-size-3); background: var(--td-warning-color-1); }
.knowledge-page-viewer__json { max-height: 400px; overflow: auto; padding: var(--td-size-3); background: var(--td-bg-color-secondarycontainer); }
.knowledge-page-viewer__hint { color: var(--td-text-color-secondary); }
.knowledge-page-viewer__original { margin-top: var(--td-size-4); border-top: 1px solid var(--td-component-stroke); padding-top: var(--td-size-3); }
.knowledge-page-viewer__original summary { cursor: pointer; color: var(--td-brand-color); margin-bottom: var(--td-size-3); }
</style>

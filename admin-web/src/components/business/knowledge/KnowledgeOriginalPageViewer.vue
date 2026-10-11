<script setup lang="ts">
import type { KnowledgePage, KnowledgePageRecognition } from '@/types/knowledge'
import type { ReferenceHighlight } from '@/types/knowledge-page-render'
import { computed } from 'vue'
import KnowledgePageViewer from './KnowledgePageViewer.vue'
import { useKnowledgePageViewer } from '@/composables/useKnowledgePageViewer'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { businessUserError } from '@/utils/business-error'

const props = withDefaults(defineProps<{
  visible: boolean
  imageUrl?: string | null
  pageId?: string | null
  versionId?: string | null
  physicalPageNumber?: number | null
  pageLabel?: string | null
  title?: string
  page?: KnowledgePage | KnowledgePageRecognition | null
  highlights?: ReferenceHighlight[]
  initialTab?: 'image' | 'structured'
  loadContent?: boolean
  canReview?: boolean
}>(), { title: '页面详情', initialTab: 'structured', loadContent: true, highlights: () => [] })
const emit = defineEmits<{ 'update:visible': [value: boolean], review: [] }>()
const { canAccess } = usePermissionAccess()
const canRead = computed(() => props.loadContent && canAccess({ permissions: ['system:knowledge:doc:list'] }))
const { page, loading, error, load } = useKnowledgePageViewer(() => ({ visible: props.visible, pageId: props.pageId, versionId: props.versionId, physicalPageNumber: props.physicalPageNumber, page: props.page, loadContent: canRead.value }))
const resolvedPageId = computed(() => page.value && 'pageId' in page.value ? page.value.pageId : page.value && 'id' in page.value ? page.value.id : props.pageId)
</script>

<template>
  <t-dialog :visible="visible" :footer="false" :header="title" width="min(1180px, 96vw)" destroy-on-close @update:visible="emit('update:visible', $event)">
    <slot name="navigation" />
    <t-loading v-if="loading" loading text="正在加载页面内容" />
    <template v-else>
      <t-alert v-if="error" theme="warning" :message="businessUserError(error)"><t-button size="small" variant="text" @click="load">重试</t-button></t-alert>
      <KnowledgePageViewer
        v-if="visible"
        :page-id="resolvedPageId"
        :page-label="page?.pageLabel || pageLabel"
        :page-title="page?.pageTitle"
        :page-image-url="imageUrl || page?.pageImageUrl"
        :parsed-text="page?.parsedText"
        :render-model="page?.renderModel"
        :confirmed-structured-data="page?.confirmedStructuredData"
        :reference-highlight="page?.referenceHighlight"
        :matches="page?.matches"
        :warnings="page?.recognitionWarnings"
        :highlights="highlights"
        :initial-tab="canRead || page ? initialTab : 'image'"
        :can-review="canReview"
        @review="emit('review')"
      />
    </template>
  </t-dialog>
</template>

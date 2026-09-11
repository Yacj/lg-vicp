<script setup lang="ts">
import type { PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { computed, reactive, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import {
  deleteKnowledgeTocItem,
  fetchVersionChunks,
  fetchVersionPageMappings,
  fetchVersionPageWindow,
  fetchVersionToc,
  remapVersionToc,
  replaceVersionToc,
  verifyVersionPageMappings,
} from '@/api/modules/knowledge'
import KnowledgePageMappingTable from '@/components/business/KnowledgePageMappingTable.vue'
import KnowledgePageView from '@/components/business/KnowledgePageView.vue'
import KnowledgeTocEditor from '@/components/business/KnowledgeTocEditor.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import type {
  KnowledgeChunk,
  KnowledgePage,
  KnowledgePageMapping,
  KnowledgeTocItem,
} from '@/types/knowledge'
import { knowledgeUserMessage } from '@/utils/knowledge-user'

const props = defineProps<{
  visible: boolean
  versionId: string | null
  editable?: boolean
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
}>()

const tab = ref('toc')
const tocItems = ref<KnowledgeTocItem[]>([])
const tocLoading = ref(false)
const tocSaving = ref(false)
const mappings = ref<KnowledgePageMapping[]>([])
const mappingLoading = ref(false)
const pages = ref<KnowledgePage[]>([])
const pageLoading = ref(false)
const chunks = ref<KnowledgeChunk[]>([])
const chunkTotal = ref(0)
const chunksLoading = ref(false)
const chunkQuery = reactive({ page: 1, pageSize: 20 })

const chunkColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'chunkIndex', minWidth: 70, title: '序号', cell: (_, { row }) => `#${(row as KnowledgeChunk).chunkIndex + 1}` },
  { colKey: 'sourceSection', minWidth: 180, title: '章节', cell: (_, { row }) => (row as KnowledgeChunk).sourceSection || '—' },
  { colKey: 'content', minWidth: 280, title: '内容', cell: (_, { row }) => ((row as KnowledgeChunk).content ?? '').slice(0, 80) },
]

const resolvedMappings = computed(() => mappings.value)

async function loadToc(): Promise<void> {
  if (!props.versionId) return
  tocLoading.value = true
  try { tocItems.value = (await fetchVersionToc(props.versionId)).items }
  catch { tocItems.value = [] }
  finally { tocLoading.value = false }
}

async function loadMappings(): Promise<void> {
  if (!props.versionId) return
  mappingLoading.value = true
  try { mappings.value = (await fetchVersionPageMappings(props.versionId)).items }
  catch { mappings.value = [] }
  finally { mappingLoading.value = false }
}

async function loadPages(): Promise<void> {
  if (!props.versionId) return
  pageLoading.value = true
  try {
    const result = await fetchVersionPageWindow(props.versionId, 1, 0, 8)
    pages.value = [{
      id: result.page.id,
      documentId: '',
      versionId: props.versionId,
      pageNumber: result.page.pageNumber,
      physicalPageNumber: result.page.physicalPageNumber,
      pageLabel: result.page.pageLabel,
      pageTitle: result.page.pageTitle,
      parsedText: result.page.fullText,
      extractedText: result.page.extractedText,
      pageImageObjectKey: null,
      pageImageUrl: result.page.pageImageUrl,
      sectionPath: null,
      blocks: result.page.blocks,
      hasTables: result.page.blocks.some(block => block.contentType === 'TABLE'),
      hasImages: false,
      parseStatus: 'PARSED',
      createdAt: new Date().toISOString(),
    }]
  }
  catch { pages.value = [] }
  finally { pageLoading.value = false }
}

async function loadChunks(): Promise<void> {
  if (!props.versionId) return
  chunksLoading.value = true
  try {
    const result = await fetchVersionChunks(props.versionId, chunkQuery.page, chunkQuery.pageSize)
    chunks.value = result.items
    chunkTotal.value = result.total
  }
  catch { chunks.value = [] }
  finally { chunksLoading.value = false }
}

async function saveToc(items: KnowledgeTocItem[], confirm: boolean): Promise<void> {
  if (!props.versionId) return
  tocSaving.value = true
  try {
    await replaceVersionToc(props.versionId, items.map(({ id: _id, children: _children, status: _status, confidence: _confidence, ...item }) => item), confirm)
    await loadToc()
    MessagePlugin.success(confirm ? '章节已保存并确认' : '章节已保存')
  }
  catch (cause) { MessagePlugin.error(knowledgeUserMessage(normalizeFeedbackError(cause).message)) }
  finally { tocSaving.value = false }
}

async function autoMatch(): Promise<void> {
  if (!props.versionId) return
  try {
    await remapVersionToc(props.versionId)
    await loadToc()
    await loadMappings()
    MessagePlugin.success('已自动对上页码')
  }
  catch (cause) { MessagePlugin.error(knowledgeUserMessage(normalizeFeedbackError(cause).message)) }
}

watch(
  () => [props.visible, props.versionId] as const,
  ([visible, versionId]) => {
    if (!visible || !versionId) return
    void loadToc()
    void loadMappings()
    void loadPages()
    void loadChunks()
  },
)
</script>

<template>
  <t-drawer
    :footer="false"
    header="校正章节和页码"
    :visible="visible"
    size="960px"
    @close="emit('update:visible', false)"
    @update:visible="(value: boolean) => emit('update:visible', value)"
  >
    <t-tabs v-model="tab">
      <t-tab-panel label="校正章节" value="toc">
        <t-loading :loading="tocLoading">
          <KnowledgeTocEditor
            :editable="editable"
            :items="tocItems"
            :saving="tocSaving"
            @add="saveToc([...tocItems, { id: `new-${Date.now()}`, parentId: null, title: '新章节', level: 1, sortOrder: tocItems.length, pageLabel: null, physicalPageNumber: null, source: 'MANUAL', confidence: null, status: 'DRAFT' }], false)"
            @delete="async (item: KnowledgeTocItem) => { await deleteKnowledgeTocItem(item.id); await loadToc() }"
            @save="saveToc"
          />
        </t-loading>
      </t-tab-panel>
      <t-tab-panel label="对应页码" value="mapping">
        <KnowledgePageMappingTable
          :editable="editable"
          :mappings="resolvedMappings"
          :pages="pages.map(page => ({ id: page.id, physicalPageNumber: page.physicalPageNumber, pageLabel: page.pageLabel }))"
          @auto-match="autoMatch"
          @batch-confirm="async () => {
            const valid = mappings.filter(item => item.originalPhysicalPageNumber != null).map(item => ({ searchPhysicalPageNumber: item.searchPhysicalPageNumber, originalPhysicalPageNumber: item.originalPhysicalPageNumber!, pageLabel: item.pageLabel }))
            if (!versionId || valid.length === 0) return
            await verifyVersionPageMappings(versionId, valid)
            await loadMappings()
          }"
          @verify="async (mapping: KnowledgePageMapping) => {
            if (!versionId || mapping.originalPhysicalPageNumber == null) return
            await verifyVersionPageMappings(versionId, [{ searchPhysicalPageNumber: mapping.searchPhysicalPageNumber, originalPhysicalPageNumber: mapping.originalPhysicalPageNumber, pageLabel: mapping.pageLabel }])
            await loadMappings()
          }"
        />
      </t-tab-panel>
      <t-tab-panel label="系统读出的文字" value="machine">
        <t-loading :loading="pageLoading">
          <KnowledgePageView
            v-if="pages[0]"
            :full-text="pages[0].extractedText ?? pages[0].parsedText ?? ''"
            :page-number="pages[0].physicalPageNumber"
          />
        </t-loading>
      </t-tab-panel>
      <t-tab-panel label="内容片段" value="chunks">
        <AppDataTable
          :columns="chunkColumns"
          :data="chunks"
          empty-title="暂无内容"
          :show-column-controller="false"
          :show-fullscreen="false"
          :status="chunksLoading ? 'loading' : 'ready'"
          :total="chunkTotal"
          row-key="id"
          @page-change="(info: PageInfo) => { chunkQuery.page = info.current; void loadChunks() }"
        />
      </t-tab-panel>
    </t-tabs>
  </t-drawer>
</template>

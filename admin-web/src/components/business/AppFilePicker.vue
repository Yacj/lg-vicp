<script setup lang="ts">
import type { PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { computed, reactive, ref, watch } from 'vue'
import { fetchFiles, fetchRecentFiles } from '@/api/modules/files'
import AppFilePreview from '@/components/business/AppFilePreview.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import type { FileCenterItem } from '@/types/file'
import { formatDate } from '@/utils/day'
import { knowledgeFileKind } from '@/utils/knowledge-user'
import { formatFileSize } from '@/utils/report'

const KNOWLEDGE_MIME_FILTERS = [
  { label: 'PDF / Word', value: 'knowledge' },
  { label: 'PDF', value: 'pdf' },
  { label: 'Word', value: 'docx' },
] as const

const props = withDefaults(defineProps<{
  visible: boolean
  title?: string
  confirmText?: string
}>(), {
  title: '从文件中心选择',
  confirmText: '使用此文件',
})

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  'confirm': [file: FileCenterItem]
  'cancel': []
}>()

const tab = ref<'recent' | 'all'>('recent')
const keyword = ref('')
const kindFilter = ref<(typeof KNOWLEDGE_MIME_FILTERS)[number]['value']>('knowledge')
const query = reactive({ page: 1, pageSize: 10 })
const items = ref<FileCenterItem[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref<unknown>(null)
const selectedId = ref<string | null>(null)
const previewVisible = ref(false)
const previewFile = ref<FileCenterItem | null>(null)

const selected = computed(() => items.value.find(item => item.id === selectedId.value) ?? null)
const errorDescription = computed(() => error.value
  ? normalizeFeedbackError(error.value).message
  : '请检查网络连接后重试')

const columns: PrimaryTableCol<TableRowData>[] = [
  {
    colKey: 'originalName',
    minWidth: 260,
    title: '文件',
    cell: (_, { row }) => {
      const file = row as FileCenterItem
      return `${knowledgeFileKind(file.mimeType, file.originalName)}  ${file.originalName}`
    },
  },
  {
    colKey: 'sizeBytes',
    minWidth: 100,
    title: '大小',
    cell: (_, { row }) => formatFileSize((row as FileCenterItem).sizeBytes),
  },
  {
    colKey: 'createdAt',
    minWidth: 160,
    title: '上传时间',
    cell: (_, { row }) => formatDate(new Date((row as FileCenterItem).createdAt), 'YYYY-MM-DD HH:mm'),
  },
]

function mimeQuery(): { mimeType?: string, extension?: string } {
  if (kindFilter.value === 'pdf') {
    return { mimeType: 'application/pdf' }
  }
  if (kindFilter.value === 'docx') {
    return { extension: '.docx' }
  }
  return {}
}

function matchesKnowledgeFile(file: FileCenterItem): boolean {
  const kind = knowledgeFileKind(file.mimeType, file.originalName)
  return kind === 'PDF' || kind === 'Word'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    if (tab.value === 'recent') {
      const result = await fetchRecentFiles(20)
      const filtered = result.items.filter((item) => {
        if (item.status !== 'READY') {
          return false
        }
        if (!matchesKnowledgeFile(item)) {
          return false
        }
        if (kindFilter.value === 'pdf') {
          return knowledgeFileKind(item.mimeType, item.originalName) === 'PDF'
        }
        if (kindFilter.value === 'docx') {
          return knowledgeFileKind(item.mimeType, item.originalName) === 'Word'
        }
        const text = keyword.value.trim().toLowerCase()
        return !text || item.originalName.toLowerCase().includes(text)
      })
      items.value = filtered
      total.value = filtered.length
      query.page = 1
    }
    else {
      const result = await fetchFiles({
        page: query.page,
        pageSize: query.pageSize,
        status: 'READY',
        ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
        ...mimeQuery(),
      })
      items.value = kindFilter.value === 'knowledge'
        ? result.items.filter(matchesKnowledgeFile)
        : result.items
      total.value = result.total
    }
    if (selectedId.value && !items.value.some(item => item.id === selectedId.value)) {
      selectedId.value = null
    }
  }
  catch (cause) {
    error.value = cause
    items.value = []
    total.value = 0
  }
  finally {
    loading.value = false
  }
}

function search(): void {
  query.page = 1
  void load()
}

function onPageChange(pageInfo: PageInfo): void {
  query.page = pageInfo.current
  if (pageInfo.pageSize) {
    query.pageSize = pageInfo.pageSize
  }
  void load()
}

function close(): void {
  emit('update:visible', false)
  emit('cancel')
}

function confirmSelection(): void {
  if (!selected.value) {
    return
  }
  emit('confirm', selected.value)
  emit('update:visible', false)
}

function openPreview(file: FileCenterItem): void {
  previewFile.value = file
  previewVisible.value = true
}

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      return
    }
    selectedId.value = null
    keyword.value = ''
    tab.value = 'recent'
    query.page = 1
    void load()
  },
)
</script>

<template>
  <t-dialog
    :cancel-btn="{ content: '取消' }"
    :confirm-btn="{ content: confirmText, disabled: !selected, theme: 'primary' }"
    :header="title"
    :visible="visible"
    width="840px"
    attach="body"
    @close="close"
    @confirm="confirmSelection"
    @update:visible="(value: boolean) => emit('update:visible', value)"
  >
    <div class="app-file-picker">
      <t-tabs v-model="tab" @change="search">
        <t-tab-panel label="最近文件" value="recent" />
        <t-tab-panel label="全部文件" value="all" />
      </t-tabs>

      <div class="app-file-picker__filters">
        <t-input
          v-model="keyword"
          clearable
          placeholder="搜索文件名"
          @enter="search"
        />
        <t-select
          v-model="kindFilter"
          :options="[...KNOWLEDGE_MIME_FILTERS]"
          style="width: 140px"
          @change="search"
        />
        <t-button theme="primary" variant="outline" @click="search">
          搜索
        </t-button>
      </div>

      <AppDataTable
        :columns="columns"
        :current="query.page"
        :data="items"
        empty-description="可上传新文件，或切换到全部文件再搜索"
        empty-title="没有可选择的知识文件"
        :error-description="errorDescription"
        :operations-width="88"
        :page-size="query.pageSize"
        row-key="id"
        row-selection-type="single"
        :selected-row-keys="selectedId ? [selectedId] : []"
        select-on-row-click
        :show-column-controller="false"
        :show-fullscreen="false"
        :show-pagination="tab === 'all'"
        :show-refresh="false"
        :status="loading ? 'loading' : error ? 'error' : 'ready'"
        :total="total"
        @page-change="onPageChange"
        @retry="load"
        @selection-change="(keys) => { selectedId = typeof keys[0] === 'string' ? keys[0] : null }"
      >
        <template #operations="{ row }">
          <t-button size="small" theme="primary" variant="text" @click.stop="openPreview(row as FileCenterItem)">
            预览
          </t-button>
        </template>
      </AppDataTable>
    </div>
  </t-dialog>

  <AppFilePreview
    :file="previewFile ? { id: previewFile.id, originalName: previewFile.originalName, mimeType: previewFile.mimeType } : null"
    :visible="previewVisible"
    @close="previewVisible = false"
  />
</template>

<style scoped>
.app-file-picker {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-4);
}

.app-file-picker__filters {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-3);
}
</style>

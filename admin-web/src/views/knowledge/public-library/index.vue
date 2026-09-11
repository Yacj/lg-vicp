<script setup lang="ts">
import type { PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AiSourceLocatorQuery } from '@/types/ai-source'
import type { PublicLibraryDocumentItem } from '@/types/knowledge'
import { SearchIcon } from 'tdesign-icons-vue-next'
import { h, onMounted, reactive, ref } from 'vue'
import { fetchPublicLibraryDocuments } from '@/api/modules/knowledge'
import KnowledgePublicOriginalReader from '@/components/business/KnowledgePublicOriginalReader.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { formatDate } from '@/utils/day'
import { knowledgeDocTypeLabel } from '@/utils/knowledge-user'

/**
 * 公开文库：面向运营/技术人员的已公开资料浏览（不是另一个知识库）。
 * 数据复用 knowledge_documents 的公开只读口径（visibility=PUBLIC + 版本 PUBLISHED + 生效中，
 * 由服务端强制过滤）；查看原文复用统一 Wiki 阅读器，回到完整页面。
 */

defineOptions({ name: 'KnowledgePublicLibrary' })

const docTypeTabs: Array<{ label: string, value: string }> = [
  { label: '全部', value: 'all' },
  { label: knowledgeDocTypeLabel('SPECIFICATION'), value: 'SPECIFICATION' },
  { label: knowledgeDocTypeLabel('DETAIL_ATLAS'), value: 'DETAIL_ATLAS' },
  { label: knowledgeDocTypeLabel('APPLICATION_GUIDE'), value: 'APPLICATION_GUIDE' },
  { label: knowledgeDocTypeLabel('STANDARD'), value: 'STANDARD' },
  { label: knowledgeDocTypeLabel('COMPANY_PROFILE'), value: 'COMPANY_PROFILE' },
]

const query = reactive({ page: 1, pageSize: 10, docType: 'all', keyword: '' })
const keywordInput = ref('')
const items = ref<PublicLibraryDocumentItem[]>([])
const total = ref(0)
const isLoading = ref(false)
const error = ref<unknown>(null)
let requestSequence = 0

async function load(): Promise<void> {
  const sequence = ++requestSequence
  isLoading.value = true
  error.value = null
  try {
    const result = await fetchPublicLibraryDocuments({
      page: query.page,
      pageSize: query.pageSize,
      ...(query.docType !== 'all' ? { docType: query.docType as PublicLibraryDocumentItem['docType'] } : {}),
      ...(query.keyword.trim() ? { keyword: query.keyword.trim() } : {}),
    })
    if (sequence !== requestSequence) {
      return
    }
    items.value = result.items
    total.value = result.total
  }
  catch (cause) {
    if (sequence !== requestSequence) {
      return
    }
    error.value = cause
  }
  finally {
    if (sequence === requestSequence) {
      isLoading.value = false
    }
  }
}

function switchTab(value: unknown): void {
  query.docType = String(value)
  query.page = 1
  void load()
}

function search(): void {
  query.keyword = keywordInput.value
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

// ===== 原文阅读（同一 Wiki 阅读器） =====

const readerVisible = ref(false)
const readerLocator = ref<AiSourceLocatorQuery | null>(null)
const readerTitle = ref('')

function openReader(row: PublicLibraryDocumentItem): void {
  readerTitle.value = row.title
  readerLocator.value = { documentId: row.id }
  readerVisible.value = true
}

const columns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_, { row }) => h('span', { class: 'vicp-library__title' }, (row as PublicLibraryDocumentItem).title),
    colKey: 'title',
    minWidth: 260,
    title: '资料名称',
  },
  { cell: (_, { row }) => (row as PublicLibraryDocumentItem).docNumber || '—', colKey: 'docNumber', minWidth: 140, title: '编号' },
  {
    cell: (_, { row }) => knowledgeDocTypeLabel((row as PublicLibraryDocumentItem).docType),
    colKey: 'docType',
    minWidth: 110,
    title: '分类',
  },
  {
    cell: (_, { row }) => {
      const pageCount = (row as PublicLibraryDocumentItem).pageCount
      return pageCount != null ? `${pageCount} 页` : '—'
    },
    colKey: 'pageCount',
    minWidth: 90,
    title: '页数',
  },
  {
    cell: (_, { row }) => (row as PublicLibraryDocumentItem).region || '—',
    colKey: 'region',
    minWidth: 110,
    title: '地区',
  },
  {
    cell: (_, { row }) => {
      const publishedAt = (row as PublicLibraryDocumentItem).publishedAt
      return publishedAt ? formatDate(new Date(publishedAt), 'YYYY-MM-DD') : '—'
    },
    colKey: 'publishedAt',
    minWidth: 130,
    title: '发布时间',
  },
]

onMounted(() => {
  void load()
})
</script>

<template>
  <AppPage
    title="公开文库"
    description="已经公开的图集、标准、产品资料和企业资料。点击「查看原文」可按章节阅读。"
  >
    <div class="vicp-library">
      <div class="vicp-library__toolbar">
        <t-space size="small" break-line>
          <t-button
            v-for="tab in docTypeTabs"
            :key="tab.value"
            :theme="query.docType === tab.value ? 'primary' : 'default'"
            :variant="query.docType === tab.value ? 'base' : 'outline'"
            size="medium"
            @click="switchTab(tab.value)"
          >
            {{ tab.label }}
          </t-button>
        </t-space>
        <div class="vicp-library__search">
          <t-input
            v-model="keywordInput"
            clearable
            maxlength="120"
            placeholder="按资料名称或编号搜索"
            @enter="search"
          >
            <template #prefixIcon>
              <SearchIcon />
            </template>
          </t-input>
          <t-button theme="default" variant="outline" @click="search">
            搜索
          </t-button>
        </div>
      </div>

      <AppDataTable
        :columns="columns"
        :current="query.page"
        :data="items"
        empty-description="还没有已公开的资料；发布资料后这里会自动展示"
        empty-title="暂无公开资料"
        :error-description="error ? normalizeFeedbackError(error).message : '请检查网络连接后重试'"
        :operations-width="110"
        :page-size="query.pageSize"
        row-key="id"
        :status="isLoading ? 'loading' : error ? 'error' : 'ready'"
        :total="total"
        @page-change="onPageChange"
        @refresh="load"
        @retry="load"
      >
        <template #operations="{ row }">
          <t-button size="small" theme="primary" variant="text" @click="openReader(row as PublicLibraryDocumentItem)">
            查看原文
          </t-button>
        </template>
      </AppDataTable>
    </div>

    <t-drawer
      v-model:visible="readerVisible"
      attach="body"
      :header="readerTitle ? `原文阅读 · ${readerTitle}` : '原文阅读'"
      placement="right"
      :prevent-scroll-through="true"
      size="min(860px, 96vw)"
      :footer="false"
    >
      <KnowledgePublicOriginalReader v-if="readerLocator && readerVisible" :document-id="readerLocator.documentId ?? ''" />
    </t-drawer>
  </AppPage>
</template>

<style scoped>
.vicp-library {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.vicp-library__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.vicp-library__search {
  display: flex;
  gap: 8px;
  min-width: 280px;
}

.vicp-library__search :deep(.t-input) {
  width: 260px;
}

.vicp-library__title {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
</style>

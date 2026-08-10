<script setup lang="ts">
import type { PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { computed, h, onMounted, reactive, ref } from 'vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { fetchKnowledgeSearchLogs } from '@/api/modules/knowledge'
import type { KnowledgeSearchLog } from '@/types/knowledge'
import { formatDate } from '@/utils/day'

const { canAccess } = usePermissionAccess()
const canView = computed(() => canAccess({ permissions: ['system:knowledge:search-log:list'] }))

const keyword = ref('')
const query = reactive({ page: 1, pageSize: 20 })
const logs = ref<KnowledgeSearchLog[]>([])
const total = ref(0)
const isLoading = ref(false)
const error = ref<unknown>(null)

async function load(): Promise<void> {
  if (!canView.value) {
    return
  }
  isLoading.value = true
  error.value = null
  try {
    const result = await fetchKnowledgeSearchLogs({
      page: query.page,
      pageSize: query.pageSize,
      ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
    })
    logs.value = result.items
    total.value = result.total
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    isLoading.value = false
  }
}

function search(): void {
  query.page = 1
  void load()
}

function reset(): void {
  keyword.value = ''
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

function onPageSizeChange(pageSize: number): void {
  query.pageSize = pageSize
  query.page = 1
  void load()
}

const errorDescription = computed(() => error.value
  ? normalizeFeedbackError(error.value).message
  : '请检查网络连接后重试')

function matchModesText(row: KnowledgeSearchLog): string {
  return row.matchModes.length > 0 ? row.matchModes.join(' / ') : '—'
}

function topHit(row: KnowledgeSearchLog): string {
  if (row.topResults.length === 0) {
    return '—'
  }
  const first = row.topResults[0]
  const title = (first as Record<string, unknown>).title ?? (first as Record<string, unknown>).documentTitle ?? ''
  return `#1 ${String(title)}`
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => h('div', [
    h('div', { class: 'vicp-log-query' }, row.query),
    h('div', { class: 'vicp-log-normalized' }, `归一化：${row.normalizedQuery}`),
  ]), colKey: 'query', minWidth: 260, title: '检索词' },
  { cell: (_, { row }) => matchModesText(row as KnowledgeSearchLog), colKey: 'matchModes', minWidth: 120, title: '匹配模式' },
  { cell: (_, { row }) => row.resultCount, colKey: 'resultCount', minWidth: 80, title: '命中数' },
  { cell: (_, { row }) => topHit(row as KnowledgeSearchLog), colKey: 'topResults', minWidth: 220, title: '最高命中' },
  { cell: (_, { row }) => (row.durationMs != null ? `${row.durationMs} ms` : '—'), colKey: 'durationMs', minWidth: 90, title: '耗时' },
  { cell: (_, { row }) => row.user?.displayName ?? '匿名', colKey: 'user', minWidth: 110, title: '检索人' },
  { cell: (_, { row }) => formatDate(new Date(row.searchedAt), 'YYYY-MM-DD HH:mm'), colKey: 'searchedAt', minWidth: 140, title: '检索时间' },
]

onMounted(load)
</script>

<template>
  <AppPage title="检索日志" description="知识检索的可解释日志：记录归一化词、匹配模式与最高命中结果，用于排查召回质量。">
    <template #search>
      <AppSearchPanel :loading="isLoading" @reset="reset" @search="search">
        <t-form-item label="关键词">
          <t-input v-model="keyword" clearable placeholder="原始检索词 / 归一化词" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :data="logs"
      empty-description="暂无检索记录"
      empty-title="暂无日志"
      :error-description="errorDescription"
      :show-operations="false"
      row-key="id"
      :status="isLoading ? 'loading' : error ? 'error' : 'ready'"
      :total="total"
      @page-change="onPageChange"
      @page-size-change="onPageSizeChange"
      @refresh="load"
      @retry="load"
    />
  </AppPage>
</template>

<style scoped>
.vicp-log-query {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-log-normalized {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
</style>
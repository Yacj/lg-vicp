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
  const labels: Record<string, string> = {
    PHRASE: '整句',
    KEYWORD: '关键词',
    ALIAS: '同义词',
    FULLTEXT: '全文',
    FUZZY: '相近词',
    TITLE: '标题',
    CLAUSE: '条款号',
  }
  if (row.matchModes.length === 0) {
    return '—'
  }
  return row.matchModes.map(mode => labels[mode] ?? '其他').join('、')
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
    h('div', { class: 'vicp-log-normalized' }, `处理后：${row.normalizedQuery}`),
  ]), colKey: 'query', minWidth: 260, title: '查找内容' },
  { cell: (_, { row }) => matchModesText(row as KnowledgeSearchLog), colKey: 'matchModes', minWidth: 120, title: '怎么找到的' },
  { cell: (_, { row }) => row.resultCount, colKey: 'resultCount', minWidth: 80, title: '找到几条' },
  { cell: (_, { row }) => topHit(row as KnowledgeSearchLog), colKey: 'topResults', minWidth: 220, title: '最相关资料' },
  { cell: (_, { row }) => (row.durationMs != null ? `${row.durationMs} 毫秒` : '—'), colKey: 'durationMs', minWidth: 90, title: '用时' },
  { cell: (_, { row }) => row.user?.displayName ?? '未登录', colKey: 'user', minWidth: 110, title: '查找人' },
  { cell: (_, { row }) => formatDate(new Date(row.searchedAt), 'YYYY-MM-DD HH:mm'), colKey: 'searchedAt', minWidth: 140, title: '查找时间' },
]

onMounted(load)
</script>

<template>
  <AppPage title="查找记录" description="查看找过哪些资料，方便检查有没有找对。">
    <template #search>
      <AppSearchPanel :loading="isLoading" @reset="reset" @search="search">
        <t-form-item label="关键词">
          <t-input v-model="keyword" clearable placeholder="查找内容" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :data="logs"
      empty-description="还没有查找记录"
      empty-title="暂无记录"
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
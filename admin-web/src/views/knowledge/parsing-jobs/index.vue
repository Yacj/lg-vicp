<script setup lang="ts">
import type { PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { KnowledgeParsingJob, KnowledgeParsingJobStatus } from '@/types/knowledge'
import type { AppStatus } from '@/components/ui/AppStatusTag.vue'
import { computed, h, onMounted, reactive, ref } from 'vue'
import { fetchKnowledgeParsingJobs } from '@/api/modules/knowledge'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { formatDate } from '@/utils/day'
import { knowledgeUserMessage } from '@/utils/knowledge-user'

const query = reactive<{ page: number, pageSize: number, status?: KnowledgeParsingJobStatus }>({ page: 1, pageSize: 20 })
const jobs = ref<KnowledgeParsingJob[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref<unknown>(null)

const statusOptions: Array<{ label: string, value: KnowledgeParsingJobStatus }> = [
  { label: '排队中', value: 'QUEUED' },
  { label: '处理中', value: 'ACTIVE' },
  { label: '已完成', value: 'COMPLETED' },
  { label: '失败', value: 'FAILED' },
  { label: '需要补充文字', value: 'OCR_REQUIRED' },
]

const statusMeta: Record<KnowledgeParsingJobStatus, { label: string, status: AppStatus }> = {
  QUEUED: { label: '排队中', status: 'default' },
  ACTIVE: { label: '处理中', status: 'processing' },
  COMPLETED: { label: '已完成', status: 'success' },
  FAILED: { label: '失败', status: 'error' },
  OCR_REQUIRED: { label: '需要补充文字', status: 'warning' },
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'document', title: '资料名称', minWidth: 220, cell: (_, { row }) => (row as KnowledgeParsingJob).document?.title ?? '—' },
  { colKey: 'jobType', title: '任务类型', minWidth: 110, cell: (_, { row }) => ({ PARSE: '首次解析', REPARSE: '重新解析', CHUNK_REBUILD: '重新整理内容', OCR: '补充文字' }[(row as KnowledgeParsingJob).jobType] ?? '处理任务') },
  { colKey: 'status', title: '状态', minWidth: 130, cell: (_, { row }) => { const meta = statusMeta[(row as KnowledgeParsingJob).status]; return h(AppStatusTag, { label: meta.label, status: meta.status }) } },
  { colKey: 'progress', title: '进度', minWidth: 130, cell: (_, { row }) => `${(row as KnowledgeParsingJob).progress}%` },
  { colKey: 'errorMessage', title: '处理说明', minWidth: 280, cell: (_, { row }) => { const message = (row as KnowledgeParsingJob).errorMessage; return message ? knowledgeUserMessage(message) : '—' } },
  { colKey: 'createdAt', title: '提交时间', minWidth: 170, cell: (_, { row }) => formatDate(new Date((row as KnowledgeParsingJob).createdAt), 'YYYY-MM-DD HH:mm') },
]

const errorDescription = computed(() => error.value ? normalizeFeedbackError(error.value).message : '请检查网络连接后重试')

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const result = await fetchKnowledgeParsingJobs(query)
    jobs.value = result.items
    total.value = result.total
  }
  catch (cause) { error.value = cause }
  finally { loading.value = false }
}

function onPageChange(pageInfo: PageInfo): void {
  query.page = pageInfo.current
  if (pageInfo.pageSize) query.pageSize = pageInfo.pageSize
  void load()
}

function filter(): void {
  query.page = 1
  void load()
}

onMounted(() => { void load() })
</script>

<template>
  <AppPage title="解析异常" description="查看解析失败、需要处理的知识库。某个知识库失败时，也可以直接打开它的详情处理。">
    <AppDataTable
      :columns="columns"
      :data="jobs"
      :error-description="errorDescription"
      empty-description="当前没有解析任务"
      empty-title="暂无任务"
      :status="loading ? 'loading' : error ? 'error' : 'ready'"
      :total="total"
      row-key="id"
      @page-change="onPageChange"
      @refresh="load"
      @retry="load"
    >
      <template #toolbar>
        <t-select v-model="query.status" clearable :options="statusOptions" placeholder="全部状态" style="width: 180px" @change="filter" />
      </template>
    </AppDataTable>
  </AppPage>
</template>

<script setup lang="ts">
import type { PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { computed, h, onMounted, reactive, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import type { AppStatus } from '@/components/ui/AppStatusTag.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import type { AppTableAction } from '@/types/crud'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {
  createKnowledgeEvaluation,
  fetchKnowledgeEvaluations,
  judgeKnowledgeEvaluation,
} from '@/api/modules/knowledge'
import {
  knowledgeEvaluationJudgements,
  type KnowledgeEvaluation,
  type KnowledgeEvaluationJudgement,
} from '@/types/knowledge'
import { formatDate } from '@/utils/day'

const { canAccess } = usePermissionAccess()
const canCreate = computed(() => canAccess({ permissions: ['system:knowledge:eval:add'] }))
const canJudge = computed(() => canAccess({ permissions: ['system:knowledge:eval:judge'] }))

const query = reactive({ page: 1, pageSize: 10 })
const judgement = ref<KnowledgeEvaluationJudgement | 'ALL'>('ALL')
const evaluations = ref<KnowledgeEvaluation[]>([])
const total = ref(0)
const isLoading = ref(false)
const error = ref<unknown>(null)

// 提交评测
const formVisible = ref(false)
const form = reactive({ query: '', expectedDocumentId: '', expectedPage: '' as string | number })
const submitting = ref(false)

const judgementMeta: Record<KnowledgeEvaluationJudgement, { label: string; status: AppStatus }> = {
  PENDING: { label: '待判定', status: 'default' },
  APPROVED: { label: '通过', status: 'success' },
  PARTIAL: { label: '部分通过', status: 'warning' },
  REJECTED: { label: '不通过', status: 'error' },
}

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const result = await fetchKnowledgeEvaluations({
      page: query.page,
      pageSize: query.pageSize,
      judgement: judgement.value,
    })
    evaluations.value = result.items
    total.value = result.total
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    isLoading.value = false
  }
}

function filter(): void {
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

function openForm(): void {
  form.query = ''
  form.expectedDocumentId = ''
  form.expectedPage = ''
  formVisible.value = true
}

async function submitForm(): Promise<void> {
  if (!form.query.trim()) {
    MessagePlugin.warning('请输入要检查的问题')
    return
  }
  if (submitting.value) {
    return
  }
  submitting.value = true
  try {
    await createKnowledgeEvaluation({
      query: form.query.trim(),
      ...(form.expectedDocumentId ? { expectedDocumentId: form.expectedDocumentId } : {}),
      ...(form.expectedPage ? { expectedPage: Number(form.expectedPage) } : {}),
    })
    MessagePlugin.success('已提交，查找结果已保存')
    formVisible.value = false
    query.page = 1
    await load()
  }
  catch (cause) {
    MessagePlugin.error(normalizeFeedbackError(cause).message)
  }
  finally {
    submitting.value = false
  }
}

const judgeActions: Record<Exclude<KnowledgeEvaluationJudgement, 'PENDING'>, ReturnType<typeof useConfirmedCrudAction<KnowledgeEvaluation, unknown>>> = {
  APPROVED: useConfirmedCrudAction<KnowledgeEvaluation, unknown>({
    action: async (row) => {
      await judgeKnowledgeEvaluation(row.id, { judgement: 'APPROVED' })
    },
    confirm: () => ({ title: '判定通过', content: '这次查找结果符合预期，判定为通过。' }),
    successMessage: '已判定通过',
    onSuccess: () => load(),
  }),
  PARTIAL: useConfirmedCrudAction<KnowledgeEvaluation, unknown>({
    action: async (row) => {
      await judgeKnowledgeEvaluation(row.id, { judgement: 'PARTIAL' })
    },
    confirm: () => ({ title: '判定部分通过', content: '只找到一部分预期内容，判定为部分通过。' }),
    successMessage: '已判定部分通过',
    onSuccess: () => load(),
  }),
  REJECTED: useConfirmedCrudAction<KnowledgeEvaluation, unknown>({
    action: async (row) => {
      await judgeKnowledgeEvaluation(row.id, { judgement: 'REJECTED' })
    },
    confirm: () => ({ title: '判定不通过', content: '没有找到预期内容，判定为不通过。', danger: true }),
    successMessage: '已判定不通过',
    onSuccess: () => load(),
  }),
}

function resultSummary(row: KnowledgeEvaluation): string {
  const results = row.actualTopResults ?? []
  if (results.length === 0) {
    return '无检索结果'
  }
  return results
    .slice(0, 3)
    .map((item) => {
      const pageLabel = typeof item.pageLabel === 'string' ? item.pageLabel : null
      const physicalPage = typeof item.physicalPageNumber === 'number' ? item.physicalPageNumber : typeof item.sourcePage === 'number' ? item.sourcePage : null
      const page = pageLabel ? ` 页码 ${pageLabel}` : physicalPage != null ? ` 第 ${physicalPage} 页` : ''
      return `${String(item.sourceTitle ?? '未知')}${page}（${String(item.hitReason ?? '-')}）`
    })
    .join('；')
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => h('div', { class: 'vicp-query' }, row.query), colKey: 'query', minWidth: 220, title: '检查问题' },
  { cell: (_, { row }) => h('div', { class: 'vicp-keywords' }, (row.parsedKeywords ?? []).join('、') || '—'), colKey: 'parsedKeywords', minWidth: 160, title: '解析关键词' },
  { cell: (_, { row }) => resultSummary(row as KnowledgeEvaluation), colKey: 'actualTopResults', minWidth: 300, title: '实际检索结果（Top3）' },
  {
    cell: (_, { row }) => {
      const meta = judgementMeta[row.judgement as KnowledgeEvaluationJudgement]
      return h(AppStatusTag, { label: meta.label, status: meta.status })
    },
    colKey: 'judgement',
    minWidth: 90,
    title: '判定',
  },
  { cell: (_, { row }) => row.note || '—', colKey: 'note', minWidth: 160, title: '判定说明' },
  { cell: (_, { row }) => formatDate(new Date(row.createdAt), 'YYYY-MM-DD HH:mm'), colKey: 'createdAt', minWidth: 150, title: '提交时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const evaluation = row as KnowledgeEvaluation
  if (evaluation.judgement !== 'PENDING' || !canJudge.value) {
    return []
  }
  return [
    { key: 'approve', label: '通过', loading: judgeActions.APPROVED.running.value, handler: () => judgeActions.APPROVED.run(evaluation) },
    { key: 'partial', label: '部分通过', loading: judgeActions.PARTIAL.running.value, handler: () => judgeActions.PARTIAL.run(evaluation) },
    { key: 'reject', label: '不通过', theme: 'danger', loading: judgeActions.REJECTED.running.value, handler: () => judgeActions.REJECTED.run(evaluation) },
  ]
}

onMounted(() => {
  void load()
})
</script>

<template>
  <t-space direction="vertical" size="16" style="width: 100%">
    <t-alert theme="info" message="用来检查提问能不能找到正确的章节和页码。提交问题后会立刻查找并保存结果，再由人判断找得对不对。" />

    <t-space>
      <t-select
        v-model="judgement"
        :options="[
          { label: '全部状态', value: 'ALL' },
          ...knowledgeEvaluationJudgements.map((value) => ({ label: judgementMeta[value].label, value })),
        ]"
        style="width: 160px"
        @change="filter"
      />
      <t-button v-if="canCreate" theme="primary" @click="openForm">提交检查</t-button>
    </t-space>

    <AppDataTable
      :columns="columns"
      :data="evaluations"
      empty-description="还没有检查记录，可以提交问题开始检查"
      empty-title="暂无检查"
      :error-description="error ? normalizeFeedbackError(error).message : '请检查网络连接后重试'"
      :operations-width="240"
      row-key="id"
      :status="isLoading ? 'loading' : error ? 'error' : 'ready'"
      :total="total"
      @page-change="onPageChange"
      @refresh="load"
      @retry="load"
    >
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <t-dialog v-model:visible="formVisible" header="提交检查问题" :confirm-btn="{ content: '提交', theme: 'primary', loading: submitting }" :on-confirm="submitForm" :on-cancel="() => (formVisible = false)" width="min(520px, 92vw)">
      <t-form label-align="top">
        <t-form-item label="要检查的问题" required-mark>
          <t-input v-model="form.query" maxlength="500" placeholder="如：岩棉板外墙外保温系统传热系数限值" />
        </t-form-item>
        <t-form-item label="期望找到的知识库编号（可不填）">
          <t-input v-model="form.expectedDocumentId" placeholder="从知识库列表复制编号" />
        </t-form-item>
        <t-form-item label="期望页码（可不填）">
          <t-input-number v-model="form.expectedPage" :min="1" placeholder="页码" />
        </t-form-item>
      </t-form>
    </t-dialog>
  </t-space>
</template>

<style scoped>
.vicp-query {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-keywords {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
</style>
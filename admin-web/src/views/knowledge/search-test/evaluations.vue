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
    MessagePlugin.warning('请输入评测问题')
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
    MessagePlugin.success('评测已提交（检索结果即时保存）')
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
    confirm: () => ({ title: '判定通过', content: '该评测检索结果符合预期，判定为通过。' }),
    successMessage: '已判定通过',
    onSuccess: () => load(),
  }),
  PARTIAL: useConfirmedCrudAction<KnowledgeEvaluation, unknown>({
    action: async (row) => {
      await judgeKnowledgeEvaluation(row.id, { judgement: 'PARTIAL' })
    },
    confirm: () => ({ title: '判定部分通过', content: '检索结果部分命中，判定为部分通过。' }),
    successMessage: '已判定部分通过',
    onSuccess: () => load(),
  }),
  REJECTED: useConfirmedCrudAction<KnowledgeEvaluation, unknown>({
    action: async (row) => {
      await judgeKnowledgeEvaluation(row.id, { judgement: 'REJECTED' })
    },
    confirm: () => ({ title: '判定不通过', content: '检索结果未命中预期，判定为不通过。', danger: true }),
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
      const page = pageLabel ? ` 图集页码 ${pageLabel}` : physicalPage != null ? ` PDF 物理页 ${physicalPage}` : ''
      return `${String(item.sourceTitle ?? '未知')}${page}（${String(item.hitReason ?? '-')}）`
    })
    .join('；')
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => h('div', { class: 'vicp-query' }, row.query), colKey: 'query', minWidth: 220, title: '评测问题' },
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
    <t-alert theme="info" message="评测用于验证检索质量：提交测试问题后立即执行真实检索并保存结果，人工判定是否命中预期文档/页码。评测不写入检索日志。" />

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
      <t-button v-if="canCreate" theme="primary" @click="openForm">提交评测</t-button>
    </t-space>

    <AppDataTable
      :columns="columns"
      :data="evaluations"
      empty-description="暂无评测记录，可提交测试问题开始评测"
      empty-title="暂无评测"
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

    <t-dialog v-model:visible="formVisible" header="提交检索评测" :confirm-btn="{ content: '提交', theme: 'primary', loading: submitting }" :on-confirm="submitForm" :on-cancel="() => (formVisible = false)" width="min(520px, 92vw)">
      <t-form label-align="top">
        <t-form-item label="评测问题" required-mark>
          <t-input v-model="form.query" maxlength="500" placeholder="如：岩棉板外墙外保温系统传热系数限值" />
        </t-form-item>
        <t-form-item label="期望命中的文档 ID（可选）">
          <t-input v-model="form.expectedDocumentId" placeholder="从文档列表复制文档 ID" />
        </t-form-item>
        <t-form-item label="期望命中页码（可选）">
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
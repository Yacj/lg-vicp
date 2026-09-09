<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AppTableAction } from '@/types/crud'
import type { StandardIndicator } from '@/types/standard'
import { computed, h, reactive } from 'vue'
import { fetchStandardIndicators, runStandardIndicatorWorkflow } from '@/api/modules/standard'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { useWorkflowActions, workflowActionsForStatus } from '@/composables/useWorkflowActions'
import { formatDate } from '@/utils/day'
import { mdReviewStatusMetaFor } from '@/utils/professional-status'
import { standardVisibilityMeta } from '@/utils/standard-visibility'

const { canAccess } = usePermissionAccess()
const canApprove = computed(() => canAccess({ permissions: ['system:standard:approve'] }))
const canPublish = computed(() => canAccess({ permissions: ['system:standard:publish'] }))

const list = reactive({
  data: [] as StandardIndicator[],
  isLoading: false,
  error: null as unknown,
  query: reactive({ documentId: '', reviewStatus: '', indicatorType: '' }),
  async load(): Promise<void> {
    list.isLoading = true
    list.error = null
    try {
      list.data = await fetchStandardIndicators({
        documentId: list.query.documentId || undefined,
        reviewStatus: list.query.reviewStatus || undefined,
        indicatorType: list.query.indicatorType || undefined,
      })
    }
    catch (cause) {
      list.error = cause
    }
    finally {
      list.isLoading = false
    }
  },
  async search(): Promise<void> {
    await list.load()
  },
  async reset(): Promise<void> {
    Object.keys(list.query).forEach((key) => {
      list.query[key as keyof typeof list.query] = ''
    })
    await list.load()
  },
  retry: () => list.load(),
  refresh: () => list.load(),
})

const ALLOWED = ['approve', 'reject', 'publish']

const workflow = useWorkflowActions<StandardIndicator>({
  entityName: '标准指标',
  run: (id, action) => {
    if (action.type === 'approve') {
      return runStandardIndicatorWorkflow(id, 'approve', { approvalNote: action.approvalNote })
    }
    if (action.type === 'reject') {
      return runStandardIndicatorWorkflow(id, 'reject', { rejectReason: action.rejectReason })
    }
    return runStandardIndicatorWorkflow(id, 'publish')
  },
  onSuccess: () => list.refresh(),
})

const errorDescription = computed(() => list.error
  ? normalizeFeedbackError(list.error).message
  : '请检查网络连接后重试')

const reviewStatusOptions = [
  { label: '全部审核状态', value: 'all' },
  { label: '草稿', value: 'DRAFT' },
  { label: '待审核', value: 'PENDING_REVIEW' },
  { label: '已通过', value: 'APPROVED' },
  { label: '已发布', value: 'PUBLISHED' },
  { label: '已停用', value: 'DISABLED' },
  { label: '已驳回', value: 'REJECTED' },
]

const indicatorTypeOptions = [
  { label: '全部类型', value: 'all' },
  { label: 'K 值', value: 'K_VALUE' },
  { label: '热阻', value: 'HEAT_RESISTANCE' },
  { label: '其他', value: 'OTHER' },
]

const indicatorTypeLabels: Record<string, string> = { K_VALUE: 'K 值', HEAT_RESISTANCE: '热阻', OTHER: '其他' }

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => h('div', [
    h('div', { class: 'vicp-ind-name' }, row.indicatorName),
    h('div', { class: 'vicp-ind-meta' }, row.documentId),
  ]), colKey: 'indicatorName', minWidth: 240, title: '指标名称' },
  { cell: (_, { row }) => indicatorTypeLabels[row.indicatorType] ?? row.indicatorType, colKey: 'indicatorType', minWidth: 90, title: '类型' },
  { cell: (_, { row }) => `${row.value}${row.unit ? ` ${row.unit}` : ''}`, colKey: 'value', minWidth: 140, title: '数值' },
  { cell: (_, { row }) => row.evidenceRef ?? '—', colKey: 'evidenceRef', minWidth: 140, title: '条款引用' },
  { cell: (_, { row }) => h(AppStatusTag, mdReviewStatusMetaFor(row.status)), colKey: 'status', minWidth: 100, title: '审核状态' },
  {
    cell: (_, { row }) => {
      const meta = standardVisibilityMeta(row.status as string)
      return h('div', { class: 'vicp-ind-visibility' }, [
        h(AppStatusTag, { label: meta.visibility, status: meta.status }),
        h('div', { class: 'vicp-ind-visibility__usage' }, meta.aiUsage),
      ])
    },
    colKey: 'visibility',
    minWidth: 170,
    title: '用户可见性',
  },
  { cell: (_, { row }) => row.reviewedAt ? formatDate(new Date(row.reviewedAt), 'YYYY-MM-DD') : '—', colKey: 'reviewedAt', minWidth: 110, title: '审核时间' },
  { cell: (_, { row }) => formatDate(new Date(row.createdAt), 'YYYY-MM-DD'), colKey: 'createdAt', minWidth: 110, title: '创建日期' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as StandardIndicator
  const actions: AppTableAction[] = []
  const available = workflowActionsForStatus(entity.status).filter(action => ALLOWED.includes(action))
  const label = `${entity.indicatorName}（${entity.documentId.slice(0, 8)}）`

  if (canApprove.value && available.includes('approve')) {
    actions.push({
      key: 'approve',
      label: '通过',
      loading: workflow.approveRunning.value,
      handler: () => workflow.openApprove({ id: entity.id, label }),
    })
    actions.push({
      key: 'reject',
      label: '驳回',
      loading: workflow.rejectRunning.value,
      theme: 'danger',
      handler: () => workflow.openReject({ id: entity.id, label }),
    })
  }
  if (canPublish.value && available.includes('publish')) {
    actions.push({
      key: 'publish',
      label: '发布',
      loading: workflow.publish.running.value,
      handler: () => workflow.publish.run({ id: entity.id, label }),
    })
  }
  return actions
}
</script>

<template>
  <div class="vicp-standard-indicator-panel">
    <AppSearchPanel :loading="list.isLoading" @reset="list.reset" @search="list.search">
      <t-form-item label="指标类型">
        <t-select v-model="list.query.indicatorType" :options="indicatorTypeOptions" />
      </t-form-item>
      <t-form-item label="审核状态">
        <t-select v-model="list.query.reviewStatus" :options="reviewStatusOptions" />
      </t-form-item>
      <t-form-item label="文档 ID">
        <t-input v-model="list.query.documentId" clearable placeholder="选填" />
      </t-form-item>
    </AppSearchPanel>

    <AppDataTable
      :columns="columns"
      :data="list.data"
      empty-description="指标随标准文档人工录入生成"
      empty-title="暂无标准指标"
      :error-description="errorDescription"
      :operations-width="200"
      :show-pagination="false"
      row-key="id"
      :status="list.isLoading ? 'loading' : list.error ? 'error' : 'ready'"
      :total="list.data.length"
      @refresh="list.refresh"
      @retry="list.retry"
    >
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <t-dialog
      :cancel-btn="{ content: '取消', disabled: workflow.approveDialog.submitting }"
      :confirm-btn="{ content: '确认通过', disabled: workflow.approveDialog.submitting, loading: workflow.approveDialog.submitting, theme: 'primary' }"
      destroy-on-close
      :header="`审核通过 · ${workflow.approveDialog.target?.label ?? ''}`"
      :visible="workflow.approveDialog.visible"
      @close="workflow.closeApprove"
      @confirm="workflow.submitApprove"
    >
      <t-form-item label="审核意见">
        <t-textarea v-model="workflow.approveDialog.note" :autosize="{ minRows: 2, maxRows: 4 }" maxlength="2000" placeholder="选填" />
      </t-form-item>
    </t-dialog>

    <t-dialog
      :cancel-btn="{ content: '取消', disabled: workflow.rejectDialog.submitting }"
      :confirm-btn="{ content: '确认驳回', disabled: workflow.rejectDialog.submitting, loading: workflow.rejectDialog.submitting, theme: 'danger' }"
      destroy-on-close
      :header="`驳回 · ${workflow.rejectDialog.target?.label ?? ''}`"
      :visible="workflow.rejectDialog.visible"
      @close="workflow.closeReject"
      @confirm="workflow.submitReject"
    >
      <t-form-item label="驳回原因" required-mark>
        <t-textarea v-model="workflow.rejectDialog.reason" :autosize="{ minRows: 2, maxRows: 4 }" maxlength="2000" placeholder="必填，将反馈给提交人" />
      </t-form-item>
    </t-dialog>
  </div>
</template>

<style scoped>
.vicp-standard-indicator-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--vicp-page-gap);
  min-height: 0;
}
.vicp-ind-name {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-ind-meta {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-ind-visibility {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.vicp-ind-visibility__usage {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
</style>

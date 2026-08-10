<script setup lang="ts">
import type { PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { computed, h, onMounted, reactive, ref } from 'vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {
  approveReview,
  fetchReviewDetail,
  fetchReviewQueue,
  rejectReview,
} from '@/api/modules/review-center'
import type { AppTableAction } from '@/types/crud'
import {
  reviewEntityLabels,
  reviewEntityTypes,
  type ReviewDetail,
  type ReviewQueueItem,
  type ReviewQueueStatus,
} from '@/types/review-center'
import { formatDate } from '@/utils/day'

const { canAccess } = usePermissionAccess()
const canApprove = computed(() => canAccess({ permissions: ['system:review:approve'] }))

const feedback = useAppFeedback()

const entityType = ref('')
const status = ref<ReviewQueueStatus | ''>('PENDING_REVIEW')
const query = reactive({ page: 1, pageSize: 20 })
const items = ref<ReviewQueueItem[]>([])
const total = ref(0)
const isLoading = ref(false)
const error = ref<unknown>(null)

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const result = await fetchReviewQueue({
      page: query.page,
      pageSize: query.pageSize,
      ...(entityType.value ? { entityType: entityType.value } : {}),
      ...(status.value ? { status: status.value } : {}),
    })
    items.value = result.items
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
  entityType.value = ''
  status.value = 'PENDING_REVIEW'
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

function entityLabel(type: string): string {
  return (reviewEntityLabels as Record<string, string>)[type] ?? type
}

const running = reactive<Record<string, boolean>>({})
const rejectDialog = reactive({ visible: false, reason: '', target: null as ReviewQueueItem | null, submitting: false })
const detailDialog = reactive({ visible: false, loading: false, detail: null as ReviewDetail | null })

async function decide(item: ReviewQueueItem, task: () => Promise<ReviewQueueItem>): Promise<void> {
  if (running[item.id]) {
    return
  }
  running[item.id] = true
  try {
    await task()
    await feedback.message('success', `「${item.label}」已处理`)
    await load()
  }
  catch (cause) {
    await feedback.messageError(cause)
  }
  finally {
    delete running[item.id]
  }
}

function approveItem(item: ReviewQueueItem): void {
  void decide(item, () => approveReview(item.entityType, item.entityId))
}

function openReject(item: ReviewQueueItem): void {
  rejectDialog.target = item
  rejectDialog.reason = ''
  rejectDialog.visible = true
}

async function submitReject(): Promise<void> {
  const target = rejectDialog.target
  if (!target || rejectDialog.submitting) {
    return
  }
  const reason = rejectDialog.reason.trim()
  if (!reason) {
    await feedback.message('warning', '请填写驳回原因')
    return
  }
  rejectDialog.submitting = true
  try {
    await rejectReview(target.entityType, target.entityId, reason)
    rejectDialog.visible = false
    await feedback.message('success', `「${target.label}」已驳回`)
    await load()
  }
  catch (cause) {
    await feedback.messageError(cause)
  }
  finally {
    rejectDialog.submitting = false
  }
}

async function openDetail(item: ReviewQueueItem): Promise<void> {
  detailDialog.visible = true
  detailDialog.loading = true
  detailDialog.detail = null
  try {
    detailDialog.detail = await fetchReviewDetail(item.entityType, item.entityId)
  }
  catch (cause) {
    detailDialog.detail = null
    await feedback.messageError(cause)
  }
  finally {
    detailDialog.loading = false
  }
}

const errorDescription = computed(() => error.value
  ? normalizeFeedbackError(error.value).message
  : '请检查网络连接后重试')

type TagStatus = 'default' | 'info' | 'processing' | 'success' | 'warning' | 'error' | 'disabled'

const statusMeta: Record<ReviewQueueStatus, { label: string; status: TagStatus }> = {
  PENDING_REVIEW: { label: '待审核', status: 'warning' },
  APPROVED: { label: '已通过', status: 'success' },
  REJECTED: { label: '已驳回', status: 'error' },
}

function renderEntityPreview(entity: Record<string, unknown> | null): Array<[string, string]> {
  if (!entity) {
    return []
  }
  return Object.entries(entity)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : String(value)])
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => h('div', [
    h('div', { class: 'vicp-rv-label' }, row.label),
    h('div', { class: 'vicp-rv-type' }, entityLabel(row.entityType)),
  ]), colKey: 'label', minWidth: 240, title: '待审实体' },
  { cell: (_, { row }) => (row.entityVersion != null ? `v${row.entityVersion}` : '—'), colKey: 'entityVersion', minWidth: 70, title: '版本' },
  { cell: (_, { row }) => h(AppStatusTag, statusMeta[row.status as ReviewQueueStatus]), colKey: 'status', width: 90, title: '状态' },
  { cell: (_, { row }) => h('div', [
    h('div', {}, row.submittedAt ? formatDate(new Date(row.submittedAt), 'YYYY-MM-DD HH:mm') : '—'),
    h('div', { class: 'vicp-rv-meta' }, row.comment ?? ''),
  ]), colKey: 'submittedAt', minWidth: 170, title: '提交时间 / 意见' },
  { cell: (_, { row }) => row.reviewedAt ? formatDate(new Date(row.reviewedAt), 'YYYY-MM-DD HH:mm') : '—', colKey: 'reviewedAt', minWidth: 150, title: '处理时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as ReviewQueueItem
  const actions: AppTableAction[] = []
  const busy = running[entity.id] ?? false
  actions.push({
    key: 'detail', label: '详情',
    handler: () => void openDetail(entity),
  })
  if (canApprove.value && entity.status === 'PENDING_REVIEW') {
    actions.push({
      key: 'approve', label: '通过', loading: busy,
      handler: () => approveItem(entity),
    })
    actions.push({
      key: 'reject', label: '驳回', loading: busy, theme: 'danger',
      handler: () => openReject(entity),
    })
  }
  return actions
}

onMounted(load)
</script>

<template>
  <AppPage title="审核队列" description="统一审核中心：各专业模块提交的数据在此执行通过/驳回决议；决议后各模块状态同步流转。">
    <template #search>
      <AppSearchPanel :loading="isLoading" @reset="reset" @search="search">
        <t-form-item label="实体类型">
          <t-select
            v-model="entityType"
            :options="reviewEntityTypes.map((value) => ({ label: reviewEntityLabels[value], value }))"
            clearable
            placeholder="全部"
          />
        </t-form-item>
        <t-form-item label="状态">
          <t-select
            v-model="status"
            :options="[
              { label: '待审核', value: 'PENDING_REVIEW' },
              { label: '已通过', value: 'APPROVED' },
              { label: '已驳回', value: 'REJECTED' },
              { label: '全部', value: '' },
            ]"
          />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :data="items"
      empty-description="当前筛选条件下没有待处理事项"
      empty-title="队列为空"
      :error-description="errorDescription"
      :operations-width="170"
      row-key="id"
      :status="isLoading ? 'loading' : error ? 'error' : 'ready'"
      :total="total"
      @page-change="onPageChange"
      @page-size-change="onPageSizeChange"
      @refresh="load"
      @retry="load"
    >
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <t-dialog
      header="驳回审核"
      :confirm-btn="{ content: '确认驳回', theme: 'danger', loading: rejectDialog.submitting }"
      :visible="rejectDialog.visible"
      width="min(480px, 92vw)"
      @cancel="rejectDialog.visible = false"
      @close="rejectDialog.visible = false"
      @confirm="submitReject"
    >
      <t-form-item label="驳回原因" name="rejectReason" required-mark>
        <t-textarea v-model="rejectDialog.reason" :autosize="{ minRows: 2, maxRows: 5 }" maxlength="500" placeholder="必填，将展示给提交人" />
      </t-form-item>
    </t-dialog>

    <t-dialog
      :footer="false"
      :header="detailDialog.detail ? `审核详情：${detailDialog.detail.record.label}` : '审核详情'"
      :loading="detailDialog.loading"
      :visible="detailDialog.visible"
      width="min(640px, 94vw)"
      @close="detailDialog.visible = false"
    >
      <template v-if="detailDialog.detail">
        <t-descriptions :column="2" bordered size="small">
          <t-descriptions-item label="实体类型">
            {{ entityLabel(detailDialog.detail.record.entityType) }}
          </t-descriptions-item>
          <t-descriptions-item label="版本">
            {{ detailDialog.detail.record.entityVersion ?? '—' }}
          </t-descriptions-item>
          <t-descriptions-item label="提交人">
            {{ detailDialog.detail.record.submittedById ?? '—' }}
          </t-descriptions-item>
          <t-descriptions-item label="提交时间">
            {{ detailDialog.detail.record.submittedAt ? formatDate(new Date(detailDialog.detail.record.submittedAt), 'YYYY-MM-DD HH:mm') : '—' }}
          </t-descriptions-item>
          <t-descriptions-item label="意见" :span="2">
            {{ detailDialog.detail.record.comment ?? '—' }}
          </t-descriptions-item>
        </t-descriptions>
        <t-divider>实体数据预览</t-divider>
        <t-table
          v-if="detailDialog.detail.entity"
          :columns="[
            { colKey: 'field', title: '字段', width: 180 },
            { colKey: 'value', title: '值' },
          ]"
          :data="renderEntityPreview(detailDialog.detail.entity).map(([field, value]) => ({ field, value }))"
          size="small"
          :hover="true"
        />
        <t-empty v-else description="无实体数据预览" />
      </template>
    </t-dialog>
  </AppPage>
</template>

<style scoped>
.vicp-rv-label {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-rv-type {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-rv-meta {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
</style>
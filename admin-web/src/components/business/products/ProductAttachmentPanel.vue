<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { useCrudDrawer } from '@/composables/useCrudDrawer'
import { useCrudList } from '@/composables/useCrudList'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { useWorkflowActions, workflowActionsForStatus } from '@/composables/useWorkflowActions'
import {
  createProductAttachment,
  deleteProductAttachment,
  fetchProductAttachments,
  runProductAttachmentWorkflow,
  updateProductAttachment,
} from '@/api/modules/masterdata'
import type { AppTableAction } from '@/types/crud'
import type { ProductAttachment, ProductAttachmentInput, ProductAttachmentQuery } from '@/types/masterdata'
import { formatDate } from '@/utils/day'
import { evidenceLevelLabels, mdReviewStatusMetaFor } from '@/utils/professional-status'

/**
 * 产品附件（技术资料）列表面板。
 * 传入 lockedTarget 时锁定挂载对象（产品详情工作台内按系列查看技术资料）。
 */
const props = defineProps<{
  lockedTarget?: {
    targetType: ProductAttachment['targetType']
    targetId: string
  }
}>()

const { canAccess } = usePermissionAccess()
const canAdd = computed(() => canAccess({ permissions: ['system:md:product:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:md:product:edit'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:md:product:remove'] }))
const canApprove = computed(() => canAccess({ permissions: ['system:md:product:approve'] }))
const canPublish = computed(() => canAccess({ permissions: ['system:md:product:publish'] }))

const list = useCrudList<ProductAttachment, ProductAttachmentQuery>({
  createQuery: () => ({
    page: 1,
    pageSize: 20,
    keyword: '',
    status: '',
    targetType: props.lockedTarget?.targetType ?? '',
    targetId: props.lockedTarget?.targetId ?? '',
  }),
  fetcher: ({ query, page, pageSize, signal }) =>
    fetchProductAttachments({
      ...query,
      page,
      pageSize,
      status: !query.status || query.status === 'all' ? undefined : query.status,
      targetType: !query.targetType || query.targetType === 'all' ? undefined : query.targetType,
    } as ProductAttachmentQuery, signal),
  immediate: true,
  rowKey: 'id',
})

const drawer = useCrudDrawer<ProductAttachmentInput, ProductAttachment>({
  createForm: () => ({
    targetType: props.lockedTarget?.targetType ?? 'PRODUCT_SERIES',
    targetId: props.lockedTarget?.targetId ?? '',
    fileId: '',
    attachmentType: '',
    name: '',
    description: '',
    evidenceSource: '',
    evidenceRef: '',
    evidenceLevel: undefined,
  }),
  editForm: (entity) => ({
    targetType: entity.targetType,
    targetId: entity.targetId,
    fileId: entity.fileId,
    attachmentType: entity.attachmentType,
    name: entity.name ?? '',
    description: entity.description ?? '',
    evidenceSource: entity.evidenceSource ?? '',
    evidenceRef: entity.evidenceRef ?? '',
    evidenceLevel: entity.evidenceLevel ?? undefined,
  }),
  submit: async ({ mode, data, entity }) => {
    const input = {
      ...data,
      attachmentType: data.attachmentType || undefined,
      name: data.name || undefined,
      description: data.description || undefined,
      evidenceSource: data.evidenceSource || undefined,
      evidenceRef: data.evidenceRef || undefined,
      evidenceLevel: data.evidenceLevel ?? undefined,
    }
    const result = mode === 'create'
      ? await createProductAttachment(input)
      : await updateProductAttachment(entity!.id, input)
    return result
  },
  onSuccess: () => list.refresh(),
})

const deleteAction = useConfirmedCrudAction<ProductAttachment, unknown>({
  action: (row) => deleteProductAttachment(row.id),
  confirm: (row) => ({ title: '删除草稿', content: `确定删除附件「${row.name ?? row.attachmentType}」？仅草稿可删除。`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => list.refresh(),
})

const workflow = useWorkflowActions<ProductAttachment>({
  entityName: '产品附件',
  run: (id, action) => runProductAttachmentWorkflow(id, action).then((r) => r.item),
  onSuccess: () => list.refresh(),
})

const errorDescription = computed(() => list.error.value
  ? normalizeFeedbackError(list.error.value).message
  : '请检查网络连接后重试')

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '草稿', value: 'DRAFT' },
  { label: '待审核', value: 'PENDING_REVIEW' },
  { label: '已通过', value: 'APPROVED' },
  { label: '已发布', value: 'PUBLISHED' },
  { label: '已停用', value: 'DISABLED' },
  { label: '已驳回', value: 'REJECTED' },
]

const targetTypeOptions = [
  { label: '产品系列', value: 'PRODUCT_SERIES' },
  { label: '产品规格', value: 'PRODUCT_SPEC' },
  { label: '企业', value: 'ENTERPRISE' },
]

const targetTypeLabels: Record<string, string> = Object.fromEntries(
  targetTypeOptions.map((item) => [item.value, item.label]),
)

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => h('div', [
    h('div', { class: 'vicp-att-name' }, row.name ?? row.attachmentType),
    row.attachmentType ? h('div', { class: 'vicp-att-type' }, row.attachmentType) : null,
  ]), colKey: 'name', minWidth: 200, title: '附件名称' },
  { cell: (_, { row }) => targetTypeLabels[row.targetType] ?? row.targetType, colKey: 'targetType', minWidth: 100, title: '挂载对象' },
  { cell: (_, { row }) => row.fileId, colKey: 'fileId', minWidth: 220, title: '文件 ID' },
  { cell: (_, { row }) => h(AppStatusTag, mdReviewStatusMetaFor(row.status)), colKey: 'status', title: '状态', width: 100 },
  { cell: (_, { row }) => formatDate(new Date(row.updatedAt)), colKey: 'updatedAt', minWidth: 160, title: '更新时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as ProductAttachment
  const actions: AppTableAction[] = []
  const label = entity.name ?? entity.attachmentType
  const available = workflowActionsForStatus(entity.status)

  if (canEdit.value && (entity.status === 'DRAFT' || entity.status === 'REJECTED')) {
    actions.push({ key: 'edit', label: '编辑', handler: () => drawer.openEdit(entity) })
  }
  if (canAdd.value && available.includes('submit')) {
    actions.push({
      key: 'submit', label: '提交审核', loading: workflow.submit.running.value,
      handler: () => workflow.submit.run({ id: entity.id, label }),
    })
  }
  if (canApprove.value && available.includes('approve')) {
    actions.push({
      key: 'approve', label: '通过', loading: workflow.approveRunning.value,
      handler: () => workflow.openApprove({ id: entity.id, label }),
    })
    actions.push({
      key: 'reject', label: '驳回', loading: workflow.rejectRunning.value, theme: 'danger',
      handler: () => workflow.openReject({ id: entity.id, label }),
    })
  }
  if (canPublish.value && available.includes('publish')) {
    actions.push({
      key: 'publish', label: '发布', loading: workflow.publish.running.value,
      handler: () => workflow.publish.run({ id: entity.id, label }),
    })
  }
  if (canPublish.value && available.includes('disable')) {
    actions.push({
      key: 'disable', label: '停用', loading: workflow.disable.running.value, theme: 'warning',
      handler: () => workflow.disable.run({ id: entity.id, label }),
    })
  }
  if (canRemove.value && entity.status === 'DRAFT') {
    actions.push({
      key: 'remove', label: '删除', loading: deleteAction.running.value, theme: 'danger',
      handler: () => deleteAction.run(entity),
    })
  }
  return actions
}
</script>

<template>
  <div class="vicp-att-panel">
    <AppSearchPanel :loading="list.isLoading.value" @reset="list.reset" @search="list.search">
      <t-form-item label="关键词">
        <t-input v-model="list.query.keyword" clearable placeholder="附件名称" />
      </t-form-item>
      <t-form-item v-if="!lockedTarget" label="挂载对象">
        <t-select v-model="list.query.targetType" :options="targetTypeOptions" clearable placeholder="全部" />
      </t-form-item>
      <t-form-item label="状态">
        <t-select v-model="list.query.status" :options="statusOptions" />
      </t-form-item>
    </AppSearchPanel>

    <AppDataTable
      :columns="columns"
      :current="list.current.value"
      :data="list.data.value"
      empty-description="可新增第一份技术资料"
      empty-title="暂无技术资料"
      :error-description="errorDescription"
      :operations-width="240"
      :page-size="list.pageSize.value"
      row-key="id"
      :status="list.tableStatus.value"
      :total="list.total.value"
      @page-change="list.changePage"
      @refresh="list.refresh"
      @retry="list.retry"
    >
      <template #toolbar>
        <t-button v-if="canAdd" theme="primary" @click="drawer.openCreate">
          <template #icon><AddIcon /></template>
          上传技术资料
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      :columns="2"
      :form-data="drawer.formData"
      :mode="drawer.mode.value"
      :submitting="drawer.isSubmitting.value"
      :title="drawer.mode.value === 'create' ? '上传技术资料' : '编辑技术资料'"
      :visible="drawer.visible.value"
      :width="'min(720px, 92vw)'"
      @cancel="drawer.close"
      @submit="drawer.submit"
      @update:visible="drawer.setVisible"
    >
      <t-form-item label="挂载对象" name="targetType" required-mark>
        <t-select v-model="drawer.formData.targetType" :disabled="Boolean(lockedTarget)" :options="targetTypeOptions" />
      </t-form-item>
      <t-form-item label="对象 ID" name="targetId" required-mark>
        <t-input v-model="drawer.formData.targetId" :disabled="Boolean(lockedTarget)" placeholder="目标实体 UUID" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="文件 ID" name="fileId" required-mark>
        <t-input v-model="drawer.formData.fileId" placeholder="上传后回填的文件 UUID" />
      </t-form-item>
      <t-form-item label="附件类型" name="attachmentType">
        <t-input v-model="drawer.formData.attachmentType" maxlength="40" placeholder="如：检测报告" />
      </t-form-item>
      <t-form-item label="附件名称" name="name">
        <t-input v-model="drawer.formData.name" maxlength="160" placeholder="选填" />
      </t-form-item>
      <t-form-item label="资料可信度" name="evidenceLevel">
        <t-select
          v-model="drawer.formData.evidenceLevel"
          :options="[
            { label: evidenceLevelLabels.A, value: 'A' },
            { label: evidenceLevelLabels.B, value: 'B' },
            { label: evidenceLevelLabels.C, value: 'C' },
          ]"
          clearable
          placeholder="选填"
        />
      </t-form-item>
      <t-form-item label="资料出处" name="evidenceSource">
        <t-input v-model="drawer.formData.evidenceSource" maxlength="500" placeholder="选填" />
      </t-form-item>
      <t-form-item label="页码 / 条款" name="evidenceRef">
        <t-input v-model="drawer.formData.evidenceRef" maxlength="120" placeholder="选填" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="备注" name="description">
        <t-textarea v-model="drawer.formData.description" :autosize="{ minRows: 2, maxRows: 4 }" maxlength="2000" placeholder="选填" />
      </t-form-item>
    </AppCrudFormDialog>

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
.vicp-att-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--vicp-page-gap);
  min-height: 0;
}
.vicp-att-name {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-att-type {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-form-wide {
  grid-column: 1 / -1;
}
</style>

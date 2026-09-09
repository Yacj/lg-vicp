<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import { createEvidenceColumn } from '@/components/business/evidence-column'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppVersionMeta from '@/components/business/AppVersionMeta.vue'
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
  createMaterial,
  deleteMaterial,
  fetchMaterials,
  runMaterialWorkflow,
  updateMaterial,
} from '@/api/modules/masterdata'
import type { AppTableAction } from '@/types/crud'
import type { Material, MaterialInput, MaterialQuery } from '@/types/masterdata'
import { formatDate } from '@/utils/day'
import { evidenceLevelLabels, mdReviewStatusMetaFor } from '@/utils/professional-status'

/** 材料库面板：保温材料基础档案，版本化审核发布。 */
const { canAccess } = usePermissionAccess()
const canAdd = computed(() => canAccess({ permissions: ['system:md:material:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:md:material:edit'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:md:material:remove'] }))
const canApprove = computed(() => canAccess({ permissions: ['system:md:material:approve'] }))
const canPublish = computed(() => canAccess({ permissions: ['system:md:material:publish'] }))

const list = useCrudList<Material, MaterialQuery>({
  createQuery: () => ({ page: 1, pageSize: 20, keyword: '', status: '' }),
  fetcher: ({ query, page, pageSize, signal }) =>
    fetchMaterials({ ...query, page, pageSize, status: !query.status || query.status === 'all' ? undefined : query.status } as MaterialQuery, signal),
  immediate: true,
  rowKey: 'id',
})

const drawer = useCrudDrawer<MaterialInput, Material>({
  createForm: () => ({
    code: '',
    name: '',
    category: '',
    description: '',
    changeNote: '',
    evidenceSource: '',
    evidenceRef: '',
    evidenceLevel: undefined,
  }),
  editForm: (entity) => ({
    code: entity.code,
    name: entity.name,
    category: entity.category ?? '',
    description: entity.description ?? '',
    changeNote: '',
    evidenceSource: entity.evidenceSource ?? '',
    evidenceRef: entity.evidenceRef ?? '',
    evidenceLevel: entity.evidenceLevel ?? undefined,
  }),
  submit: async ({ mode, data, entity }) => {
    const input = {
      ...data,
      changeNote: data.changeNote || undefined,
      category: data.category || undefined,
      description: data.description || undefined,
      evidenceSource: data.evidenceSource || undefined,
      evidenceRef: data.evidenceRef || undefined,
      evidenceLevel: data.evidenceLevel ?? undefined,
    }
    const result = mode === 'create'
      ? await createMaterial(input)
      : await updateMaterial(entity!.id, input)
    return result
  },
  onSuccess: () => list.refresh(),
})

const deleteAction = useConfirmedCrudAction<Material, unknown>({
  action: (row) => deleteMaterial(row.id),
  confirm: (row) => ({ title: '删除草稿', content: `确定删除「${row.name}」？仅草稿可删除。`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => list.refresh(),
})

const workflow = useWorkflowActions<Material>({
  entityName: '材料',
  run: (id, action) => runMaterialWorkflow(id, action).then((r) => r.item),
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

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => h('div', [
    h('div', { class: 'vicp-material-name' }, row.name),
    row.code ? h('div', { class: 'vicp-material-code' }, row.code) : null,
  ]), colKey: 'name', minWidth: 200, title: '材料名称' },
  { cell: (_, { row }) => row.category ?? '—', colKey: 'category', minWidth: 140, title: '分类' },
  { cell: (_, { row }) => h(AppVersionMeta, { version: row.version, changeNote: row.changeNote }), colKey: 'version', minWidth: 130, title: '版本' },
  { cell: (_, { row }) => h(AppStatusTag, mdReviewStatusMetaFor(row.status)), colKey: 'status', title: '状态', width: 100 },
  createEvidenceColumn(200),
  { cell: (_, { row }) => formatDate(new Date(row.updatedAt)), colKey: 'updatedAt', minWidth: 160, title: '更新时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as Material
  const actions: AppTableAction[] = []
  const available = workflowActionsForStatus(entity.status)

  if (canEdit.value && (entity.status === 'DRAFT' || entity.status === 'REJECTED')) {
    actions.push({ key: 'edit', label: '编辑', handler: () => drawer.openEdit(entity) })
  }
  if (canAdd.value && available.includes('submit')) {
    actions.push({
      key: 'submit', label: '提交审核', loading: workflow.submit.running.value,
      handler: () => workflow.submit.run({ id: entity.id, label: entity.name }),
    })
  }
  if (canApprove.value && available.includes('approve')) {
    actions.push({
      key: 'approve', label: '通过', loading: workflow.approveRunning.value,
      handler: () => workflow.openApprove({ id: entity.id, label: entity.name }),
    })
    actions.push({
      key: 'reject', label: '驳回', loading: workflow.rejectRunning.value, theme: 'danger',
      handler: () => workflow.openReject({ id: entity.id, label: entity.name }),
    })
  }
  if (canPublish.value && available.includes('publish')) {
    actions.push({
      key: 'publish', label: '发布', loading: workflow.publish.running.value,
      handler: () => workflow.publish.run({ id: entity.id, label: entity.name }),
    })
  }
  if (canPublish.value && available.includes('disable')) {
    actions.push({
      key: 'disable', label: '停用', loading: workflow.disable.running.value, theme: 'warning',
      handler: () => workflow.disable.run({ id: entity.id, label: entity.name }),
    })
  }
  if (canPublish.value && available.includes('new-version')) {
    actions.push({
      key: 'new-version', label: '新版本', loading: workflow.newVersion.running.value,
      handler: () => workflow.newVersion.run({ id: entity.id, label: entity.name }),
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
  <div class="vicp-material-panel">
    <AppSearchPanel :loading="list.isLoading.value" @reset="list.reset" @search="list.search">
      <t-form-item label="关键词">
        <t-input v-model="list.query.keyword" clearable placeholder="名称 / 编码" />
      </t-form-item>
      <t-form-item label="状态">
        <t-select v-model="list.query.status" :options="statusOptions" />
      </t-form-item>
    </AppSearchPanel>

    <AppDataTable
      :columns="columns"
      :current="list.current.value"
      :data="list.data.value"
      empty-description="可新增第一种材料"
      empty-title="暂无材料"
      :error-description="errorDescription"
      :operations-width="260"
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
          新增材料
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
      :title="drawer.mode.value === 'create' ? '新增材料' : '编辑材料'"
      :visible="drawer.visible.value"
      :width="'min(720px, 92vw)'"
      @cancel="drawer.close"
      @submit="drawer.submit"
      @update:visible="drawer.setVisible"
    >
      <t-form-item label="材料编码" name="code">
        <t-input v-model="drawer.formData.code" maxlength="80" placeholder="唯一逻辑键，如 VICP-P-001" />
      </t-form-item>
      <t-form-item label="材料名称" name="name">
        <t-input v-model="drawer.formData.name" maxlength="160" placeholder="请输入材料名称" />
      </t-form-item>
      <t-form-item label="分类" name="category">
        <t-input v-model="drawer.formData.category" maxlength="120" placeholder="选填，如：保温板" />
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
        <t-input v-model="drawer.formData.evidenceSource" maxlength="500" placeholder="如：检测报告、产品标准" />
      </t-form-item>
      <t-form-item label="页码 / 条款" name="evidenceRef">
        <t-input v-model="drawer.formData.evidenceRef" maxlength="120" placeholder="选填" />
      </t-form-item>
      <t-form-item v-if="drawer.mode.value === 'edit'" label="变更说明" name="changeNote">
        <t-input v-model="drawer.formData.changeNote" maxlength="2000" placeholder="本次修改内容（可选）" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="描述" name="description">
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
.vicp-material-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--vicp-page-gap);
  min-height: 0;
}
.vicp-material-name {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-material-code {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-form-wide {
  grid-column: 1 / -1;
}
</style>

<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import { createEvidenceColumn } from '@/components/business/evidence-column'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppVersionMeta from '@/components/business/AppVersionMeta.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { useCrudDrawer } from '@/composables/useCrudDrawer'
import { useCrudList } from '@/composables/useCrudList'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { useWorkflowActions, workflowActionsForStatus } from '@/composables/useWorkflowActions'
import {
  createEnterpriseProfile,
  deleteEnterpriseProfile,
  fetchEnterpriseProfiles,
  runEnterpriseProfileWorkflow,
  updateEnterpriseProfile,
} from '@/api/modules/masterdata'
import type { AppTableAction } from '@/types/crud'
import type { EnterpriseProfile, EnterpriseProfileInput, EnterpriseProfileQuery } from '@/types/masterdata'
import { formatDate } from '@/utils/day'
import { evidenceLevelLabels, mdReviewStatusMetaFor } from '@/utils/professional-status'

const { canAccess } = usePermissionAccess()
const canAdd = computed(() => canAccess({ permissions: ['system:md:enterprise:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:md:enterprise:edit'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:md:enterprise:remove'] }))
const canApprove = computed(() => canAccess({ permissions: ['system:md:enterprise:approve'] }))
const canPublish = computed(() => canAccess({ permissions: ['system:md:enterprise:publish'] }))

const list = useCrudList<EnterpriseProfile, EnterpriseProfileQuery>({
  createQuery: () => ({ page: 1, pageSize: 20, keyword: '', status: '' }),
  fetcher: ({ query, page, pageSize, signal }) =>
    fetchEnterpriseProfiles({ ...query, page, pageSize, status: !query.status || query.status === 'all' ? undefined : query.status } as EnterpriseProfileQuery, signal),
  immediate: true,
  rowKey: 'id',
})

const drawer = useCrudDrawer<EnterpriseProfileInput, EnterpriseProfile>({
  createForm: () => ({
    name: '',
    code: '',
    shortName: '',
    intro: '',
    address: '',
    contactPhone: '',
    contactEmail: '',
    website: '',
    changeNote: '',
    evidenceSource: '',
    evidenceRef: '',
    evidenceLevel: undefined,
  }),
  editForm: (entity) => ({
    name: entity.name,
    code: entity.code,
    shortName: entity.shortName ?? '',
    intro: entity.intro ?? '',
    address: entity.address ?? '',
    contactPhone: entity.contactPhone ?? '',
    contactEmail: entity.contactEmail ?? '',
    website: entity.website ?? '',
    changeNote: '',
    evidenceSource: entity.evidenceSource ?? '',
    evidenceRef: entity.evidenceRef ?? '',
    evidenceLevel: entity.evidenceLevel ?? undefined,
  }),
  submit: async ({ mode, data, entity }) => {
    const input = {
      ...data,
      changeNote: data.changeNote || undefined,
      evidenceSource: data.evidenceSource || undefined,
      evidenceRef: data.evidenceRef || undefined,
      evidenceLevel: data.evidenceLevel ?? undefined,
    }
    const result = mode === 'create'
      ? await createEnterpriseProfile(input)
      : await updateEnterpriseProfile(entity!.id, input)
    return result
  },
  onSuccess: () => list.refresh(),
})

const deleteAction = useConfirmedCrudAction<EnterpriseProfile, unknown>({
  action: (row) => deleteEnterpriseProfile(row.id),
  confirm: (row) => ({ title: '删除草稿', content: `确定删除「${row.name}」？仅草稿可删除。`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => list.refresh(),
})

const workflow = useWorkflowActions<EnterpriseProfile>({
  entityName: '企业简介',
  run: (id, action) => runEnterpriseProfileWorkflow(id, action).then((r) => r.item),
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
    h('div', { class: 'vicp-entity-name' }, row.name),
    row.code ? h('div', { class: 'vicp-entity-code' }, row.code) : null,
  ]), colKey: 'name', minWidth: 200, title: '企业名称' },
  { cell: (_, { row }) => h(AppVersionMeta, { version: row.version, changeNote: row.changeNote }), colKey: 'version', minWidth: 130, title: '版本' },
  { cell: (_, { row }) => h(AppStatusTag, mdReviewStatusMetaFor(row.status)), colKey: 'status', title: '状态', width: 100 },
  createEvidenceColumn(220),
  { cell: (_, { row }) => formatDate(new Date(row.updatedAt)), colKey: 'updatedAt', minWidth: 160, title: '更新时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as EnterpriseProfile
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
  <AppPage title="企业简介" description="维护企业对外公开的基础信息；版本化审核发布，同键仅一个已发布版本。">
    <template #search>
      <AppSearchPanel :loading="list.isLoading.value" @reset="list.reset" @search="list.search">
        <t-form-item label="关键词">
          <t-input v-model="list.query.keyword" clearable placeholder="名称 / 编码" />
        </t-form-item>
        <t-form-item label="状态">
          <t-select v-model="list.query.status" :options="statusOptions" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :current="list.current.value"
      :data="list.data.value"
      empty-description="可新增第一条企业简介"
      empty-title="暂无企业简介"
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
          新增企业简介
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
      :title="drawer.mode.value === 'create' ? '新增企业简介' : '编辑企业简介'"
      :visible="drawer.visible.value"
      :width="'min(720px, 92vw)'"
      @cancel="drawer.close"
      @submit="drawer.submit"
      @update:visible="drawer.setVisible"
    >
      <t-form-item class="vicp-form-wide" label="企业名称" name="name">
        <t-input v-model="drawer.formData.name" maxlength="160" placeholder="请输入企业名称" />
      </t-form-item>
      <t-form-item label="企业编码" name="code">
        <t-input v-model="drawer.formData.code" maxlength="80" placeholder="唯一逻辑键，建议拼音缩写" />
      </t-form-item>
      <t-form-item label="简称" name="shortName">
        <t-input v-model="drawer.formData.shortName" maxlength="80" placeholder="选填" />
      </t-form-item>
      <t-form-item label="联系电话" name="contactPhone">
        <t-input v-model="drawer.formData.contactPhone" maxlength="32" placeholder="选填" />
      </t-form-item>
      <t-form-item label="联系邮箱" name="contactEmail">
        <t-input v-model="drawer.formData.contactEmail" maxlength="120" placeholder="选填" />
      </t-form-item>
      <t-form-item label="官网" name="website">
        <t-input v-model="drawer.formData.website" maxlength="255" placeholder="选填" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="地址" name="address">
        <t-input v-model="drawer.formData.address" maxlength="255" placeholder="选填" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="企业简介" name="intro">
        <t-textarea v-model="drawer.formData.intro" :autosize="{ minRows: 3, maxRows: 6 }" maxlength="4000" placeholder="选填" />
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
        <t-input v-model="drawer.formData.evidenceSource" maxlength="500" placeholder="如：企业官网、检测报告" />
      </t-form-item>
      <t-form-item label="页码 / 条款" name="evidenceRef">
        <t-input v-model="drawer.formData.evidenceRef" maxlength="120" placeholder="选填" />
      </t-form-item>
      <t-form-item v-if="drawer.mode.value === 'edit'" label="变更说明" name="changeNote">
        <t-input v-model="drawer.formData.changeNote" maxlength="2000" placeholder="本次修改内容（可选）" />
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
  </AppPage>
</template>

<style scoped>
.vicp-entity-name {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-entity-code {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-form-wide {
  grid-column: 1 / -1;
}
</style>
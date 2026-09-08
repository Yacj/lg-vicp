<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, ref } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppVersionMeta from '@/components/business/AppVersionMeta.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
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
  createProductParameter,
  deleteProductParameter,
  fetchProductParameters,
  fetchProductSpecs,
  runProductParameterWorkflow,
  updateProductParameter,
} from '@/api/modules/masterdata'
import type { AppTableAction } from '@/types/crud'
import type { ProductParameter, ProductParameterInput, ProductParameterQuery } from '@/types/masterdata'
import { formatDate } from '@/utils/day'
import { evidenceLevelLabels, mdReviewStatusMetaFor } from '@/utils/professional-status'

const { canAccess } = usePermissionAccess()
const canAdd = computed(() => canAccess({ permissions: ['system:md:product:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:md:product:edit'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:md:product:remove'] }))
const canApprove = computed(() => canAccess({ permissions: ['system:md:product:approve'] }))
const canPublish = computed(() => canAccess({ permissions: ['system:md:product:publish'] }))

const specOptions = ref<Array<{ label: string; value: string }>>([])
const specLoading = ref(false)

async function loadSpecOptions(): Promise<void> {
  specLoading.value = true
  try {
    const result = await fetchProductSpecs({ page: 1, pageSize: 100 })
    specOptions.value = result.items.map((item) => ({ label: `${item.specCode}（${item.thicknessMm}mm）`, value: item.id }))
  }
  finally {
    specLoading.value = false
  }
}

const list = useCrudList<ProductParameter, ProductParameterQuery>({
  createQuery: () => ({ page: 1, pageSize: 20, keyword: '', status: '', specId: '', parameterCode: '', paramSource: '' }),
  fetcher: ({ query, page, pageSize, signal }) =>
    fetchProductParameters({ ...query, page, pageSize, status: !query.status || query.status === 'all' ? undefined : query.status, paramSource: !query.paramSource || query.paramSource === 'all' ? undefined : query.paramSource } as ProductParameterQuery, signal),
  immediate: true,
  rowKey: 'id',
})

const drawer = useCrudDrawer<ProductParameterInput, ProductParameter>({
  createForm: () => ({
    specId: '',
    parameterCode: '',
    parameterName: '',
    paramSource: 'ENTERPRISE_NOMINAL',
    value: 0,
    unit: '',
    allowedUsage: [],
    applicableScope: '',
    testReportFileId: '',
    changeNote: '',
    evidenceSource: '',
    evidenceRef: '',
    evidenceLevel: undefined,
  }),
  editForm: (entity) => ({
    specId: entity.specId,
    parameterCode: entity.parameterCode,
    parameterName: entity.parameterName,
    paramSource: entity.paramSource,
    value: entity.value,
    unit: entity.unit ?? '',
    allowedUsage: [...entity.allowedUsage],
    applicableScope: entity.applicableScope ?? '',
    testReportFileId: entity.testReportFileId ?? '',
    changeNote: '',
    evidenceSource: entity.evidenceSource ?? '',
    evidenceRef: entity.evidenceRef ?? '',
    evidenceLevel: entity.evidenceLevel ?? undefined,
  }),
  submit: async ({ mode, data, entity }) => {
    const input = {
      ...data,
      unit: data.unit || undefined,
      applicableScope: data.applicableScope || undefined,
      testReportFileId: data.testReportFileId || undefined,
      changeNote: data.changeNote || undefined,
      evidenceSource: data.evidenceSource || undefined,
      evidenceRef: data.evidenceRef || undefined,
      evidenceLevel: data.evidenceLevel ?? undefined,
    }
    const result = mode === 'create'
      ? await createProductParameter(input)
      : await updateProductParameter(entity!.id, input)
    return result
  },
  onSuccess: () => list.refresh(),
})

const deleteAction = useConfirmedCrudAction<ProductParameter, unknown>({
  action: (row) => deleteProductParameter(row.id),
  confirm: (row) => ({ title: '删除草稿', content: `确定删除参数「${row.parameterName}」？仅草稿可删除。`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => list.refresh(),
})

const workflow = useWorkflowActions<ProductParameter>({
  entityName: '产品性能参数',
  run: (id, action) => runProductParameterWorkflow(id, action).then((r) => r.item),
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

const paramSourceOptions = [
  { label: '技术规程', value: 'TECHNICAL_REGULATION' },
  { label: '图集', value: 'ATLAS' },
  { label: '检测报告', value: 'DETECTION' },
  { label: '企业标称', value: 'ENTERPRISE_NOMINAL' },
]

const paramSourceLabels: Record<string, string> = Object.fromEntries(
  paramSourceOptions.map((item) => [item.value, item.label]),
)

function specName(id: string): string {
  return specOptions.value.find((item) => item.value === id)?.label ?? id
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => h('div', [
    h('div', { class: 'vicp-param-name' }, row.parameterName),
    row.parameterCode ? h('div', { class: 'vicp-param-code' }, `${row.parameterCode} · ${specName(row.specId)}`) : null,
  ]), colKey: 'parameterName', minWidth: 200, title: '参数名称' },
  { cell: (_, { row }) => `${row.value}${row.unit ? ` ${row.unit}` : ''}`, colKey: 'value', minWidth: 120, title: '数值' },
  { cell: (_, { row }) => paramSourceLabels[row.paramSource] ?? row.paramSource, colKey: 'paramSource', minWidth: 110, title: '来源类型' },
  { cell: (_, { row }) => h(AppVersionMeta, { version: row.version, changeNote: row.changeNote }), colKey: 'version', minWidth: 130, title: '版本' },
  { cell: (_, { row }) => h(AppStatusTag, mdReviewStatusMetaFor(row.status)), colKey: 'status', title: '状态', width: 100 },
  { cell: (_, { row }) => formatDate(new Date(row.updatedAt)), colKey: 'updatedAt', minWidth: 160, title: '更新时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as ProductParameter
  const actions: AppTableAction[] = []
  const label = `${entity.parameterName}（${specName(entity.specId)}）`
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
  if (canPublish.value && available.includes('new-version')) {
    actions.push({
      key: 'new-version', label: '新版本', loading: workflow.newVersion.running.value,
      handler: () => workflow.newVersion.run({ id: entity.id, label }),
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

onMounted(loadSpecOptions)
</script>

<template>
  <AppPage title="产品参数" description="产品性能参数（导热系数等），作为热工计算的参数来源之一；同规格同参数码同来源仅一个已发布版本。">
    <template #search>
      <AppSearchPanel :loading="list.isLoading.value" @reset="list.reset" @search="list.search">
        <t-form-item label="关键词">
          <t-input v-model="list.query.keyword" clearable placeholder="参数名称 / 编码" />
        </t-form-item>
        <t-form-item label="产品规格">
          <t-select
            v-model="list.query.specId"
            :loading="specLoading"
            :options="specOptions"
            clearable
            filterable
            placeholder="全部规格"
          />
        </t-form-item>
        <t-form-item label="来源类型">
          <t-select v-model="list.query.paramSource" :options="paramSourceOptions" clearable placeholder="全部" />
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
      empty-description="可新增第一个产品参数"
      empty-title="暂无产品参数"
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
          新增产品参数
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
      :title="drawer.mode.value === 'create' ? '新增产品参数' : '编辑产品参数'"
      :visible="drawer.visible.value"
      :width="'min(760px, 92vw)'"
      @cancel="drawer.close"
      @submit="drawer.submit"
      @update:visible="drawer.setVisible"
    >
      <t-form-item class="vicp-form-wide" label="产品规格" name="specId" required-mark>
        <t-select
          v-model="drawer.formData.specId"
          :loading="specLoading"
          :options="specOptions"
          filterable
          placeholder="请选择产品规格"
        />
      </t-form-item>
      <t-form-item label="参数编码" name="parameterCode" required-mark>
        <t-input v-model="drawer.formData.parameterCode" maxlength="80" placeholder="唯一逻辑键（规格内）" />
      </t-form-item>
      <t-form-item label="参数名称" name="parameterName" required-mark>
        <t-input v-model="drawer.formData.parameterName" maxlength="120" placeholder="如：导热系数" />
      </t-form-item>
      <t-form-item label="来源类型" name="paramSource" required-mark>
        <t-select v-model="drawer.formData.paramSource" :options="paramSourceOptions" placeholder="请选择" />
      </t-form-item>
      <t-form-item label="数值" name="value" required-mark>
        <t-input-number v-model="drawer.formData.value" :min="0" :precision="4" :step="0.001" />
      </t-form-item>
      <t-form-item label="单位" name="unit">
        <t-input v-model="drawer.formData.unit" maxlength="40" placeholder="如：W/(m·K)" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="允许用途" name="allowedUsage">
        <t-select
          v-model="drawer.formData.allowedUsage"
          :options="[]"
          allow-create
          clearable
          multiple
          placeholder="输入后回车创建"
        />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="适用范围" name="applicableScope">
        <t-input v-model="drawer.formData.applicableScope" maxlength="500" placeholder="选填" />
      </t-form-item>
      <t-form-item label="检测报告文件 ID" name="testReportFileId">
        <t-input v-model="drawer.formData.testReportFileId" maxlength="80" placeholder="选填，上传后回填" />
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
        <t-input v-model="drawer.formData.evidenceSource" maxlength="500" placeholder="如：型式检验报告" />
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
.vicp-param-name {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-param-code {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-form-wide {
  grid-column: 1 / -1;
}
</style>
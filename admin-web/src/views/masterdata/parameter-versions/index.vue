<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, ref } from 'vue'
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
  createMaterialParameterVersion,
  deleteMaterialParameterVersion,
  fetchMaterialParameterVersions,
  fetchMaterials,
  runMaterialParameterVersionWorkflow,
  updateMaterialParameterVersion,
} from '@/api/modules/masterdata'
import type { AppTableAction } from '@/types/crud'
import type { MaterialParameterVersion, MaterialParameterVersionInput, MaterialParameterVersionQuery } from '@/types/masterdata'
import { formatDate } from '@/utils/day'
import { evidenceLevelLabels, mdReviewStatusMetaFor } from '@/utils/professional-status'

const { canAccess } = usePermissionAccess()
const canAdd = computed(() => canAccess({ permissions: ['system:md:material:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:md:material:edit'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:md:material:remove'] }))
const canApprove = computed(() => canAccess({ permissions: ['system:md:material:approve'] }))
const canPublish = computed(() => canAccess({ permissions: ['system:md:material:publish'] }))

const materialOptions = ref<Array<{ label: string; value: string }>>([])
const materialLoading = ref(false)

async function loadMaterialOptions(): Promise<void> {
  materialLoading.value = true
  try {
    const result = await fetchMaterials({ page: 1, pageSize: 100 })
    materialOptions.value = result.items.map((item) => ({ label: `${item.name}${item.code ? `（${item.code}）` : ''}`, value: item.id }))
  }
  finally {
    materialLoading.value = false
  }
}

const list = useCrudList<MaterialParameterVersion, MaterialParameterVersionQuery>({
  createQuery: () => ({ page: 1, pageSize: 20, keyword: '', status: '', materialId: '' }),
  fetcher: ({ query, page, pageSize, signal }) =>
    fetchMaterialParameterVersions({ ...query, page, pageSize, status: !query.status || query.status === 'all' ? undefined : query.status } as MaterialParameterVersionQuery, signal),
  immediate: true,
  rowKey: 'id',
})

const drawer = useCrudDrawer<MaterialParameterVersionInput, MaterialParameterVersion>({
  createForm: () => ({
    materialId: '',
    thermalConductivity: 0,
    correctionFactor: undefined,
    density: undefined,
    compressiveStrength: undefined,
    bondStrength: undefined,
    combustionGrade: '',
    applicableStandard: '',
    source: '',
    allowedUsage: [],
    applicableScope: '',
    changeNote: '',
    evidenceSource: '',
    evidenceRef: '',
    evidenceLevel: undefined,
  }),
  editForm: (entity) => ({
    materialId: entity.materialId,
    thermalConductivity: entity.thermalConductivity,
    correctionFactor: entity.correctionFactor ?? undefined,
    density: entity.density ?? undefined,
    compressiveStrength: entity.compressiveStrength ?? undefined,
    bondStrength: entity.bondStrength ?? undefined,
    combustionGrade: entity.combustionGrade ?? '',
    applicableStandard: entity.applicableStandard ?? '',
    source: entity.source ?? '',
    allowedUsage: [...entity.allowedUsage],
    applicableScope: entity.applicableScope ?? '',
    changeNote: '',
    evidenceSource: entity.evidenceSource ?? '',
    evidenceRef: entity.evidenceRef ?? '',
    evidenceLevel: entity.evidenceLevel ?? undefined,
  }),
  submit: async ({ mode, data, entity }) => {
    const input = {
      ...data,
      correctionFactor: data.correctionFactor ?? undefined,
      density: data.density ?? undefined,
      compressiveStrength: data.compressiveStrength ?? undefined,
      bondStrength: data.bondStrength ?? undefined,
      combustionGrade: data.combustionGrade || undefined,
      applicableStandard: data.applicableStandard || undefined,
      source: data.source || undefined,
      applicableScope: data.applicableScope || undefined,
      changeNote: data.changeNote || undefined,
      evidenceSource: data.evidenceSource || undefined,
      evidenceRef: data.evidenceRef || undefined,
      evidenceLevel: data.evidenceLevel ?? undefined,
    }
    const result = mode === 'create'
      ? await createMaterialParameterVersion(input)
      : await updateMaterialParameterVersion(entity!.id, input)
    return result
  },
  onSuccess: () => list.refresh(),
})

const deleteAction = useConfirmedCrudAction<MaterialParameterVersion, unknown>({
  action: (row) => deleteMaterialParameterVersion(row.id),
  confirm: (row) => ({ title: '删除草稿', content: `确定删除材料参数版本 v${row.version}？仅草稿可删除。`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => list.refresh(),
})

const workflow = useWorkflowActions<MaterialParameterVersion>({
  entityName: '材料参数版本',
  run: (id, action) => runMaterialParameterVersionWorkflow(id, action).then((r) => r.item),
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

function materialName(id: string): string {
  return materialOptions.value.find((item) => item.value === id)?.label ?? id
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => materialName(row.materialId), colKey: 'materialId', minWidth: 180, title: '材料' },
  { cell: (_, { row }) => h(AppVersionMeta, { version: row.version, changeNote: row.changeNote }), colKey: 'version', minWidth: 130, title: '版本' },
  { cell: (_, { row }) => row.thermalConductivity, colKey: 'thermalConductivity', minWidth: 120, title: '导热系数 W/(m·K)' },
  { cell: (_, { row }) => row.density ?? '—', colKey: 'density', minWidth: 100, title: '密度 kg/m³' },
  { cell: (_, { row }) => row.combustionGrade ?? '—', colKey: 'combustionGrade', minWidth: 110, title: '燃烧等级' },
  { cell: (_, { row }) => h(AppStatusTag, mdReviewStatusMetaFor(row.status)), colKey: 'status', title: '状态', width: 100 },
  createEvidenceColumn(200),
  { cell: (_, { row }) => formatDate(new Date(row.updatedAt)), colKey: 'updatedAt', minWidth: 160, title: '更新时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as MaterialParameterVersion
  const actions: AppTableAction[] = []
  const label = `${materialName(entity.materialId)} v${entity.version}`
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

onMounted(loadMaterialOptions)
</script>

<template>
  <AppPage title="材料参数版本" description="材料导热系数等确定性计算唯一参数源；同材料仅一个已发布版本，热工计算只引用已发布参数。">
    <template #search>
      <AppSearchPanel :loading="list.isLoading.value" @reset="list.reset" @search="list.search">
        <t-form-item label="材料">
          <t-select
            v-model="list.query.materialId"
            :loading="materialLoading"
            :options="materialOptions"
            clearable
            filterable
            placeholder="全部材料"
          />
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
      empty-description="可新增第一个材料参数版本"
      empty-title="暂无材料参数版本"
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
          新增参数版本
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
      :title="drawer.mode.value === 'create' ? '新增材料参数版本' : '编辑材料参数版本'"
      :visible="drawer.visible.value"
      :width="'min(760px, 92vw)'"
      @cancel="drawer.close"
      @submit="drawer.submit"
      @update:visible="drawer.setVisible"
    >
      <t-form-item class="vicp-form-wide" label="材料" name="materialId" required-mark>
        <t-select
          v-model="drawer.formData.materialId"
          :loading="materialLoading"
          :options="materialOptions"
          filterable
          placeholder="请选择材料"
        />
      </t-form-item>
      <t-form-item label="导热系数 W/(m·K)" name="thermalConductivity" required-mark>
        <t-input-number v-model="drawer.formData.thermalConductivity" :min="0" :precision="4" :step="0.001" />
      </t-form-item>
      <t-form-item label="修正系数" name="correctionFactor">
        <t-input-number v-model="drawer.formData.correctionFactor" :min="0" :precision="3" :step="0.01" placeholder="选填" />
      </t-form-item>
      <t-form-item label="密度 kg/m³" name="density">
        <t-input-number v-model="drawer.formData.density" :min="0" :precision="1" placeholder="选填" />
      </t-form-item>
      <t-form-item label="抗压强度 kPa" name="compressiveStrength">
        <t-input-number v-model="drawer.formData.compressiveStrength" :min="0" :precision="1" placeholder="选填" />
      </t-form-item>
      <t-form-item label="粘结强度 MPa" name="bondStrength">
        <t-input-number v-model="drawer.formData.bondStrength" :min="0" :precision="3" :step="0.01" placeholder="选填" />
      </t-form-item>
      <t-form-item label="燃烧等级" name="combustionGrade">
        <t-input v-model="drawer.formData.combustionGrade" maxlength="40" placeholder="如：A2" />
      </t-form-item>
      <t-form-item label="适用标准" name="applicableStandard">
        <t-input v-model="drawer.formData.applicableStandard" maxlength="160" placeholder="选填" />
      </t-form-item>
      <t-form-item label="参数来源" name="source">
        <t-input v-model="drawer.formData.source" maxlength="200" placeholder="如：型式检验报告编号" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="允许用途" name="allowedUsage">
        <t-select
          v-model="drawer.formData.allowedUsage"
          :options="[]"
          allow-create
          clearable
          multiple
          placeholder="输入后回车创建，如：外墙外保温"
        />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="适用范围" name="applicableScope">
        <t-input v-model="drawer.formData.applicableScope" maxlength="500" placeholder="选填" />
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
.vicp-form-wide {
  grid-column: 1 / -1;
}
</style>
<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, reactive } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppVersionMeta from '@/components/business/AppVersionMeta.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { useCrudDrawer } from '@/composables/useCrudDrawer'
import { useCrudList } from '@/composables/useCrudList'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { useWorkflowActions, workflowActionsForStatus } from '@/composables/useWorkflowActions'
import {
  createThermalCalcRule,
  deleteThermalCalcRule,
  fetchThermalCalcRules,
  runThermalCalcRuleWorkflow,
  updateThermalCalcRule,
  validateThermalCalcRule,
} from '@/api/modules/thermal'
import type { AppTableAction } from '@/types/crud'
import type { ThermalCalcRule, ThermalCalcRuleInput, ThermalCalcRuleQuery } from '@/types/thermal'
import type { ValidationResult } from '@/types/thermal'
import { formatDate } from '@/utils/day'
import { evidenceLevelLabels, mdReviewStatusMetaFor } from '@/utils/professional-status'

const { canAccess } = usePermissionAccess()
const canAdd = computed(() => canAccess({ permissions: ['system:thermal:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:thermal:edit'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:thermal:remove'] }))
const canApprove = computed(() => canAccess({ permissions: ['system:thermal:approve'] }))
const canPublish = computed(() => canAccess({ permissions: ['system:thermal:publish'] }))
const canList = computed(() => canAccess({ permissions: ['system:thermal:list'] }))

const feedback = useAppFeedback()

const list = useCrudList<ThermalCalcRule, ThermalCalcRuleQuery>({
  createQuery: () => ({ page: 1, pageSize: 20, keyword: '', status: '' }),
  fetcher: ({ query, page, pageSize, signal }) =>
    fetchThermalCalcRules({ ...query, page, pageSize, status: !query.status || query.status === 'all' ? undefined : query.status } as ThermalCalcRuleQuery, signal),
  immediate: true,
  rowKey: 'id',
})

const roundingModeOptions = [
  { label: '四舍五入', value: 'HALF_UP' },
  { label: '银行家舍入', value: 'HALF_EVEN' },
  { label: '直接截断', value: 'TRUNCATE' },
  { label: '不处理', value: 'NONE' },
]

const compareFieldOptions = [
  { label: '传热系数 K', value: 'K_VALUE' },
  { label: '总热阻', value: 'TOTAL_RESISTANCE' },
]

const compareOperatorOptions = [
  { label: '≤（不超过限值）', value: 'LTE' },
  { label: '≥（不低于限值）', value: 'GTE' },
]

const drawer = useCrudDrawer<ThermalCalcRuleInput, ThermalCalcRule>({
  createForm: () => ({
    code: '',
    name: '',
    formulaVersion: '',
    interiorSurfaceResistance: 0.115,
    exteriorSurfaceResistance: 0.043,
    precision: 4,
    roundingMode: 'HALF_UP',
    compareField: 'K_VALUE',
    compareOperator: 'LTE',
    includeNonProductLayers: true,
    includeSurfaceResistances: true,
    parameterCodes: { equivalentConductivity: '', correctionFactor: '' },
    paramSourcePriority: [],
    usage: '',
    applicableScope: '',
    changeNote: '',
    evidenceSource: '',
    evidenceRef: '',
    evidenceLevel: undefined,
  }),
  editForm: (entity) => ({
    code: entity.code,
    name: entity.name,
    formulaVersion: entity.formulaVersion,
    interiorSurfaceResistance: entity.interiorSurfaceResistance,
    exteriorSurfaceResistance: entity.exteriorSurfaceResistance,
    precision: entity.precision,
    roundingMode: entity.roundingMode,
    compareField: entity.compareField,
    compareOperator: entity.compareOperator,
    includeNonProductLayers: entity.includeNonProductLayers,
    includeSurfaceResistances: entity.includeSurfaceResistances,
    parameterCodes: { ...entity.parameterCodes },
    paramSourcePriority: [...entity.paramSourcePriority],
    usage: entity.usage ?? '',
    applicableScope: entity.applicableScope ?? '',
    changeNote: '',
    evidenceSource: entity.evidenceSource ?? '',
    evidenceRef: entity.evidenceRef ?? '',
    evidenceLevel: entity.evidenceLevel ?? undefined,
  }),
  submit: async ({ mode, data, entity }) => {
    const input = {
      ...data,
      usage: data.usage || undefined,
      applicableScope: data.applicableScope || undefined,
      changeNote: data.changeNote || undefined,
      evidenceSource: data.evidenceSource || undefined,
      evidenceRef: data.evidenceRef || undefined,
      evidenceLevel: data.evidenceLevel ?? undefined,
    }
    const result = mode === 'create'
      ? await createThermalCalcRule(input)
      : await updateThermalCalcRule(entity!.id, input)
    return result
  },
  onSuccess: () => list.refresh(),
})

const deleteAction = useConfirmedCrudAction<ThermalCalcRule, unknown>({
  action: (row) => deleteThermalCalcRule(row.id),
  confirm: (row) => ({ title: '删除草稿', content: `确定删除「${row.name}」？仅草稿可删除。`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => list.refresh(),
})

const workflow = useWorkflowActions<ThermalCalcRule>({
  entityName: '计算规则',
  run: (id, action) => runThermalCalcRuleWorkflow(id, action).then((r) => r.item),
  onSuccess: () => list.refresh(),
})

const validateState = reactive({
  label: '',
  loading: false,
  result: null as ValidationResult | null,
  visible: false,
})

async function runValidate(entity: ThermalCalcRule): Promise<void> {
  validateState.label = entity.name
  validateState.loading = true
  validateState.result = null
  validateState.visible = true
  try {
    const result = await validateThermalCalcRule(entity.id)
    validateState.result = result
    if (result.valid) {
      await feedback.message('success', `「${entity.name}」规则校验通过`)
    }
  }
  catch (error) {
    validateState.visible = false
    await feedback.messageError(error)
  }
  finally {
    validateState.loading = false
  }
}

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
    h('div', { class: 'vicp-rule-name' }, row.name),
    h('div', { class: 'vicp-rule-meta' }, `${row.code} · 公式 ${row.formulaVersion}`),
  ]), colKey: 'name', minWidth: 240, title: '规则名称' },
  { cell: (_, { row }) => `${row.compareField === 'K_VALUE' ? 'K' : '总热阻'} ${row.compareOperator === 'LTE' ? '≤' : '≥'} 限值`, colKey: 'compareField', minWidth: 130, title: '比较口径' },
  { cell: (_, { row }) => `内 ${row.interiorSurfaceResistance} / 外 ${row.exteriorSurfaceResistance}`, colKey: 'interiorSurfaceResistance', minWidth: 160, title: '表面热阻' },
  { cell: (_, { row }) => h(AppVersionMeta, { version: row.version, changeNote: row.changeNote }), colKey: 'version', minWidth: 130, title: '版本' },
  { cell: (_, { row }) => h(AppStatusTag, mdReviewStatusMetaFor(row.status)), colKey: 'status', title: '状态', width: 100 },
  { cell: (_, { row }) => formatDate(new Date(row.updatedAt)), colKey: 'updatedAt', minWidth: 160, title: '更新时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as ThermalCalcRule
  const actions: AppTableAction[] = []
  const available = workflowActionsForStatus(entity.status)

  if (canEdit.value && (entity.status === 'DRAFT' || entity.status === 'REJECTED')) {
    actions.push({ key: 'edit', label: '编辑', handler: () => drawer.openEdit(entity) })
  }
  if (canList.value && (entity.status === 'DRAFT' || entity.status === 'REJECTED')) {
    actions.push({ key: 'validate', label: '校验', handler: () => void runValidate(entity) })
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
  <AppPage title="计算规则" description="图集无结果且规则已审核通过时允许计算；规则版本化审核发布，历史计算结果始终引用当时的规则版本，不随后台修改变化。">
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
      empty-description="可新增第一条计算规则"
      empty-title="暂无计算规则"
      :error-description="errorDescription"
      :operations-width="280"
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
          新增计算规则
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" :max-visible="3" />
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      :columns="2"
      :form-data="drawer.formData"
      :mode="drawer.mode.value"
      :submitting="drawer.isSubmitting.value"
      :title="drawer.mode.value === 'create' ? '新增计算规则' : '编辑计算规则'"
      :visible="drawer.visible.value"
      :width="'min(800px, 94vw)'"
      @cancel="drawer.close"
      @submit="drawer.submit"
      @update:visible="drawer.setVisible"
    >
      <t-form-item label="规则编码" name="code" required-mark>
        <t-input v-model="drawer.formData.code" maxlength="80" placeholder="唯一逻辑键" />
      </t-form-item>
      <t-form-item label="规则名称" name="name" required-mark>
        <t-input v-model="drawer.formData.name" maxlength="160" placeholder="请输入规则名称" />
      </t-form-item>
      <t-form-item label="公式版本" name="formulaVersion" required-mark>
        <t-input v-model="drawer.formData.formulaVersion" maxlength="40" placeholder="如：GB50176-2016" />
      </t-form-item>
      <t-form-item label="内表面热阻" name="interiorSurfaceResistance" required-mark>
        <t-input-number v-model="drawer.formData.interiorSurfaceResistance" :min="0" :precision="3" :step="0.001" />
      </t-form-item>
      <t-form-item label="外表面热阻" name="exteriorSurfaceResistance" required-mark>
        <t-input-number v-model="drawer.formData.exteriorSurfaceResistance" :min="0" :precision="3" :step="0.001" />
      </t-form-item>
      <t-form-item label="计算精度（小数位）" name="precision">
        <t-input-number v-model="drawer.formData.precision" :max="8" :min="0" />
      </t-form-item>
      <t-form-item label="舍入方式" name="roundingMode">
        <t-select v-model="drawer.formData.roundingMode" :options="roundingModeOptions" />
      </t-form-item>
      <t-form-item label="比较字段" name="compareField">
        <t-select v-model="drawer.formData.compareField" :options="compareFieldOptions" />
      </t-form-item>
      <t-form-item label="比较操作符" name="compareOperator">
        <t-select v-model="drawer.formData.compareOperator" :options="compareOperatorOptions" />
      </t-form-item>
      <t-form-item label="含非产品层" name="includeNonProductLayers">
        <t-switch v-model="drawer.formData.includeNonProductLayers" />
      </t-form-item>
      <t-form-item label="含表面热阻" name="includeSurfaceResistances">
        <t-switch v-model="drawer.formData.includeSurfaceResistances" />
      </t-form-item>
      <t-form-item label="导热系数参数码" name="parameterCodes.equivalentConductivity" required-mark>
        <t-input v-model="drawer.formData.parameterCodes.equivalentConductivity" maxlength="80" placeholder="如：LAMBDA" />
      </t-form-item>
      <t-form-item label="修正系数参数码" name="parameterCodes.correctionFactor" required-mark>
        <t-input v-model="drawer.formData.parameterCodes.correctionFactor" maxlength="80" placeholder="如：CORRECTION" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="参数来源优先级" name="paramSourcePriority">
        <t-select
          v-model="drawer.formData.paramSourcePriority"
          :options="[]"
          allow-create
          clearable
          multiple
          placeholder="输入后回车创建，如：DETECTION、ATLAS"
        />
      </t-form-item>
      <t-form-item label="用途" name="usage">
        <t-input v-model="drawer.formData.usage" maxlength="40" placeholder="如：住宅、公建" />
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
        <t-input v-model="drawer.formData.evidenceSource" maxlength="500" placeholder="如：国标、技术规程" />
      </t-form-item>
      <t-form-item label="页码 / 条款" name="evidenceRef">
        <t-input v-model="drawer.formData.evidenceRef" maxlength="120" placeholder="选填" />
      </t-form-item>
      <t-form-item v-if="drawer.mode.value === 'edit'" label="变更说明" name="changeNote">
        <t-input v-model="drawer.formData.changeNote" maxlength="2000" placeholder="本次修改内容（可选）" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="适用范围" name="applicableScope">
        <t-textarea v-model="drawer.formData.applicableScope" :autosize="{ minRows: 2, maxRows: 4 }" maxlength="4000" placeholder="选填" />
      </t-form-item>
    </AppCrudFormDialog>

    <t-dialog :footer="false" :header="`规则校验 · ${validateState.label}`" :visible="validateState.visible" @close="validateState.visible = false">
      <t-loading :loading="validateState.loading">
        <template v-if="validateState.result">
          <t-alert
            v-if="validateState.result.valid"
            class="vicp-validate-alert"
            message="规则配置完整，可以提交审核或发布。"
            theme="success"
          />
          <t-alert
            v-else
            class="vicp-validate-alert"
            message="发现以下问题，请修正后重试。"
            theme="error"
          />
          <ul v-if="validateState.result.violations.length > 0" class="vicp-validate-list">
            <li v-for="(item, index) in validateState.result.violations" :key="index">
              <span class="vicp-validate-field">{{ item.field }}</span>
              {{ item.message }}
            </li>
          </ul>
        </template>
      </t-loading>
    </t-dialog>

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
.vicp-rule-name {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-rule-meta {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-form-wide {
  grid-column: 1 / -1;
}
.vicp-validate-alert {
  margin-bottom: var(--td-size-4);
}
.vicp-validate-list {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-2);
  margin: 0;
  padding: 0 0 0 var(--td-size-5);
  color: var(--td-text-color-primary);
}
.vicp-validate-field {
  color: var(--td-error-color);
  font-family: var(--td-font-family-mono);
}
</style>
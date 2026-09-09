<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, reactive, ref } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppVersionMeta from '@/components/business/AppVersionMeta.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { useCrudDrawer } from '@/composables/useCrudDrawer'
import { useCrudList } from '@/composables/useCrudList'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { useWorkflowActions, workflowActionsForStatus } from '@/composables/useWorkflowActions'
import {
  createConstructionScheme,
  deleteConstructionScheme,
  fetchConstructionSchemes,
  fetchInsulationSystems,
  runConstructionSchemeWorkflow,
  updateConstructionScheme,
  validateConstructionScheme,
} from '@/api/modules/construction'
import type { AppTableAction } from '@/types/crud'
import type { ConstructionScheme, ConstructionSchemeInput, ConstructionSchemeQuery, ValidationResult } from '@/types/construction'
import { formatDate } from '@/utils/day'
import { evidenceLevelLabels, mdReviewStatusMetaFor } from '@/utils/professional-status'

/** 构造方案面板：候选匹配核心；提交审核与发布前强制结构校验。 */
const { canAccess } = usePermissionAccess()
const canAdd = computed(() => canAccess({ permissions: ['system:construction:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:construction:edit'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:construction:remove'] }))
const canApprove = computed(() => canAccess({ permissions: ['system:construction:approve'] }))
const canPublish = computed(() => canAccess({ permissions: ['system:construction:publish'] }))
const canList = computed(() => canAccess({ permissions: ['system:construction:list'] }))

const feedback = useAppFeedback()
const systemOptions = ref<Array<{ label: string, value: string }>>([])
const systemLoading = ref(false)

async function loadSystemOptions(): Promise<void> {
  systemLoading.value = true
  try {
    const result = await fetchInsulationSystems({ page: 1, pageSize: 100 })
    systemOptions.value = result.items.map((item) => ({ label: `${item.name}（${item.code}）`, value: item.id }))
  }
  finally {
    systemLoading.value = false
  }
}

const list = useCrudList<ConstructionScheme, ConstructionSchemeQuery>({
  createQuery: () => ({ page: 1, pageSize: 20, keyword: '', status: '', systemId: '', schemeCode: '' }),
  fetcher: ({ query, page, pageSize, signal }) =>
    fetchConstructionSchemes({ ...query, page, pageSize, status: !query.status || query.status === 'all' ? undefined : query.status } as ConstructionSchemeQuery, signal),
  immediate: true,
  rowKey: 'id',
})

const drawer = useCrudDrawer<ConstructionSchemeInput, ConstructionScheme>({
  createForm: () => ({
    systemId: '',
    schemeCode: '',
    name: '',
    substrateMaterial: '',
    substrateThickness: undefined,
    drawingFileId: '',
    atlasPage: '',
    changeNote: '',
    evidenceSource: '',
    evidenceRef: '',
    evidenceLevel: undefined,
  }),
  editForm: (entity) => ({
    systemId: entity.systemId,
    schemeCode: entity.schemeCode,
    name: entity.name,
    substrateMaterial: entity.substrateMaterial,
    substrateThickness: entity.substrateThickness ?? undefined,
    drawingFileId: entity.drawingFileId ?? '',
    atlasPage: entity.atlasPage ?? '',
    changeNote: '',
    evidenceSource: entity.evidenceSource ?? '',
    evidenceRef: entity.evidenceRef ?? '',
    evidenceLevel: entity.evidenceLevel ?? undefined,
  }),
  submit: async ({ mode, data, entity }) => {
    const input = {
      ...data,
      substrateThickness: data.substrateThickness ?? undefined,
      drawingFileId: data.drawingFileId || undefined,
      atlasPage: data.atlasPage || undefined,
      changeNote: data.changeNote || undefined,
      evidenceSource: data.evidenceSource || undefined,
      evidenceRef: data.evidenceRef || undefined,
      evidenceLevel: data.evidenceLevel ?? undefined,
    }
    const result = mode === 'create'
      ? await createConstructionScheme(input)
      : await updateConstructionScheme(entity!.id, input)
    return result
  },
  onSuccess: () => list.refresh(),
})

const deleteAction = useConfirmedCrudAction<ConstructionScheme, unknown>({
  action: (row) => deleteConstructionScheme(row.id),
  confirm: (row) => ({ title: '删除草稿', content: `确定删除「${row.name}」？仅草稿可删除。`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => list.refresh(),
})

const workflow = useWorkflowActions<ConstructionScheme>({
  entityName: '构造方案',
  run: (id, action) => runConstructionSchemeWorkflow(id, action).then((r) => r.item),
  onSuccess: () => list.refresh(),
})

// ---- 结构校验（提交/发布前显式校验，violations 逐条展示） ----

const validateState = reactive({
  label: '',
  loading: false,
  result: null as ValidationResult | null,
  visible: false,
})

async function runValidate(entity: ConstructionScheme): Promise<void> {
  validateState.label = entity.name
  validateState.loading = true
  validateState.result = null
  validateState.visible = true
  try {
    const result = await validateConstructionScheme(entity.id)
    validateState.result = result
    if (result.valid) {
      await feedback.message('success', `「${entity.name}」结构校验通过`)
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

function systemName(id: string): string {
  return systemOptions.value.find((item) => item.value === id)?.label ?? id
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => h('div', [
    h('div', { class: 'vicp-scheme-name' }, row.name),
    h('div', { class: 'vicp-scheme-meta' }, `${row.schemeCode} · ${systemName(row.systemId)}`),
  ]), colKey: 'name', minWidth: 240, title: '方案名称' },
  { cell: (_, { row }) => row.substrateMaterial, colKey: 'substrateMaterial', minWidth: 160, title: '基层材料' },
  { cell: (_, { row }) => (row.substrateThickness == null ? '—' : `${row.substrateThickness} mm`), colKey: 'substrateThickness', minWidth: 100, title: '基层厚度' },
  { cell: (_, { row }) => row.atlasPage ?? '—', colKey: 'atlasPage', minWidth: 100, title: '图集页码' },
  { cell: (_, { row }) => h(AppVersionMeta, { version: row.version, changeNote: row.changeNote }), colKey: 'version', minWidth: 130, title: '版本' },
  { cell: (_, { row }) => h(AppStatusTag, mdReviewStatusMetaFor(row.status)), colKey: 'status', title: '状态', width: 100 },
  { cell: (_, { row }) => formatDate(new Date(row.updatedAt)), colKey: 'updatedAt', minWidth: 160, title: '更新时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as ConstructionScheme
  const actions: AppTableAction[] = []
  const label = `${entity.schemeCode} · ${entity.name}`
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

onMounted(loadSystemOptions)
</script>

<template>
  <div class="vicp-scheme-panel">
    <AppSearchPanel :loading="list.isLoading.value" @reset="list.reset" @search="list.search">
      <t-form-item label="关键词">
        <t-input v-model="list.query.keyword" clearable placeholder="方案名称" />
      </t-form-item>
      <t-form-item label="保温系统">
        <t-select
          v-model="list.query.systemId"
          :loading="systemLoading"
          :options="systemOptions"
          clearable
          filterable
          placeholder="全部系统"
        />
      </t-form-item>
      <t-form-item label="方案编码">
        <t-input v-model="list.query.schemeCode" clearable placeholder="精确匹配" />
      </t-form-item>
      <t-form-item label="状态">
        <t-select v-model="list.query.status" :options="statusOptions" />
      </t-form-item>
    </AppSearchPanel>

    <AppDataTable
      :columns="columns"
      :current="list.current.value"
      :data="list.data.value"
      empty-description="可新增第一个构造方案"
      empty-title="暂无构造方案"
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
          新增构造方案
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
      :title="drawer.mode.value === 'create' ? '新增构造方案' : '编辑构造方案'"
      :visible="drawer.visible.value"
      :width="'min(760px, 92vw)'"
      @cancel="drawer.close"
      @submit="drawer.submit"
      @update:visible="drawer.setVisible"
    >
      <t-form-item class="vicp-form-wide" label="保温系统" name="systemId" required-mark>
        <t-select
          v-model="drawer.formData.systemId"
          :loading="systemLoading"
          :options="systemOptions"
          filterable
          placeholder="请选择保温系统"
        />
      </t-form-item>
      <t-form-item label="方案编码" name="schemeCode" required-mark>
        <t-input v-model="drawer.formData.schemeCode" maxlength="40" placeholder="唯一逻辑键（系统内）" />
      </t-form-item>
      <t-form-item label="方案名称" name="name" required-mark>
        <t-input v-model="drawer.formData.name" maxlength="160" placeholder="请输入方案名称" />
      </t-form-item>
      <t-form-item label="基层材料" name="substrateMaterial" required-mark>
        <t-input v-model="drawer.formData.substrateMaterial" maxlength="120" placeholder="如：钢筋混凝土" />
      </t-form-item>
      <t-form-item label="基层厚度 mm" name="substrateThickness">
        <t-input-number v-model="drawer.formData.substrateThickness" :min="0" :precision="1" placeholder="选填" />
      </t-form-item>
      <t-form-item label="图集页码" name="atlasPage">
        <t-input v-model="drawer.formData.atlasPage" maxlength="40" placeholder="选填" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="图纸文件 ID" name="drawingFileId">
        <t-input v-model="drawer.formData.drawingFileId" maxlength="80" placeholder="选填，上传后回填" />
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
        <t-input v-model="drawer.formData.evidenceSource" maxlength="500" placeholder="如：图集、系统认定" />
      </t-form-item>
      <t-form-item label="页码 / 条款" name="evidenceRef">
        <t-input v-model="drawer.formData.evidenceRef" maxlength="120" placeholder="选填" />
      </t-form-item>
      <t-form-item v-if="drawer.mode.value === 'edit'" label="变更说明" name="changeNote">
        <t-input v-model="drawer.formData.changeNote" maxlength="2000" placeholder="本次修改内容（可选）" />
      </t-form-item>
    </AppCrudFormDialog>

    <!-- 结构校验结果 -->
    <t-dialog :footer="false" :header="`结构校验 · ${validateState.label}`" :visible="validateState.visible" @close="validateState.visible = false">
      <t-loading :loading="validateState.loading">
        <template v-if="validateState.result">
          <t-alert
            v-if="validateState.result.valid"
            class="vicp-validate-alert"
            message="结构配置完整，可以提交审核或发布。"
            theme="success"
          />
          <t-alert
            v-else
            class="vicp-validate-alert"
            message="发现以下结构问题，请修正后重试。"
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
  </div>
</template>

<style scoped>
.vicp-scheme-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--vicp-page-gap);
  min-height: 0;
}
.vicp-scheme-name {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-scheme-meta {
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

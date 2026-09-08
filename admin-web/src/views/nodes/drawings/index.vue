<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, reactive, ref } from 'vue'
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
import { fetchInsulationSystems } from '@/api/modules/construction'
import {
  createNodeDrawing,
  deleteNodeDrawing,
  fetchNodeDrawings,
  runNodeDrawingWorkflow,
  updateNodeDrawing,
  validateNodeDrawing,
} from '@/api/modules/nodes'
import type { AppTableAction } from '@/types/crud'
import type { NodeDrawing, NodeDrawingInput, NodeDrawingQuery } from '@/types/nodes'
import type { ValidationResult } from '@/types/nodes'
import { formatDate } from '@/utils/day'
import { evidenceLevelLabels, mdReviewStatusMetaFor } from '@/utils/professional-status'

const { canAccess } = usePermissionAccess()
const canAdd = computed(() => canAccess({ permissions: ['system:node:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:node:edit'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:node:remove'] }))
const canApprove = computed(() => canAccess({ permissions: ['system:node:approve'] }))
const canPublish = computed(() => canAccess({ permissions: ['system:node:publish'] }))
const canList = computed(() => canAccess({ permissions: ['system:node:list'] }))

const feedback = useAppFeedback()
const systemOptions = ref<Array<{ label: string; value: string }>>([])
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

const list = useCrudList<NodeDrawing, NodeDrawingQuery>({
  createQuery: () => ({ page: 1, pageSize: 20, keyword: '', status: '', systemId: '', position: '' }),
  fetcher: ({ query, page, pageSize, signal }) =>
    fetchNodeDrawings({ ...query, page, pageSize, status: !query.status || query.status === 'all' ? undefined : query.status } as NodeDrawingQuery, signal),
  immediate: true,
  rowKey: 'id',
})

const drawer = useCrudDrawer<NodeDrawingInput, NodeDrawing>({
  createForm: () => ({
    code: '',
    name: '',
    position: '',
    systemId: '',
    atlasPage: '',
    imageFileId: '',
    cadFileId: '',
    description: '',
    changeNote: '',
    evidenceSource: '',
    evidenceRef: '',
    evidenceLevel: undefined,
  }),
  editForm: (entity) => ({
    code: entity.code,
    name: entity.name,
    position: entity.position,
    systemId: entity.systemId ?? '',
    atlasPage: entity.atlasPage ?? '',
    imageFileId: entity.imageFileId ?? '',
    cadFileId: entity.cadFileId ?? '',
    description: entity.description ?? '',
    changeNote: '',
    evidenceSource: entity.evidenceSource ?? '',
    evidenceRef: entity.evidenceRef ?? '',
    evidenceLevel: entity.evidenceLevel ?? undefined,
  }),
  submit: async ({ mode, data, entity }) => {
    const input = {
      ...data,
      systemId: data.systemId || undefined,
      atlasPage: data.atlasPage || undefined,
      imageFileId: data.imageFileId || undefined,
      cadFileId: data.cadFileId || undefined,
      description: data.description || undefined,
      changeNote: data.changeNote || undefined,
      evidenceSource: data.evidenceSource || undefined,
      evidenceRef: data.evidenceRef || undefined,
      evidenceLevel: data.evidenceLevel ?? undefined,
    }
    const result = mode === 'create'
      ? await createNodeDrawing(input)
      : await updateNodeDrawing(entity!.id, input)
    return result
  },
  onSuccess: () => list.refresh(),
})

const deleteAction = useConfirmedCrudAction<NodeDrawing, unknown>({
  action: (row) => deleteNodeDrawing(row.id),
  confirm: (row) => ({ title: '删除草稿', content: `确定删除「${row.name}」？仅草稿可删除。`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => list.refresh(),
})

const workflow = useWorkflowActions<NodeDrawing>({
  entityName: '节点图',
  run: (id, action) => runNodeDrawingWorkflow(id, action).then((r) => r.item),
  onSuccess: () => list.refresh(),
})

const validateState = reactive({
  label: '',
  loading: false,
  result: null as ValidationResult | null,
  visible: false,
})

async function runValidate(entity: NodeDrawing): Promise<void> {
  validateState.label = entity.name
  validateState.loading = true
  validateState.result = null
  validateState.visible = true
  try {
    const result = await validateNodeDrawing(entity.id)
    validateState.result = result
    if (result.valid) {
      await feedback.message('success', `「${entity.name}」节点图校验通过`)
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
    h('div', { class: 'vicp-node-name' }, row.name),
    h('div', { class: 'vicp-node-meta' }, `${row.code} · ${row.position}`),
  ]), colKey: 'name', minWidth: 240, title: '节点名称' },
  { cell: (_, { row }) => row.systemId ? systemName(row.systemId) : '—', colKey: 'systemId', minWidth: 180, title: '保温系统' },
  { cell: (_, { row }) => row.atlasPage ?? '—', colKey: 'atlasPage', minWidth: 100, title: '图集页码' },
  { cell: (_, { row }) => h(AppVersionMeta, { version: row.version, changeNote: row.changeNote }), colKey: 'version', minWidth: 130, title: '版本' },
  { cell: (_, { row }) => h(AppStatusTag, mdReviewStatusMetaFor(row.status)), colKey: 'status', title: '状态', width: 100 },
  { cell: (_, { row }) => formatDate(new Date(row.updatedAt)), colKey: 'updatedAt', minWidth: 160, title: '更新时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as NodeDrawing
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

onMounted(loadSystemOptions)
</script>

<template>
  <AppPage title="节点图库" description="节点大样图（含 CAD/图片文件与方案关联）；版本化审核发布，节点-方案关联随节点版本复制。">
    <template #search>
      <AppSearchPanel :loading="list.isLoading.value" @reset="list.reset" @search="list.search">
        <t-form-item label="关键词">
          <t-input v-model="list.query.keyword" clearable placeholder="名称 / 编码" />
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
        <t-form-item label="部位">
          <t-input v-model="list.query.position" clearable placeholder="如：外墙勒脚" />
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
      empty-description="可新增第一个节点图"
      empty-title="暂无节点图"
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
          新增节点图
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
      :title="drawer.mode.value === 'create' ? '新增节点图' : '编辑节点图'"
      :visible="drawer.visible.value"
      :width="'min(760px, 92vw)'"
      @cancel="drawer.close"
      @submit="drawer.submit"
      @update:visible="drawer.setVisible"
    >
      <t-form-item label="节点编码" name="code" required-mark>
        <t-input v-model="drawer.formData.code" maxlength="80" placeholder="唯一逻辑键" />
      </t-form-item>
      <t-form-item label="节点名称" name="name" required-mark>
        <t-input v-model="drawer.formData.name" maxlength="160" placeholder="请输入节点名称" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="部位" name="position" required-mark>
        <t-input v-model="drawer.formData.position" maxlength="120" placeholder="如：外墙勒脚、窗台" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="保温系统" name="systemId">
        <t-select
          v-model="drawer.formData.systemId"
          :loading="systemLoading"
          :options="systemOptions"
          clearable
          filterable
          placeholder="选填"
        />
      </t-form-item>
      <t-form-item label="图集页码" name="atlasPage">
        <t-input v-model="drawer.formData.atlasPage" maxlength="40" placeholder="选填" />
      </t-form-item>
      <t-form-item label="图片文件 ID" name="imageFileId">
        <t-input v-model="drawer.formData.imageFileId" maxlength="80" placeholder="选填，上传后回填" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="CAD 文件 ID" name="cadFileId">
        <t-input v-model="drawer.formData.cadFileId" maxlength="80" placeholder="选填，上传后回填" />
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
        <t-input v-model="drawer.formData.evidenceSource" maxlength="500" placeholder="如：图集、设计院图纸" />
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

    <t-dialog :footer="false" :header="`节点图校验 · ${validateState.label}`" :visible="validateState.visible" @close="validateState.visible = false">
      <t-loading :loading="validateState.loading">
        <template v-if="validateState.result">
          <t-alert
            v-if="validateState.result.valid"
            class="vicp-validate-alert"
            message="节点图配置完整，可以提交审核或发布。"
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
.vicp-node-name {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-node-meta {
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
<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AppTableAction } from '@/types/crud'
import type { StandardDocument, StandardDocumentInput, StandardIndicatorInput } from '@/types/standard'
import { AddIcon, DeleteIcon } from 'tdesign-icons-vue-next'
import { computed, h, reactive, ref } from 'vue'
import {
  createStandardDocument,
  deleteStandardDocument,
  fetchStandardDocuments,
  runStandardDocumentWorkflow,
  updateStandardDocument,
} from '@/api/modules/standard'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { useWorkflowActions, workflowActionsForStatus } from '@/composables/useWorkflowActions'
import { formatDate } from '@/utils/day'
import { mdReviewStatusMetaFor } from '@/utils/professional-status'
import { standardVisibilityMeta } from '@/utils/standard-visibility'

const { canAccess } = usePermissionAccess()
const canAdd = computed(() => canAccess({ permissions: ['system:standard:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:standard:edit'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:standard:remove'] }))
const canApprove = computed(() => canAccess({ permissions: ['system:standard:approve'] }))
const canPublish = computed(() => canAccess({ permissions: ['system:standard:publish'] }))

// ---- 列表（后端返回纯数组，本地适配分页壳） ----

const list = reactive({
  data: [] as StandardDocument[],
  isLoading: false,
  error: null as unknown,
  query: reactive({ provinceCode: '', documentNo: '', standardStatus: '', reviewStatus: '', ingestType: '' }),
  async load(): Promise<void> {
    list.isLoading = true
    list.error = null
    try {
      list.data = await fetchStandardDocuments({
        provinceCode: list.query.provinceCode || undefined,
        documentNo: list.query.documentNo || undefined,
        standardStatus: list.query.standardStatus || undefined,
        reviewStatus: list.query.reviewStatus || undefined,
        ingestType: list.query.ingestType || undefined,
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

// ---- 表单状态 ----

const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const editingId = ref<string | null>(null)
const isSubmitting = ref(false)

function emptyIndicator(): StandardIndicatorInput {
  return {
    indicatorType: 'K_VALUE',
    indicatorName: '',
    value: 0,
    unit: '',
    evidenceRef: '',
    rawText: '',
  }
}

const form = reactive<{
  provinceCode: string
  provinceName: string
  documentNo: string
  title: string
  category: string
  standardStatus: string
  publishDate: string
  implementDate: string
  effectiveAt: string
  expiresAt: string
  originUrl: string
  evidenceSource: string
  indicators: StandardIndicatorInput[]
}>({
  provinceCode: '',
  provinceName: '',
  documentNo: '',
  title: '',
  category: '',
  standardStatus: 'OFFICIAL',
  publishDate: '',
  implementDate: '',
  effectiveAt: '',
  expiresAt: '',
  originUrl: '',
  evidenceSource: '',
  indicators: [emptyIndicator()],
})

function openCreate(): void {
  dialogMode.value = 'create'
  editingId.value = null
  Object.assign(form, {
    provinceCode: '',
    provinceName: '',
    documentNo: '',
    title: '',
    category: '',
    standardStatus: 'OFFICIAL',
    publishDate: '',
    implementDate: '',
    effectiveAt: '',
    expiresAt: '',
    originUrl: '',
    evidenceSource: '',
    indicators: [emptyIndicator()],
  })
  dialogVisible.value = true
}

function openEdit(entity: StandardDocument): void {
  dialogMode.value = 'edit'
  editingId.value = entity.id
  Object.assign(form, {
    provinceCode: entity.provinceCode,
    provinceName: entity.provinceName,
    documentNo: entity.documentNo,
    title: entity.title,
    category: entity.category ?? '',
    standardStatus: entity.standardStatus,
    publishDate: entity.publishDate ?? '',
    implementDate: entity.implementDate ?? '',
    effectiveAt: entity.effectiveAt ?? '',
    expiresAt: entity.expiresAt ?? '',
    originUrl: entity.originUrl ?? '',
    evidenceSource: '',
    indicators: [],
  })
  dialogVisible.value = true
}

function addIndicator(): void {
  form.indicators.push(emptyIndicator())
}

function removeIndicator(index: number): void {
  form.indicators.splice(index, 1)
}

const feedback = useAppFeedback()

async function submitForm(): Promise<void> {
  if (!form.title.trim() || !form.documentNo.trim() || !form.provinceCode.trim()) {
    await feedback.message('warning', '请填写文档编号、标题与省份')
    return
  }
  const validIndicators = form.indicators.filter(item => item.indicatorName.trim())
  if (validIndicators.length === 0) {
    await feedback.message('warning', '至少录入一条指标')
    return
  }
  if (validIndicators.some(item => !item.evidenceRef.trim())) {
    await feedback.message('warning', '每条指标必须填写条款引用')
    return
  }

  isSubmitting.value = true
  try {
    const input: StandardDocumentInput = {
      provinceCode: form.provinceCode.trim(),
      provinceName: form.provinceName.trim(),
      documentNo: form.documentNo.trim(),
      title: form.title.trim(),
      category: form.category || undefined,
      standardStatus: form.standardStatus as StandardDocumentInput['standardStatus'],
      publishDate: form.publishDate || undefined,
      implementDate: form.implementDate || undefined,
      effectiveAt: form.effectiveAt || undefined,
      expiresAt: form.expiresAt || undefined,
      originUrl: form.originUrl || undefined,
      evidenceSource: form.evidenceSource || undefined,
      indicators: validIndicators.map(item => ({
        ...item,
        unit: item.unit || undefined,
        rawText: item.rawText || undefined,
      })),
    }
    if (dialogMode.value === 'create') {
      await createStandardDocument(input)
    }
    else {
      await updateStandardDocument(editingId.value!, {
        title: input.title,
        category: input.category ?? undefined,
        standardStatus: input.standardStatus,
        publishDate: input.publishDate,
        implementDate: input.implementDate,
        effectiveAt: input.effectiveAt,
        expiresAt: input.expiresAt,
        originUrl: input.originUrl ?? undefined,
      })
    }
    dialogVisible.value = false
    await list.refresh()
  }
  catch (error) {
    await feedback.messageError(error)
  }
  finally {
    isSubmitting.value = false
  }
}

// ---- 工作流（标准文档：submit/approve/reject/publish，无 disable/new-version） ----

const ALLOWED = ['submit', 'approve', 'reject', 'publish']

const workflow = useWorkflowActions<StandardDocument>({
  entityName: '标准文档',
  run: (id, action) => {
    if (action.type === 'approve') {
      return runStandardDocumentWorkflow(id, 'approve', { approvalNote: action.approvalNote })
    }
    if (action.type === 'reject') {
      return runStandardDocumentWorkflow(id, 'reject', { rejectReason: action.rejectReason })
    }
    return runStandardDocumentWorkflow(id, action.type as 'submit' | 'publish')
  },
  onSuccess: () => list.refresh(),
})

const deleteAction = useConfirmedCrudAction<StandardDocument, unknown>({
  action: row => deleteStandardDocument(row.id),
  confirm: row => ({ title: '删除草稿', content: `确定删除「${row.title}」？仅草稿可删除。`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => list.refresh(),
})

const errorDescription = computed(() => list.error
  ? normalizeFeedbackError(list.error).message
  : '请检查网络连接后重试')

const standardStatusOptions = [
  { label: '全部效力', value: 'all' },
  { label: '征求意见稿', value: 'DRAFT_CONSULTATION' },
  { label: '现行有效', value: 'OFFICIAL' },
  { label: '已被替代', value: 'SUPERSEDED' },
  { label: '已废止', value: 'REPEALED' },
]

const reviewStatusOptions = [
  { label: '全部审核状态', value: 'all' },
  { label: '草稿', value: 'DRAFT' },
  { label: '待审核', value: 'PENDING_REVIEW' },
  { label: '已通过', value: 'APPROVED' },
  { label: '已发布', value: 'PUBLISHED' },
  { label: '已停用', value: 'DISABLED' },
  { label: '已驳回', value: 'REJECTED' },
]

const ingestTypeOptions = [
  { label: '全部来源', value: 'all' },
  { label: '抓取', value: 'CRAWL' },
  { label: '人工录入', value: 'MANUAL' },
]

const standardStatusLabels: Record<string, string> = {
  DRAFT_CONSULTATION: '征求意见稿',
  OFFICIAL: '现行有效',
  SUPERSEDED: '已被替代',
  REPEALED: '已废止',
}

const ingestTypeLabels: Record<string, string> = { CRAWL: '抓取', MANUAL: '人工录入' }

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => h('div', [
    h('div', { class: 'vicp-doc-title' }, row.title),
    h('div', { class: 'vicp-doc-no' }, `${row.documentNo} · ${row.provinceName}`),
  ]), colKey: 'title', minWidth: 300, title: '标准名称' },
  { cell: (_, { row }) => standardStatusLabels[row.standardStatus] ?? row.standardStatus, colKey: 'standardStatus', minWidth: 100, title: '效力' },
  { cell: (_, { row }) => ingestTypeLabels[row.ingestType] ?? row.ingestType, colKey: 'ingestType', minWidth: 90, title: '来源' },
  { cell: (_, { row }) => h(AppStatusTag, mdReviewStatusMetaFor(row.status)), colKey: 'status', minWidth: 100, title: '审核状态' },
  {
    cell: (_, { row }) => {
      const meta = standardVisibilityMeta(row.status as string)
      return h('div', { class: 'vicp-visibility' }, [
        h(AppStatusTag, { label: meta.visibility, status: meta.status }),
        h('div', { class: 'vicp-visibility__usage' }, meta.aiUsage),
      ])
    },
    colKey: 'visibility',
    minWidth: 160,
    title: '用户可见性',
  },
  { cell: (_, { row }) => row.effectiveAt ? formatDate(new Date(row.effectiveAt), 'YYYY-MM-DD') : '—', colKey: 'effectiveAt', minWidth: 110, title: '生效日期' },
  { cell: (_, { row }) => formatDate(new Date(row.createdAt), 'YYYY-MM-DD'), colKey: 'createdAt', minWidth: 110, title: '创建日期' },
]

// ---- 详情（数据来源 / 审核与发布时间 / 是否参与 AI 判定） ----

const detailVisible = ref(false)
const detailEntity = ref<StandardDocument | null>(null)

function openDetail(entity: StandardDocument): void {
  detailEntity.value = entity
  detailVisible.value = true
}

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as StandardDocument
  const actions: AppTableAction[] = []
  const available = workflowActionsForStatus(entity.status).filter(action => ALLOWED.includes(action))

  actions.push({ key: 'detail', label: '详情', handler: () => openDetail(entity) })

  if (canEdit.value && (entity.status === 'DRAFT' || entity.status === 'REJECTED')) {
    actions.push({ key: 'edit', label: '编辑', handler: () => openEdit(entity) })
  }
  if (canAdd.value && available.includes('submit')) {
    actions.push({
      key: 'submit',
      label: '提交审核',
      loading: workflow.submit.running.value,
      handler: () => workflow.submit.run({ id: entity.id, label: entity.title }),
    })
  }
  if (canApprove.value && available.includes('approve')) {
    actions.push({
      key: 'approve',
      label: '通过',
      loading: workflow.approveRunning.value,
      handler: () => workflow.openApprove({ id: entity.id, label: entity.title }),
    })
    actions.push({
      key: 'reject',
      label: '驳回',
      loading: workflow.rejectRunning.value,
      theme: 'danger',
      handler: () => workflow.openReject({ id: entity.id, label: entity.title }),
    })
  }
  if (canPublish.value && available.includes('publish')) {
    actions.push({
      key: 'publish',
      label: '发布',
      loading: workflow.publish.running.value,
      handler: () => workflow.publish.run({ id: entity.id, label: entity.title }),
    })
  }
  if (canRemove.value && entity.status === 'DRAFT') {
    actions.push({
      key: 'remove',
      label: '删除',
      loading: deleteAction.running.value,
      theme: 'danger',
      handler: () => deleteAction.run(entity),
    })
  }
  return actions
}
</script>

<template>
  <div class="vicp-standard-doc-panel">
    <AppSearchPanel :loading="list.isLoading" @reset="list.reset" @search="list.search">
      <t-form-item label="标准编号">
        <t-input v-model="list.query.documentNo" clearable placeholder="如：DB11/891" />
      </t-form-item>
      <t-form-item label="省份编码">
        <t-input v-model="list.query.provinceCode" clearable placeholder="如：110000" />
      </t-form-item>
      <t-form-item label="效力">
        <t-select v-model="list.query.standardStatus" :options="standardStatusOptions" />
      </t-form-item>
      <t-form-item label="审核状态">
        <t-select v-model="list.query.reviewStatus" :options="reviewStatusOptions" />
      </t-form-item>
      <template #advanced>
        <t-form-item label="录入来源">
          <t-select v-model="list.query.ingestType" :options="ingestTypeOptions" />
        </t-form-item>
      </template>
    </AppSearchPanel>

    <AppDataTable
      :columns="columns"
      :data="list.data"
      empty-description="可人工录入第一条标准"
      empty-title="暂无标准文档"
      :error-description="errorDescription"
      :operations-width="240"
      :show-pagination="false"
      row-key="id"
      :status="list.isLoading ? 'loading' : list.error ? 'error' : 'ready'"
      :total="list.data.length"
      @refresh="list.refresh"
      @retry="list.retry"
    >
      <template #toolbar>
        <t-button v-if="canAdd" theme="primary" @click="openCreate">
          <template #icon>
            <AddIcon />
          </template>
          人工录入标准
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      :columns="2"
      :form-data="form"
      :mode="dialogMode"
      :submitting="isSubmitting"
      :title="dialogMode === 'create' ? '人工录入标准' : '编辑标准文档'"
      :visible="dialogVisible"
      width="min(860px, 96vw)"
      @cancel="dialogVisible = false"
      @submit="submitForm"
      @update:visible="dialogVisible = $event"
    >
      <t-form-item label="省份编码" name="provinceCode">
        <t-input v-model="form.provinceCode" maxlength="40" placeholder="如：110000" />
      </t-form-item>
      <t-form-item label="省份名称" name="provinceName">
        <t-input v-model="form.provinceName" maxlength="120" placeholder="如：北京市" />
      </t-form-item>
      <t-form-item label="标准编号" name="documentNo">
        <t-input v-model="form.documentNo" maxlength="120" placeholder="如：DB11/891-2023" />
      </t-form-item>
      <t-form-item label="效力状态" name="standardStatus">
        <t-select
          v-model="form.standardStatus"
          :options="[
            { label: '征求意见稿', value: 'DRAFT_CONSULTATION' },
            { label: '现行有效', value: 'OFFICIAL' },
            { label: '已被替代', value: 'SUPERSEDED' },
            { label: '已废止', value: 'REPEALED' },
          ]"
        />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="标准名称" name="title">
        <t-input v-model="form.title" maxlength="300" placeholder="请输入标准名称" />
      </t-form-item>
      <t-form-item label="分类" name="category">
        <t-input v-model="form.category" maxlength="80" placeholder="如：节能设计" />
      </t-form-item>
      <t-form-item label="原文链接" name="originUrl">
        <t-input v-model="form.originUrl" maxlength="1000" placeholder="https://..." />
      </t-form-item>
      <t-form-item label="发布日期" name="publishDate">
        <t-date-picker v-model="form.publishDate" clearable placeholder="选填" />
      </t-form-item>
      <t-form-item label="实施日期" name="implementDate">
        <t-date-picker v-model="form.implementDate" clearable placeholder="选填" />
      </t-form-item>
      <t-form-item label="生效日期" name="effectiveAt">
        <t-date-picker v-model="form.effectiveAt" clearable placeholder="选填" />
      </t-form-item>
      <t-form-item label="失效日期" name="expiresAt">
        <t-date-picker v-model="form.expiresAt" clearable placeholder="选填" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="资料出处" name="evidenceSource">
        <t-input v-model="form.evidenceSource" maxlength="500" placeholder="如：省住建厅官网发布页" />
      </t-form-item>

      <div class="vicp-indicators vicp-form-wide">
        <div class="vicp-indicators__head">
          <span class="vicp-indicators__title">指标（至少 1 条，每条条款引用必填）</span>
          <t-button size="small" theme="primary" variant="outline" @click="addIndicator">
            添加指标
          </t-button>
        </div>
        <div v-for="(indicator, index) in form.indicators" :key="index" class="vicp-indicator-row">
          <t-form-item label="名称">
            <t-input v-model="indicator.indicatorName" maxlength="120" placeholder="如：传热系数 K" />
          </t-form-item>
          <t-form-item label="类型">
            <t-select
              v-model="indicator.indicatorType"
              :options="[
                { label: 'K 值', value: 'K_VALUE' },
                { label: '热阻', value: 'HEAT_RESISTANCE' },
                { label: '其他', value: 'OTHER' },
              ]"
            />
          </t-form-item>
          <t-form-item label="数值">
            <t-input-number v-model="indicator.value" :max="100000" :min="0" :precision="4" />
          </t-form-item>
          <t-form-item label="单位">
            <t-input v-model="indicator.unit" maxlength="40" placeholder="如：W/(m²·K)" />
          </t-form-item>
          <t-form-item label="条款引用">
            <t-input v-model="indicator.evidenceRef" maxlength="120" placeholder="必填，如：4.2.3" />
          </t-form-item>
          <t-form-item label="原文摘录">
            <t-input v-model="indicator.rawText" maxlength="4000" placeholder="选填" />
          </t-form-item>
          <t-button
            aria-label="删除该指标"
            class="vicp-indicator-row__remove"
            shape="square"
            size="small"
            theme="danger"
            variant="text"
            @click="removeIndicator(index)"
          >
            <template #icon>
              <DeleteIcon />
            </template>
          </t-button>
        </div>
      </div>
    </AppCrudFormDialog>

    <t-drawer
      :cancel-btn="{ content: '关闭' }"
      :footer="false"
      :header="detailEntity ? `标准详情 · ${detailEntity.title}` : '标准详情'"
      placement="right"
      size="min(560px, 100vw)"
      :visible="detailVisible"
      @close="detailVisible = false"
    >
      <t-descriptions v-if="detailEntity" bordered :column="1" size="medium">
        <t-descriptions-item label="标准名称">
          {{ detailEntity.title }}
        </t-descriptions-item>
        <t-descriptions-item label="标准编号">
          {{ detailEntity.documentNo }}
        </t-descriptions-item>
        <t-descriptions-item label="数据来源">
          {{ ingestTypeLabels[detailEntity.ingestType] ?? detailEntity.ingestType }}
          <template v-if="detailEntity.ingestType === 'CRAWL'">
            <span v-if="detailEntity.createdAt" class="vicp-detail-muted">（抓取入库于 {{ formatDate(new Date(detailEntity.createdAt)) }}）</span>
          </template>
        </t-descriptions-item>
        <t-descriptions-item label="提交审核">
          {{ detailEntity.submittedAt ? formatDate(new Date(detailEntity.submittedAt)) : '—' }}
        </t-descriptions-item>
        <t-descriptions-item label="审核时间">
          {{ detailEntity.approvedAt ? formatDate(new Date(detailEntity.approvedAt)) : '—' }}
        </t-descriptions-item>
        <t-descriptions-item label="发布时间">
          {{ detailEntity.publishedAt ? formatDate(new Date(detailEntity.publishedAt)) : '—' }}
        </t-descriptions-item>
        <t-descriptions-item label="用户可见性">
          <AppStatusTag
            :label="standardVisibilityMeta(detailEntity.status).visibility"
            :status="standardVisibilityMeta(detailEntity.status).status"
          />
        </t-descriptions-item>
        <t-descriptions-item label="参与 AI / 热工判定">
          {{ standardVisibilityMeta(detailEntity.status).aiUsage }}
        </t-descriptions-item>
        <t-descriptions-item label="原文链接">
          <t-link v-if="detailEntity.originUrl" :href="detailEntity.originUrl" target="_blank">
            查看官方来源
          </t-link>
          <span v-else>—</span>
        </t-descriptions-item>
      </t-descriptions>
    </t-drawer>

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
.vicp-standard-doc-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--vicp-page-gap);
  min-height: 0;
}
.vicp-doc-title {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-doc-no {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-visibility {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.vicp-visibility__usage {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-detail-muted {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-form-wide {
  grid-column: 1 / -1;
}
.vicp-indicators {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-3);
}
.vicp-indicators__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.vicp-indicators__title {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
  font-weight: var(--td-font-weight-medium);
}
.vicp-indicator-row {
  position: relative;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--td-size-3);
  padding: var(--td-size-4);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
}
.vicp-indicator-row__remove {
  position: absolute;
  top: var(--td-size-1);
  right: var(--td-size-1);
}
</style>

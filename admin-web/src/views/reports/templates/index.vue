<script setup lang="ts">
import type { PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon, DeleteIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, reactive, ref } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppEvidenceSource from '@/components/business/AppEvidenceSource.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { useCrudDrawer } from '@/composables/useCrudDrawer'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { useWorkflowActions, workflowActionsForStatus } from '@/composables/useWorkflowActions'
import {
  createReportTemplate,
  deleteReportTemplate,
  fetchReportTemplates,
  runReportTemplateWorkflow,
  updateReportTemplate,
  validateReportTemplate,
} from '@/api/modules/report-center'
import type { AppTableAction } from '@/types/crud'
import {
  reportSectionKeys,
  type ReportSection,
  type ReportSectionKey,
  type ReportTemplate,
  type ReportTemplateInput,
  type ReportTemplateSectionInput,
} from '@/types/report-center'
import { mdReviewStatusMetaFor } from '@/utils/professional-status'
import { formatDate } from '@/utils/day'

const { canAccess } = usePermissionAccess()
const canAdd = computed(() => canAccess({ permissions: ['system:report:template:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:report:template:edit'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:report:template:remove'] }))
const canApprove = computed(() => canAccess({ permissions: ['system:report:template:approve'] }))
const canPublish = computed(() => canAccess({ permissions: ['system:report:template:publish'] }))

const feedback = useAppFeedback()

const keyword = ref('')
const status = ref('')
const query = reactive({ page: 1, pageSize: 20 })
const templates = ref<ReportTemplate[]>([])
const total = ref(0)
const isLoading = ref(false)
const error = ref<unknown>(null)

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const result = await fetchReportTemplates({
      page: query.page,
      pageSize: query.pageSize,
      ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
      ...(status.value ? { status: status.value as ReportTemplate['status'] } : {}),
    })
    templates.value = result.items
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
  keyword.value = ''
  status.value = ''
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

function defaultSections(): ReportTemplateSectionInput[] {
  return reportSectionKeys.map((key, index) => ({
    key,
    title: key,
    enabled: true,
    order: index + 1,
    sourceType: 'DATA',
  }))
}

const drawer = useCrudDrawer<ReportTemplateInput, ReportTemplate>({
  createForm: () => ({
    code: '',
    name: '',
    description: '',
    sections: defaultSections(),
    changeNote: '',
    evidenceSource: '',
    evidenceRef: '',
    evidenceLevel: undefined,
  }),
  editForm: (entity) => ({
    code: entity.code,
    name: entity.name,
    description: entity.description ?? '',
    sections: entity.sections.map((section) => ({ ...section })),
    changeNote: '',
    evidenceSource: entity.evidenceSource ?? '',
    evidenceRef: entity.evidenceRef ?? '',
    evidenceLevel: entity.evidenceLevel ?? undefined,
  }),
  submit: async ({ mode, data, entity }) => {
    const input = {
      ...data,
      description: data.description || undefined,
      changeNote: data.changeNote || undefined,
      evidenceSource: data.evidenceSource || undefined,
      evidenceRef: data.evidenceRef || undefined,
      evidenceLevel: data.evidenceLevel ?? undefined,
    }
    const result = mode === 'create'
      ? await createReportTemplate(input)
      : await updateReportTemplate(entity!.id, input)
    return result.template
  },
  onSuccess: () => load(),
})

const deleteAction = useConfirmedCrudAction<ReportTemplate, unknown>({
  action: async (row) => {
    await deleteReportTemplate(row.id)
  },
  confirm: (row) => ({ title: '删除模板草稿', content: `确定删除「${row.name}」？仅草稿可删除。`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => load(),
})

const workflow = useWorkflowActions<ReportTemplate>({
  entityName: '报告模板',
  run: (id, action) => runReportTemplateWorkflow(id, action).then((r) => r.template),
  onSuccess: () => load(),
})

const validateState = reactive({ loading: false, visible: false, violations: [] as { field: string; message: string }[] })

async function openValidate(row: ReportTemplate): Promise<void> {
  validateState.loading = true
  validateState.visible = true
  validateState.violations = []
  try {
    const result = await validateReportTemplate(row.id)
    validateState.violations = result.violations
  }
  catch (cause) {
    validateState.violations = [{ field: '请求失败', message: normalizeFeedbackError(cause).message }]
  }
  finally {
    validateState.loading = false
  }
}

const errorDescription = computed(() => error.value
  ? normalizeFeedbackError(error.value).message
  : '请检查网络连接后重试')

function addSection(formData: ReportTemplateInput): void {
  const usedKeys = new Set(formData.sections.map((section) => section.key))
  const nextKey = reportSectionKeys.find((key) => !usedKeys.has(key))
  if (!nextKey) {
    void feedback.message('warning', '章节键已全部使用')
    return
  }
  formData.sections.push({
    key: nextKey,
    title: nextKey,
    enabled: true,
    order: formData.sections.length + 1,
    sourceType: 'DATA',
  })
}

function removeSection(formData: ReportTemplateInput, index: number): void {
  formData.sections.splice(index, 1)
}

const sectionKeyLabel: Record<ReportSectionKey, string> = {
  enterprise: '企业信息',
  project: '项目信息',
  standards: '引用标准',
  candidates: '候选方案',
  selection: '方案确定',
  thermal: '热工计算',
  nodes: '节点做法',
  construction: '构造做法',
  comparison: '对比结论',
  acceptance: '验收建议',
  sources: '证据来源',
  disclaimer: '免责声明',
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => h('div', [
    h('div', { class: 'vicp-tpl-name' }, row.name),
    h('div', { class: 'vicp-tpl-code' }, `${row.code} · v${row.version}`),
  ]), colKey: 'name', minWidth: 240, title: '模板' },
  { cell: (_, { row }) => h('div', [
    h('div', {}, `启用 ${row.sections.filter((s: ReportSection) => s.enabled).length}/${row.sections.length} 章`),
    h('div', { class: 'vicp-tpl-sections' }, row.sections.filter((s: ReportSection) => s.enabled).map((s: ReportSection) => sectionKeyLabel[s.key] ?? s.key).join(' / ')),
  ]), colKey: 'sections', minWidth: 260, title: '章节配置' },
  { cell: (_, { row }) => h(AppStatusTag, mdReviewStatusMetaFor(row.status)), colKey: 'status', width: 100, title: '状态' },
  { cell: (_, { row }) => h(AppEvidenceSource, { evidence: row }), colKey: 'evidence', minWidth: 190, title: '来源与证据' },
  { cell: (_, { row }) => formatDate(new Date(row.updatedAt), 'YYYY-MM-DD'), colKey: 'updatedAt', minWidth: 110, title: '更新时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as ReportTemplate
  const actions: AppTableAction[] = []
  const available = workflowActionsForStatus(entity.status)

  if (canEdit.value && (entity.status === 'DRAFT' || entity.status === 'REJECTED')) {
    actions.push({ key: 'edit', label: '编辑', handler: () => drawer.openEdit(entity) })
  }
  actions.push({
    key: 'validate', label: '结构校验',
    handler: () => void openValidate(entity),
  })
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

const statusOptions = [
  { label: '全部状态', value: '' },
  { label: '草稿', value: 'DRAFT' },
  { label: '待审核', value: 'PENDING_REVIEW' },
  { label: '已通过', value: 'APPROVED' },
  { label: '已发布', value: 'PUBLISHED' },
  { label: '已停用', value: 'DISABLED' },
  { label: '已驳回', value: 'REJECTED' },
]

onMounted(load)
</script>

<template>
  <AppPage title="报告模板" description="报告章节模板（版本化审核实体）：配置章节启用与文案，通过后发布方可被报告生成引用。">
    <template #search>
      <AppSearchPanel :loading="isLoading" @reset="reset" @search="search">
        <t-form-item label="关键词">
          <t-input v-model="keyword" clearable placeholder="模板名称 / 编码" />
        </t-form-item>
        <t-form-item label="状态">
          <t-select v-model="status" :options="statusOptions" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :data="templates"
      empty-description="可新增第一个报告模板"
      empty-title="暂无模板"
      :error-description="errorDescription"
      :operations-width="280"
      row-key="id"
      :status="isLoading ? 'loading' : error ? 'error' : 'ready'"
      :total="total"
      @page-change="onPageChange"
      @page-size-change="onPageSizeChange"
      @refresh="load"
      @retry="load"
    >
      <template #toolbar>
        <t-button v-if="canAdd" theme="primary" @click="drawer.openCreate">
          <template #icon><AddIcon /></template>
          新增模板
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
      :title="drawer.mode.value === 'create' ? '新增模板' : '编辑模板'"
      :visible="drawer.visible.value"
      :width="'min(720px, 94vw)'"
      @cancel="drawer.close"
      @submit="drawer.submit"
      @update:visible="drawer.setVisible"
    >
      <t-form-item label="模板编码" name="code" required-mark>
        <t-input v-model="drawer.formData.code" maxlength="60" placeholder="如：STD-RPT-001" />
      </t-form-item>
      <t-form-item label="模板名称" name="name" required-mark>
        <t-input v-model="drawer.formData.name" maxlength="120" placeholder="如：标准报告模板" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="描述" name="description">
        <t-textarea v-model="drawer.formData.description" :autosize="{ minRows: 2, maxRows: 4 }" maxlength="500" placeholder="选填" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="章节配置" name="sections" required-mark>
        <div class="vicp-sections">
          <div v-for="(section, index) in drawer.formData.sections" :key="section.key" class="vicp-section-row">
            <t-select
              v-model="section.key"
              :options="reportSectionKeys.map((key) => ({ label: sectionKeyLabel[key], value: key }))"
              :disabled="drawer.mode.value === 'edit'"
              style="width: 150px"
            />
            <t-input v-model="section.title" maxlength="60" placeholder="章节标题" style="width: 180px" />
            <t-select
              v-model="section.sourceType"
              :options="[{ label: '数据章节', value: 'DATA' }, { label: '文案章节', value: 'TEXT' }]"
              style="width: 120px"
            />
            <t-switch v-model="section.enabled" />
            <t-input
              v-if="section.sourceType === 'TEXT'"
              v-model="section.content"
              maxlength="2000"
              placeholder="文案内容"
              style="width: 220px"
            />
            <t-button
              variant="text"
              shape="square"
              theme="danger"
              @click="removeSection(drawer.formData, index)"
            >
              <template #icon><DeleteIcon /></template>
            </t-button>
          </div>
          <t-button variant="outline" size="small" @click="addSection(drawer.formData)">
            添加章节
          </t-button>
        </div>
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="变更说明" name="changeNote">
        <t-textarea v-model="drawer.formData.changeNote" :autosize="{ minRows: 1, maxRows: 3 }" maxlength="500" placeholder="本次变更说明（提交审核时展示）" />
      </t-form-item>
    </AppCrudFormDialog>

    <!-- 结构校验结果 -->
    <t-dialog
      :footer="false"
      header="结构校验结果"
      :loading="validateState.loading"
      :visible="validateState.visible"
      width="min(520px, 92vw)"
      @close="validateState.visible = false"
    >
      <template v-if="!validateState.loading">
        <t-alert v-if="validateState.violations.length === 0" theme="success" message="章节配置合法，可提交审核或发布。" />
        <div v-else>
          <t-alert theme="warning" :message="`发现 ${validateState.violations.length} 项问题`" />
          <t-list>
            <t-list-item v-for="(violation, index) in validateState.violations" :key="index">
              <span class="vicp-violation-field">{{ violation.field }}</span>
              {{ violation.message }}
            </t-list-item>
          </t-list>
        </div>
      </template>
    </t-dialog>
  </AppPage>
</template>

<style scoped>
.vicp-tpl-name {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-tpl-code {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-tpl-sections {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  margin-top: 2px;
}
.vicp-sections {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.vicp-section-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.vicp-violation-field {
  color: var(--td-brand-color);
  margin-right: 8px;
}
.vicp-form-wide {
  grid-column: 1 / -1;
}
</style>
<script setup lang="ts">
import type { PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { computed, h, onMounted, reactive, ref } from 'vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {
  approveTemplateReport,
  fetchTemplateReports,
  rejectTemplateReport,
  submitTemplateReportForReview,
} from '@/api/modules/report-center'
import { fetchPlatformProjects } from '@/api/modules/projects'
import type { AppTableAction } from '@/types/crud'
import type { ProjectItem } from '@/types/project'
import { templateReportStatuses, type TemplateReport, type TemplateReportStatus } from '@/types/report-center'
import { formatDate } from '@/utils/day'

const { canAccess } = usePermissionAccess()
const canReview = computed(() => canAccess({ permissions: ['system:report:review'] }))

const projects = ref<ProjectItem[]>([])
const projectKeyword = ref('')
const projectLoading = ref(false)
const selectedProjectId = ref<string | undefined>(undefined)

async function loadProjects(): Promise<void> {
  projectLoading.value = true
  try {
    const result = await fetchPlatformProjects({
      page: 1,
      pageSize: 50,
      ...(projectKeyword.value.trim() ? { keyword: projectKeyword.value.trim() } : {}),
    })
    projects.value = result.items
  }
  catch {
    projects.value = []
  }
  finally {
    projectLoading.value = false
  }
}

const query = reactive({ page: 1, pageSize: 20 })
const reports = ref<TemplateReport[]>([])
const total = ref(0)
const isLoading = ref(false)
const error = ref<unknown>(null)
const status = ref<TemplateReportStatus | ''>('')

async function load(): Promise<void> {
  if (!selectedProjectId.value) {
    reports.value = []
    total.value = 0
    return
  }
  isLoading.value = true
  error.value = null
  try {
    const result = await fetchTemplateReports({
      page: query.page,
      pageSize: query.pageSize,
      projectId: selectedProjectId.value,
      ...(status.value ? { status: status.value } : {}),
    })
    reports.value = result.items
    total.value = result.total
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    isLoading.value = false
  }
}

function onProjectChange(): void {
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

// ---- 提交/审核动作（无需确认弹窗的轻量操作；驳回必须填原因） ----

const running = reactive<Record<string, boolean>>({})
const rejectDialog = reactive({ visible: false, reason: '', target: null as TemplateReport | null, submitting: false })

async function run(id: string, task: () => Promise<TemplateReport>): Promise<void> {
  if (running[id]) {
    return
  }
  running[id] = true
  try {
    await task()
    await load()
  }
  catch (cause) {
    await useAppFeedback().messageError(cause)
  }
  finally {
    delete running[id]
  }
}

function submitReview(row: TemplateReport): void {
  void run(row.id, () => submitTemplateReportForReview(row.id))
}

function openApprove(row: TemplateReport): void {
  void run(row.id, () => approveTemplateReport(row.id))
}

function openReject(row: TemplateReport): void {
  rejectDialog.target = row
  rejectDialog.reason = ''
  rejectDialog.visible = true
}

async function submitReject(): Promise<void> {
  const target = rejectDialog.target
  if (!target || rejectDialog.submitting) {
    return
  }
  const reason = rejectDialog.reason.trim()
  if (!reason) {
    await useAppFeedback().message('warning', '请填写驳回原因')
    return
  }
  rejectDialog.submitting = true
  try {
    await rejectTemplateReport(target.id, reason)
    rejectDialog.visible = false
    await load()
  }
  catch (cause) {
    await useAppFeedback().messageError(cause)
  }
  finally {
    rejectDialog.submitting = false
  }
}

const errorDescription = computed(() => error.value
  ? normalizeFeedbackError(error.value).message
  : '请检查网络连接后重试')

const statusLabel: Record<TemplateReportStatus, string> = {
  DRAFT: '草稿',
  QUEUED: '排队中',
  GENERATING: '生成中',
  READY: '已生成',
  FAILED: '生成失败',
  PENDING_REVIEW: '待审核',
  APPROVED: '已通过',
  REJECTED: '已驳回',
}

type TagStatus = 'default' | 'info' | 'processing' | 'success' | 'warning' | 'error' | 'disabled'

const statusTheme: Record<TemplateReportStatus, TagStatus> = {
  DRAFT: 'default',
  QUEUED: 'processing',
  GENERATING: 'processing',
  READY: 'info',
  FAILED: 'error',
  PENDING_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => row.reportType, colKey: 'reportType', minWidth: 160, title: '报告类型' },
  { cell: (_, { row }) => (row.templateVersion ? `v${row.templateVersion}` : '—'), colKey: 'templateVersion', minWidth: 90, title: '模板版本' },
  { cell: (_, { row }) => h(AppStatusTag, { label: statusLabel[row.status as TemplateReportStatus], status: statusTheme[row.status as TemplateReportStatus] }), colKey: 'status', width: 100, title: '状态' },
  { cell: (_, { row }) => row.errorMessage ?? '—', colKey: 'errorMessage', minWidth: 180, title: '失败原因' },
  { cell: (_, { row }) => formatDate(new Date(row.createdAt), 'YYYY-MM-DD HH:mm'), colKey: 'createdAt', minWidth: 150, title: '生成时间' },
  { cell: (_, { row }) => row.publishedAt ? formatDate(new Date(row.publishedAt), 'YYYY-MM-DD HH:mm') : '—', colKey: 'publishedAt', minWidth: 150, title: '通过时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as TemplateReport
  const actions: AppTableAction[] = []
  const busy = running[entity.id] ?? false
  if (entity.status === 'DRAFT') {
    actions.push({
      key: 'submit', label: '提交审核', loading: busy,
      handler: () => submitReview(entity),
    })
  }
  if (canReview.value && entity.status === 'PENDING_REVIEW') {
    actions.push({
      key: 'approve', label: '通过', loading: busy,
      handler: () => openApprove(entity),
    })
    actions.push({
      key: 'reject', label: '驳回', loading: busy, theme: 'danger',
      handler: () => openReject(entity),
    })
  }
  return actions
}

onMounted(() => {
  void loadProjects()
})
</script>

<template>
  <AppPage title="模板报告" description="项目级模板报告：选择项目后查看该项目的报告记录，提交审核并执行决议；报告生成入口（候选确认后）后续开放。">
    <template #search>
      <t-form-item label="项目">
        <t-select
          v-model="selectedProjectId"
          :loading="projectLoading"
          :options="projects.map((item) => ({ label: item.name, value: item.id }))"
          :filterable="true"
          placeholder="选择项目"
          style="width: 320px"
          @change="onProjectChange"
          @enter="loadProjects"
        />
      </t-form-item>
      <t-form-item label="状态">
        <t-select
          v-model="status"
          :options="[{ label: '全部状态', value: '' }, ...templateReportStatuses.map((value) => ({ label: statusLabel[value], value }))]"
          style="width: 160px"
          @change="load"
        />
      </t-form-item>
    </template>

    <AppDataTable
      :columns="columns"
      :data="reports"
      empty-description="选择项目后展示其模板报告"
      empty-title="暂无报告"
      :error-description="errorDescription"
      :operations-width="170"
      row-key="id"
      :status="isLoading ? 'loading' : error ? 'error' : 'ready'"
      :total="total"
      @page-change="onPageChange"
      @page-size-change="onPageSizeChange"
      @refresh="load"
      @retry="load"
    >
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <t-dialog
      header="驳回报告"
      :confirm-btn="{ content: '确认驳回', theme: 'danger', loading: rejectDialog.submitting }"
      :visible="rejectDialog.visible"
      width="min(480px, 92vw)"
      @cancel="rejectDialog.visible = false"
      @close="rejectDialog.visible = false"
      @confirm="submitReject"
    >
      <t-form-item label="驳回原因" name="rejectReason" required-mark>
        <t-textarea v-model="rejectDialog.reason" :autosize="{ minRows: 2, maxRows: 5 }" maxlength="500" placeholder="必填，将展示给报告创建人" />
      </t-form-item>
    </t-dialog>
  </AppPage>
</template>
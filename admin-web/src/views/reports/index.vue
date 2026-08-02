<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon, ArrowLeftIcon } from 'tdesign-icons-vue-next'
import { computed, h, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppTableActions from '@/components/business/AppTableActions.vue'
import ReportCreateDialog from '@/components/business/ReportCreateDialog.vue'
import ReportPreviewDialog from '@/components/business/ReportPreviewDialog.vue'
import ReportShareDialog from '@/components/business/ReportShareDialog.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useReportCenter } from '@/composables/useReportCenter'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { useResponsiveShell } from '@/composables/useResponsiveShell'
import { useUserStore } from '@/stores/user'
import type { AppTableAction } from '@/types/crud'
import type { ProjectItem, ProjectViewKey } from '@/types/project'
import type { ReportArtifactType, ReportCenterRow } from '@/types/report'
import { fetchReportDownloadUrl } from '@/api/modules/reports'
import { isProjectManager } from '@/utils/project'
import {
  canPublishReport,
  canRegenerateReport,
  formatCreatorName,
  formatFileSize,
  getReportTypeLabel,
  reportStateMeta,
} from '@/utils/report'
import { formatDate } from '@/utils/day'

defineOptions({ name: 'ReportCenter' })

const router = useRouter()
const userStore = useUserStore()
const { canAccess } = usePermissionAccess()
const { isMobile } = useResponsiveShell()

const {
  actions,
  activeView,
  allList,
  applyVisibilityFilter,
  clearSelection,
  conversationCount,
  errorDescription,
  polling,
  projectCenter,
  rows,
  selectProject,
  selectedProject,
  setActiveView,
  status,
} = useReportCenter()

const createDialogVisible = ref(false)
const shareDialogVisible = ref(false)
const shareReport = ref<ReportCenterRow | null>(null)
const previewVisible = ref(false)
const previewTitle = ref('')
const previewUrl = ref('')

const canViewAllProjects = computed(() => canAccess({ permissions: ['system:project:list'] }))

const viewOptions = computed(() => [
  { label: '我的项目', value: 'my' },
  { label: '公开项目', value: 'public' },
  ...(canViewAllProjects.value ? [{ label: '全部项目', value: 'all' as const }] : []),
])

const activeList = computed(() => projectCenter.activeList.value)

function isManagerOf(project: ProjectItem): boolean {
  return isProjectManager(project, userStore.profile?.id ?? null, userStore.isSuperAdmin)
}

function handleViewChange(value: string | number): void {
  setActiveView(value as ProjectViewKey)
}

function handleVisibilityChange(value: unknown): void {
  applyVisibilityFilter(value === 'PUBLIC' || value === 'PRIVATE' ? value : undefined)
}

function handleResetFilters(): void {
  applyVisibilityFilter(undefined)
}

const projectColumns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => h('span', { class: 'report-center-project-name' }, (row as ProjectItem).name),
    colKey: 'name',
    minWidth: 240,
    title: '项目名称',
  },
  {
    cell: (_h, { row }) => (row as ProjectItem).visibility === 'PRIVATE' ? '私有' : '公开',
    colKey: 'visibility',
    title: '可见性',
    width: 100,
  },
  {
    cell: (_h, { row }) => formatDate(new Date((row as ProjectItem).createdAt)),
    colKey: 'createdAt',
    title: '创建时间',
    width: 170,
  },
]

function projectActions(row: TableRowData): AppTableAction[] {
  const project = row as ProjectItem
  return [
    {
      handler: () => void router.push(`/projects/${encodeURIComponent(project.id)}`),
      key: 'view',
      label: '项目详情',
    },
    {
      handler: () => void selectProject(project),
      key: 'reports',
      label: '报告成果',
      theme: 'primary',
    },
  ]
}

function openReportDetail(row: ReportCenterRow): void {
  void router.push(`/reports/${encodeURIComponent(row.id)}`)
}

function artifactTypesOf(row: ReportCenterRow): ReportArtifactType[] {
  return row.artifacts.map(artifact => artifact.type)
}

function totalSizeBytes(row: ReportCenterRow): number {
  return row.artifacts.reduce((sum, artifact) => sum + artifact.file.sizeBytes, 0)
}

async function previewReport(row: ReportCenterRow): Promise<void> {
  try {
    const { url } = await fetchReportDownloadUrl(row.id, 'HTML')
    previewTitle.value = `${getReportTypeLabel(row.reportType)}报告预览`
    previewUrl.value = url
    previewVisible.value = true
  }
  catch (cause) {
    // 预览地址获取失败时退化为下载 HTML 文件，保证文件仍可获取
    void actions.downloadArtifact(row.id, 'HTML')
    void cause
  }
}

function openShare(row: ReportCenterRow): void {
  shareReport.value = row
  shareDialogVisible.value = true
}

function getReportActions(row: ReportCenterRow): AppTableAction[] {
  const state = reportStateMeta(row)
  const artifactTypes = artifactTypesOf(row)
  const items: AppTableAction[] = [
    {
      handler: () => openReportDetail(row),
      key: 'detail',
      label: '详情',
      theme: 'primary',
    },
  ]
  if (artifactTypes.includes('HTML')) {
    items.push({
      handler: () => void previewReport(row),
      key: 'preview',
      label: '预览',
    })
  }
  if (artifactTypes.includes('WORD')) {
    items.push({
      handler: () => void downloadArtifact(row, 'WORD'),
      key: 'word',
      label: '下载 Word',
    })
  }
  if (artifactTypes.includes('PDF')) {
    items.push({
      handler: () => void downloadArtifact(row, 'PDF'),
      key: 'pdf',
      label: '下载 PDF',
    })
  }
  if (canPublishReport(row)) {
    items.push({
      handler: () => void actions.publishAction.run(row),
      key: 'publish',
      label: '发布',
      loading: actions.publishAction.running.value,
      theme: 'success',
    })
  }
  if (canRegenerateReport(row.status)) {
    items.push({
      handler: () => void actions.retryAction.run(row),
      key: 'retry',
      label: '重试',
      loading: actions.retryAction.running.value,
    })
  }
  if (state.label === '已发布' || state.label === '已完成') {
    items.push({
      handler: () => openShare(row),
      key: 'share',
      label: '分享',
    })
  }
  items.push({
    handler: () => void actions.deleteAction.run(row),
    key: 'remove',
    label: '删除',
    loading: actions.deleteAction.running.value,
    theme: 'danger',
  })
  return items
}

function downloadArtifact(row: ReportCenterRow, type: ReportArtifactType): void {
  void actions.downloadArtifact(row.id, type)
}

const reportColumns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => {
      const item = row as ReportCenterRow
      return h('div', { class: 'report-center-type' }, [
        h('span', {}, getReportTypeLabel(item.reportType)),
        h('span', { class: 'report-center-muted' }, `模板 v${item.templateVersion}`),
      ])
    },
    colKey: 'reportType',
    minWidth: 140,
    title: '报告类型',
  },
  {
    cell: (_h, { row }) => h('span', {}, (row as ReportCenterRow).conversationTitle || '-'),
    colKey: 'conversationTitle',
    minWidth: 160,
    title: '来源会话',
  },
  {
    cell: (_h, { row }) => h(AppStatusTag, reportStateMeta(row as ReportCenterRow)),
    colKey: 'status',
    title: '状态',
    width: 110,
  },
  {
    cell: (_h, { row }) => {
      const item = row as ReportCenterRow
      if (!item.errorMessage) {
        return '-'
      }
      return h('span', { class: 'report-center-error', title: item.errorMessage }, item.errorMessage)
    },
    colKey: 'errorMessage',
    minWidth: 160,
    title: '失败原因',
  },
  {
    cell: (_h, { row }) => formatCreatorName(
      (row as ReportCenterRow).createdById,
      userStore.profile?.id ?? null,
    ),
    colKey: 'createdById',
    title: '创建人',
    width: 90,
  },
  {
    cell: (_h, { row }) => formatDate(new Date((row as ReportCenterRow).createdAt)),
    colKey: 'createdAt',
    title: '创建时间',
    width: 170,
  },
  {
    cell: (_h, { row }) => formatDate(new Date((row as ReportCenterRow).updatedAt)),
    colKey: 'updatedAt',
    title: '更新时间',
    width: 170,
  },
  {
    cell: (_h, { row }) => formatFileSize(totalSizeBytes(row as ReportCenterRow)),
    colKey: 'sizeBytes',
    title: '文件大小',
    width: 100,
  },
]
</script>

<template>
  <AppPage>
    <template #header>
      <AppPageHeader
        description="按项目聚合 AI 生成的节能报告，支持生成、发布、下载与分享"
        title="报告成果中心"
      >
        <template #actions>
          <t-button
            v-if="selectedProject"
            theme="primary"
            @click="createDialogVisible = true"
          >
            <template #icon>
              <AddIcon />
            </template>
            创建报告
          </t-button>
        </template>
      </AppPageHeader>
    </template>

    <!-- 项目选择区 -->
    <div v-if="!selectedProject" class="report-center-select">
      <t-tabs :value="activeView" @change="handleViewChange">
        <t-tab-panel
          v-for="view in viewOptions"
          :key="view.value"
          :label="view.label"
          :value="view.value"
        >
          <template v-if="view.value === 'all'">
            <AppSearchPanel
              :loading="allList.isLoading.value"
              @reset="handleResetFilters"
              @search="allList.search"
            >
              <t-form-item label="可见性">
                <t-select
                  :model-value="allList.query.visibility ?? ''"
                  :options="[
                    { label: '全部可见性', value: '' },
                    { label: '公开', value: 'PUBLIC' },
                    { label: '私有', value: 'PRIVATE' },
                  ]"
                  clearable
                  placeholder="全部"
                  @change="handleVisibilityChange"
                />
              </t-form-item>
            </AppSearchPanel>
          </template>

          <div v-if="!isMobile" class="report-center-project-table">
            <AppDataTable
              :columns="projectColumns"
              :current="activeList.current.value"
              :data="activeList.data.value"
              empty-description="暂无符合条件的项目"
              empty-title="暂无项目"
              :error-description="'请检查网络连接后重试'"
              :page-size="activeList.pageSize.value"
              row-key="id"
              :status="activeList.tableStatus.value"
              :total="activeList.total.value"
              @page-change="activeList.changePage"
              @refresh="activeList.refresh"
              @retry="activeList.retry"
            >
              <template #operations="{ row }">
                <AppTableActions :actions="projectActions(row)" />
              </template>
            </AppDataTable>
          </div>

          <div v-else class="report-center-project-cards">
            <article
              v-for="project in activeList.data.value"
              :key="project.id"
              class="report-center-project-card"
            >
              <div class="report-center-project-card__main">
                <strong class="report-center-project-card__name">{{ project.name }}</strong>
                <p class="report-center-project-card__meta">
                  {{ project.visibility === 'PRIVATE' ? '私有' : '公开' }} ·
                  {{ formatDate(new Date(project.createdAt)) }}
                </p>
              </div>
              <t-button size="small" theme="primary" variant="text" @click="selectProject(project)">
                报告成果
              </t-button>
            </article>
          </div>
        </t-tab-panel>
      </t-tabs>
    </div>

    <!-- 报告列表区 -->
    <template v-else>
      <div class="report-center-context">
        <t-button theme="default" variant="text" @click="clearSelection">
          <template #icon>
            <ArrowLeftIcon />
          </template>
          切换项目
        </t-button>
        <div class="report-center-context__info">
          <strong class="report-center-context__name">{{ selectedProject.name }}</strong>
          <span class="report-center-muted">
            {{ conversationCount }} 个会话 · {{ rows.length }} 份报告
          </span>
          <t-tag v-if="polling" theme="primary" variant="light">
            生成中报告自动刷新
          </t-tag>
          <t-tag v-if="isManagerOf(selectedProject)" theme="success" variant="light">
            可管理
          </t-tag>
        </div>
      </div>

      <AppDataTable
        :columns="reportColumns"
        :data="rows"
        empty-description="该项目暂无报告，可先在 AI 会话中生成报告草稿，或点击右上角创建报告"
        empty-title="暂无报告"
        :error-description="errorDescription"
        row-key="id"
        :status="status === 'loading' ? 'loading' : status === 'error' ? 'error' : 'ready'"
        @refresh="selectedProject && selectProject(selectedProject)"
        @retry="selectedProject && selectProject(selectedProject)"
      >
        <template #operations="{ row }">
          <AppTableActions :actions="getReportActions(row)" />
        </template>
      </AppDataTable>
    </template>

    <ReportCreateDialog
      v-model:visible="createDialogVisible"
      :project-id="selectedProject?.id ?? ''"
      @success="selectedProject && selectProject(selectedProject)"
    />

    <ReportShareDialog
      v-if="shareReport"
      v-model:visible="shareDialogVisible"
      :artifact-types="shareReport ? artifactTypesOf(shareReport) : []"
      :report-id="shareReport?.id ?? ''"
      @success="selectedProject && selectProject(selectedProject)"
    />

    <ReportPreviewDialog
      v-model:visible="previewVisible"
      :title="previewTitle"
      :url="previewUrl"
    />
  </AppPage>
</template>

<style scoped>
.report-center-select {
  min-width: 0;
}

.report-center-project-table {
  min-width: 0;
}

.report-center-project-name {
  font-weight: 500;
}

.report-center-project-cards {
  display: grid;
  gap: var(--td-size-3);
}

.report-center-project-card {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-3);
  padding: var(--vicp-panel-padding);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.report-center-project-card__name {
  color: var(--td-text-color-primary);
  font-weight: 600;
}

.report-center-project-card__meta {
  margin: var(--td-size-2) 0 0;
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}

.report-center-context {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-3);
  padding: var(--vicp-panel-padding);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.report-center-context__info {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-3);
}

.report-center-context__name {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-medium);
  font-weight: 600;
}

.report-center-muted {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.report-center-type {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.report-center-error {
  display: block;
  overflow: hidden;
  color: var(--td-error-color);
  font-size: var(--td-font-size-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
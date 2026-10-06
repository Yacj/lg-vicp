<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AppTableAction } from '@/types/crud'
import type { MyReportItem, ReportAffiliationFilter } from '@/types/report'
import { computed, h, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppTableActions from '@/components/business/AppTableActions.vue'
import ReportCreateDialog from '@/components/business/ReportCreateDialog.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { useReportList } from '@/composables/useReportList'
import { formatDate } from '@/utils/day'
import { formatReportProjectName, getReportTypeLabel, reportStateMeta } from '@/utils/report'

defineOptions({ name: 'ReportCenter' })

const router = useRouter()
const route = useRoute()
const { canAccess } = usePermissionAccess()

const scopedProjectId = computed(() =>
  typeof route.query.projectId === 'string' ? route.query.projectId : '')

const { actions, list, scoped, scopedProjectName } = useReportList(() => scopedProjectId.value)

const createDialogVisible = ref(false)
const canGenerate = computed(() => canAccess({ permissions: ['system:report:generate'] }))

const affiliationOptions: Array<{ label: string, value: ReportAffiliationFilter }> = [
  { label: '全部', value: 'all' },
  { label: '项目报告', value: 'linked' },
  { label: '独立报告', value: 'standalone' },
]

function handleAffiliationChange(value: unknown): void {
  if (value !== 'all' && value !== 'linked' && value !== 'standalone') {
    return
  }
  list.setQuery({ affiliation: value })
  void list.search()
}

function clearProjectScope(): void {
  const query = { ...route.query }
  delete query.projectId
  void router.replace({ path: '/reports', query })
}

function openReportDetail(row: MyReportItem): void {
  void router.push(`/reports/${encodeURIComponent(row.id)}`)
}

function openProject(projectId: string): void {
  void router.push(`/projects/${encodeURIComponent(projectId)}`)
}

function getReportActions(row: MyReportItem): AppTableAction[] {
  return [
    {
      handler: () => openReportDetail(row),
      key: 'detail',
      label: '详情',
      theme: 'primary',
    },
    {
      handler: () => void actions.deleteAction.run(row),
      key: 'remove',
      label: '删除',
      loading: actions.deleteAction.running.value,
      theme: 'danger',
    },
  ]
}

const reportColumns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => (row as MyReportItem).title,
    colKey: 'title',
    minWidth: 180,
    title: '报告名称',
  },
  {
    cell: (_h, { row }) => getReportTypeLabel((row as MyReportItem).reportType),
    colKey: 'reportType',
    minWidth: 140,
    title: '报告类型',
  },
  {
    cell: (_h, { row }) => {
      const item = row as MyReportItem
      if (!item.project) {
        return formatReportProjectName(null)
      }
      return h('a', {
        class: 'report-center-project-link',
        href: `/projects/${encodeURIComponent(item.project.id)}`,
        onClick: (event: Event) => {
          event.preventDefault()
          openProject(item.project!.id)
        },
      }, item.project.name)
    },
    colKey: 'project',
    minWidth: 160,
    title: '项目',
  },
  {
    cell: (_h, { row }) => h(AppStatusTag, reportStateMeta({
      publishedAt: null,
      status: (row as MyReportItem).status,
    })),
    colKey: 'status',
    title: '状态',
    width: 110,
  },
  {
    cell: (_h, { row }) => formatDate(new Date((row as MyReportItem).createdAt)),
    colKey: 'createdAt',
    title: '生成时间',
    width: 170,
  },
]
</script>

<template>
  <AppPage title="报告列表">
    <template #actions>
      <t-button v-if="canGenerate" theme="primary" @click="createDialogVisible = true">
        生成报告
      </t-button>
    </template>

    <div v-if="scoped" class="report-center-context">
      <t-button theme="default" variant="text" @click="clearProjectScope">
        返回全部报告
      </t-button>
      <div class="report-center-context__info">
        <strong class="report-center-context__name">{{ scopedProjectName || '当前项目' }}</strong>
        <span class="report-center-muted">仅显示本项目报告</span>
      </div>
    </div>

    <div v-else class="report-center-filter">
      <t-radio-group
        :model-value="list.query.affiliation"
        variant="default-filled"
        @change="handleAffiliationChange"
      >
        <t-radio-button v-for="option in affiliationOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </t-radio-button>
      </t-radio-group>
    </div>

    <AppDataTable
      :columns="reportColumns"
      :current="list.current.value"
      :data="list.data.value"
      empty-description="你可以从项目 AI 或筑小格对话中生成报告。"
      empty-title="还没有报告"
      error-description="请检查网络连接后重试"
      :page-size="list.pageSize.value"
      row-key="id"
      :status="list.tableStatus.value"
      :total="list.total.value"
      @page-change="list.changePage"
      @refresh="list.refresh"
      @retry="list.retry"
    >
      <template #operations="{ row }">
        <AppTableActions :actions="getReportActions(row)" />
      </template>
    </AppDataTable>

    <ReportCreateDialog
      v-model:visible="createDialogVisible"
      :project-id="scopedProjectId"
      :project-name="scopedProjectName || undefined"
      @success="list.refresh"
    />
  </AppPage>
</template>

<style scoped>
.report-center-context,
.report-center-filter {
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

.report-center-project-link {
  color: var(--td-brand-color);
  cursor: pointer;
  text-decoration: none;
}

.report-center-project-link:hover {
  text-decoration: underline;
}
</style>

<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { ChevronRightIcon } from 'tdesign-icons-vue-next'
import { computed, h } from 'vue'
import { useRouter } from 'vue-router'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppErrorState from '@/components/ui/AppErrorState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useProjectCenter } from '@/composables/useProjectCenter'
import { useResponsiveShell } from '@/composables/useResponsiveShell'
import type { AppTableAction } from '@/types/crud'
import type { ProjectItem } from '@/types/project'
import { formatDate } from '@/utils/day'
import {
  formatProjectVisibilityScope,
  normalizeVisibilityFilter,
  PROJECT_VISIBILITY_FILTER_OPTIONS,
  projectStatusMeta,
} from '@/utils/project'

const router = useRouter()
const { isMobile } = useResponsiveShell()

const {
  allList,
  applyVisibilityFilter,
  deleteAction,
  projectStatistics,
  projectStatisticsError,
  projectStatisticsLoading,
  refreshProjectStatistics,
} = useProjectCenter({ loadStatistics: true })

const columns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => h('span', { class: 'project-name' }, (row as ProjectItem).name),
    colKey: 'name',
    minWidth: 220,
    title: '项目名称',
  },
  {
    cell: (_h, { row }) => (row as ProjectItem).createdByName || '—',
    colKey: 'createdByName',
    minWidth: 140,
    title: '创建用户',
  },
  {
    cell: (_h, { row }) => (row as ProjectItem).ownerDepartmentName || '—',
    colKey: 'ownerDepartmentName',
    minWidth: 140,
    title: '所属部门',
  },
  {
    cell: (_h, { row }) => formatProjectVisibilityScope(row as ProjectItem),
    colKey: 'visibility',
    minWidth: 180,
    title: '可见范围',
  },
  {
    cell: (_h, { row }) => {
      const meta = projectStatusMeta((row as ProjectItem).status)
      return h(AppStatusTag, { label: meta.label, status: meta.status })
    },
    colKey: 'status',
    title: '状态',
    width: 100,
  },
  {
    cell: (_h, { row }) => formatDate(new Date((row as ProjectItem).createdAt)),
    colKey: 'createdAt',
    title: '创建时间',
    width: 170,
  },
  {
    cell: (_h, { row }) => formatDate(new Date((row as ProjectItem).updatedAt)),
    colKey: 'updatedAt',
    title: '更新时间',
    width: 170,
  },
]

const statisticsErrorDescription = computed(() => projectStatisticsError.value
  ? normalizeFeedbackError(projectStatisticsError.value).message
  : '请检查网络连接后重试')

const tableErrorDescription = computed(() => {
  const error = allList.error.value
  return error ? normalizeFeedbackError(error).message : '请检查网络连接后重试'
})

function openProject(project: ProjectItem): void {
  void router.push(`/projects/${encodeURIComponent(project.id)}`)
}

function getActions(row: TableRowData): AppTableAction[] {
  const project = row as ProjectItem
  const actions: AppTableAction[] = [
    {
      handler: () => openProject(project),
      key: 'view',
      label: '查看',
      theme: 'primary',
    },
  ]
  if (project.canDelete !== false) {
    actions.push({
      handler: () => deleteAction.run(project),
      key: 'remove',
      label: '删除',
      loading: deleteAction.running.value,
      theme: 'danger',
    })
  }
  return actions
}

function handleVisibilityChange(value: unknown): void {
  const visibility = typeof value === 'string' ? normalizeVisibilityFilter(value) : undefined
  applyVisibilityFilter(visibility)
}
</script>

<template>
  <AppPage description="查看全平台项目。B 端不创建项目，仅支持查看与删除。" title="项目管理">
    <section aria-label="项目统计" class="vicp-project-statistics">
      <AppErrorState
        v-if="projectStatisticsError"
        :description="statisticsErrorDescription"
        title="统计加载失败"
        @action="refreshProjectStatistics"
      />
      <template v-else>
        <t-card size="small">
          <span>项目总数</span>
          <strong>{{ projectStatisticsLoading ? '—' : projectStatistics.total }}</strong>
        </t-card>
        <t-card size="small">
          <span>公开项目</span>
          <strong>{{ projectStatisticsLoading ? '—' : projectStatistics.public }}</strong>
        </t-card>
        <t-card size="small">
          <span>私有项目</span>
          <strong>{{ projectStatisticsLoading ? '—' : projectStatistics.private }}</strong>
        </t-card>
      </template>
    </section>

    <AppSearchPanel
      :loading="allList.isLoading.value"
      @reset="allList.reset"
      @search="allList.search"
    >
      <t-form-item label="关键词">
        <t-input
          v-model="allList.query.keyword"
          clearable
          placeholder="项目名称、地区或建筑类型"
        />
      </t-form-item>
      <t-form-item label="可见范围">
        <t-select
          :model-value="allList.query.visibility ?? ''"
          :options="[...PROJECT_VISIBILITY_FILTER_OPTIONS]"
          clearable
          placeholder="全部可见范围"
          @change="handleVisibilityChange"
        />
      </t-form-item>
    </AppSearchPanel>

    <div v-if="!isMobile">
      <AppDataTable
        :columns="columns"
        :current="allList.current.value"
        :data="allList.data.value"
        empty-description="暂无符合条件的项目"
        empty-title="暂无项目"
        :error-description="tableErrorDescription"
        :page-size="allList.pageSize.value"
        row-key="id"
        :status="allList.tableStatus.value"
        title="项目列表"
        :total="allList.total.value"
        class="mt-3"
        @page-change="allList.changePage"
        @refresh="allList.refresh"
        @retry="allList.retry"
      >
        <template #operations="{ row }">
          <AppTableActions :actions="getActions(row)" />
        </template>
      </AppDataTable>
    </div>

    <div v-else class="project-center-cards">
      <AppErrorState
        v-if="allList.tableStatus.value === 'error'"
        :description="tableErrorDescription"
        title="项目列表加载失败"
        @action="allList.retry"
      />
      <template v-else>
        <article
          v-for="project in allList.data.value"
          :key="project.id"
          class="project-card"
          @click="openProject(project)"
        >
        <div class="project-card__main">
          <div class="project-card__title-row">
            <strong class="project-card__name">{{ project.name }}</strong>
            <AppStatusTag
              :label="projectStatusMeta(project.status).label"
              :status="projectStatusMeta(project.status).status"
            />
          </div>
          <p class="project-card__meta">
            <span>{{ project.createdByName || '—' }}</span>
            <span>{{ formatProjectVisibilityScope(project) }}</span>
          </p>
        </div>
        <div class="project-card__side">
          <div class="project-card__actions" @click.stop>
            <AppTableActions :actions="getActions(project)" :max-visible="0" />
          </div>
          <ChevronRightIcon class="project-card__chevron" />
        </div>
      </article>

        <AppEmptyState
          v-if="allList.data.value.length === 0 && allList.tableStatus.value === 'ready'"
          description="暂无符合条件的项目"
          title="暂无项目"
        />
      </template>
    </div>
  </AppPage>
</template>

<style scoped>
.vicp-project-statistics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--td-size-3);
  margin-bottom: var(--td-size-4);
}

.vicp-project-statistics :deep(.app-error-state) {
  grid-column: 1 / -1;
}

.vicp-project-statistics :deep(.t-card__body) {
  display: grid;
  gap: var(--td-size-1);
}

.vicp-project-statistics span {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.vicp-project-statistics strong {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-large);
  font-weight: var(--td-font-weight-medium);
}

.project-center-cards {
  display: grid;
  min-width: 0;
  gap: var(--td-size-3);
}

.project-card {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-3);
  padding: var(--vicp-panel-padding);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
  cursor: pointer;
}

.project-card__main {
  min-width: 0;
  flex: 1;
}

.project-card__title-row,
.project-card__meta,
.project-card__side {
  display: flex;
  align-items: center;
  gap: var(--td-size-2);
}

.project-card__name {
  overflow: hidden;
  color: var(--td-text-color-primary);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-card__meta {
  margin: var(--td-size-2) 0 0;
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}

.project-card__side {
  color: var(--td-text-color-placeholder);
}
</style>

<script setup lang="ts">
import type { DashboardAttentionItem } from '@/types/dashboard'
import type { ProjectItem } from '@/types/project'
import type { ReportCenterRow } from '@/types/report'
import { TimeIcon } from 'tdesign-icons-vue-next'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { AppEmptyState, AppPage } from '@/components/ui'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { formatDate } from '@/utils/day'
import { formatProjectStatisticsScope, formatProjectVisibilityScope } from '@/utils/project'
import type { DashboardMetricInput, DashboardQuickAction } from './dashboard'
import DashboardAttentionList from './components/DashboardAttentionList.vue'
import DashboardMetrics from './components/DashboardMetrics.vue'
import DashboardRecentPanel from './components/DashboardRecentPanel.vue'
import DashboardShortcuts from './components/DashboardShortcuts.vue'
import DashboardWelcome from './components/DashboardWelcome.vue'
import {
  formatToday,
  getGreeting,
  projectMetricCards,
  projectQuickActions,
  QUICK_ACTION_DEFINITIONS,
} from './dashboard'
import { useDashboardMetrics } from './useDashboardMetrics'
import { useDashboardRecent } from './useDashboardRecent'
import { useDashboardTodos } from './useDashboardTodos'

defineOptions({ name: 'Home' })

const router = useRouter()
const { canAccess } = usePermissionAccess()

const greeting = computed(() => getGreeting(new Date().getHours()))
const todayText = computed(() => formatToday())

function canNavigate(path: string): boolean {
  const resolved = router.resolve(path)
  return resolved.matched.length > 0 && resolved.name !== 'NotFound'
}

// ===== 核心指标与待处理事项（计数来自既有统计/列表接口，按权限裁剪） =====

const {
  projectStats,
  knowledgePendingCount,
  reviewPendingCount,
  parsingFailedCount,
  loading: metricsLoading,
} = useDashboardMetrics()

const metricCards = computed(() => {
  const stats = projectStats.value
  const inputs: DashboardMetricInput[] = [
    {
      id: 'projects',
      label: '项目总数',
      paths: ['/projects'],
      count: stats?.total ?? null,
      secondaryText: stats ? formatProjectStatisticsScope(stats) : '',
    },
    {
      id: 'knowledge',
      label: '待处理知识文档',
      paths: ['/knowledge/documents'],
      count: knowledgePendingCount.value,
      activeStatus: 'warning',
    },
    {
      id: 'review',
      label: '待审核事项',
      paths: ['/review-center/queue'],
      count: reviewPendingCount.value,
      activeStatus: 'warning',
    },
    {
      id: 'parsing',
      label: '解析失败任务',
      paths: ['/knowledge/parsing-jobs'],
      count: parsingFailedCount.value,
      activeStatus: 'error',
    },
  ]
  return projectMetricCards(inputs, canNavigate)
})

const { attentionItems } = useDashboardTodos(
  { knowledgePendingCount, reviewPendingCount, parsingFailedCount },
  canNavigate,
)

function openAttention(item: DashboardAttentionItem): void {
  if (item.route) {
    void router.push(item.route)
  }
}

// ===== 快捷入口（固定高频入口，权限码 + 路由可达性双重裁剪） =====

const quickActions = computed(() =>
  projectQuickActions(
    QUICK_ACTION_DEFINITIONS,
    permissions => canAccess({ permissions }),
    canNavigate,
  ),
)

function openQuickAction(action: DashboardQuickAction): void {
  void router.push(action.path)
}

// ===== 最近项目 / 最近报告 / 资料异常 =====

const {
  recentProjects,
  recentReports,
  canAggregateReports,
  parsingFailures,
  parsingFailureTotal,
  parsingJobsPath,
  parsingJobsReachable,
} = useDashboardRecent()

function openProject(project: ProjectItem): void {
  void router.push(`/projects/${encodeURIComponent(project.id)}`)
}

function openReport(report: ReportCenterRow): void {
  void router.push(`/reports/${encodeURIComponent(report.id)}`)
}

function openPath(path: string): void {
  void router.push(path)
}
</script>

<template>
  <AppPage class="dashboard-page">
    <DashboardWelcome :greeting="greeting" :today-text="todayText" />

    <DashboardMetrics :cards="metricCards" :loading="metricsLoading" />

    <div class="dashboard-grid">
      <section class="dashboard-panel dashboard-panel--attention" aria-labelledby="attention-title">
        <header class="dashboard-panel__header">
          <div class="dashboard-panel__heading">
            <strong id="attention-title">待处理事项</strong>
            <span>按优先级排序，仅展示需要处理的真实事项</span>
          </div>
        </header>
        <DashboardAttentionList
          :items="attentionItems"
          :loading="metricsLoading"
          @open="openAttention"
        />
      </section>

      <section class="dashboard-panel dashboard-panel--shortcuts" aria-labelledby="shortcuts-title">
        <header class="dashboard-panel__header">
          <div class="dashboard-panel__heading">
            <strong id="shortcuts-title">快捷入口</strong>
            <span>高频操作按账号权限显示</span>
          </div>
        </header>
        <DashboardShortcuts :actions="quickActions" @open="openQuickAction" />
      </section>
    </div>

    <div class="dashboard-grid">
      <section class="dashboard-panel dashboard-panel--projects" aria-labelledby="recent-projects-title">
        <header class="dashboard-panel__header">
          <div class="dashboard-panel__heading">
            <strong id="recent-projects-title">最近项目</strong>
          </div>
          <t-button
            v-if="canNavigate('/projects')"
            size="small"
            theme="default"
            variant="text"
            @click="openPath('/projects')"
          >
            全部项目
          </t-button>
        </header>

        <t-loading :loading="recentProjects === null" size="small" text="正在加载最近项目">
          <template v-if="recentProjects && recentProjects.length > 0">
            <ul class="dashboard-line-list">
              <li v-for="project in recentProjects" :key="project.id" class="dashboard-line-item">
                <t-button
                  class="dashboard-line-item__main"
                  theme="default"
                  variant="text"
                  @click="openProject(project)"
                >
                  <strong>{{ project.name }}</strong>
                  <span class="dashboard-line-item__meta">
                    {{ project.region || '未填写地区' }} ·
                    {{ formatProjectVisibilityScope(project) }}
                  </span>
                </t-button>
                <span class="dashboard-line-item__time">
                  <TimeIcon />
                  {{ formatDate(new Date(project.updatedAt)) }}
                </span>
              </li>
            </ul>
          </template>
          <AppEmptyState
            v-else-if="recentProjects"
            description="你参与的项目会显示在这里，可先创建或加入项目"
            size="small"
            title="暂无最近项目"
          />
        </t-loading>
      </section>

      <section class="dashboard-panel dashboard-panel--recent" aria-label="最近报告与资料异常">
        <DashboardRecentPanel
          :can-aggregate-reports="canAggregateReports"
          :parsing-failure-total="parsingFailureTotal"
          :parsing-failures="parsingFailures"
          :parsing-jobs-path="parsingJobsPath"
          :parsing-jobs-reachable="parsingJobsReachable"
          :recent-reports="recentReports"
          @open-path="openPath"
          @open-report="openReport"
        />
      </section>
    </div>
  </AppPage>
</template>

<style scoped>
.dashboard-grid {
  display: grid;
  min-width: 0;
  align-items: start;
  gap: var(--vicp-page-gap);
  grid-template-columns: repeat(12, minmax(0, 1fr));
}

.dashboard-grid > * {
  min-width: 0;
}

.dashboard-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-4);
  padding: var(--vicp-panel-padding);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.dashboard-panel--attention {
  grid-column: span 8;
}

.dashboard-panel--shortcuts {
  grid-column: span 4;
}

.dashboard-panel--projects {
  grid-column: span 7;
}

.dashboard-panel--recent {
  grid-column: span 5;
}

.dashboard-panel__header {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-4);
}

.dashboard-panel__heading {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-1);
}

.dashboard-panel__heading strong {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
}

.dashboard-panel__heading span {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.dashboard-line-list {
  display: flex;
  min-width: 0;
  margin: 0;
  padding: 0;
  flex-direction: column;
  list-style: none;
}

.dashboard-line-item {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-4);
  padding: var(--td-size-3) 0;
  border-bottom: 1px solid var(--td-component-stroke);
}

.dashboard-line-item:last-child {
  border-bottom: 0;
}

.dashboard-line-item__main {
  display: flex;
  height: auto;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: var(--td-size-1);
  padding: 0;
  text-align: left;
  white-space: normal;
}

.dashboard-line-item__main strong {
  overflow: hidden;
  max-width: 100%;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-line-item__main:hover strong {
  color: var(--td-brand-color);
}

.dashboard-line-item__meta {
  overflow: hidden;
  max-width: 100%;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-line-item__time {
  display: flex;
  min-width: 0;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--td-size-1);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  white-space: nowrap;
}

.dashboard-panel :deep(.app-empty-state) {
  min-height: calc(var(--vicp-state-min-height) - var(--td-size-10));
}

@media (max-width: 1100px) {
  .dashboard-panel--attention,
  .dashboard-panel--shortcuts,
  .dashboard-panel--projects,
  .dashboard-panel--recent {
    grid-column: span 12;
  }
}

@media (max-width: 640px) {
  .dashboard-line-item {
    align-items: flex-start;
    flex-direction: column;
    gap: var(--td-size-2);
  }
}
</style>

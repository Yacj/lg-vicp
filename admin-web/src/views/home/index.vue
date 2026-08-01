<script setup lang="ts">
import type {
  AttentionPriority,
  DashboardOverview,
  KnowledgePipelineStage,
  TrendRange,
} from '@/types/dashboard'
import {
  Building1Icon,
  DataCheckedIcon,
  FileIcon,
  FolderIcon,
  TimeIcon,
} from 'tdesign-icons-vue-next'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { createBarOption } from '@/charts/options/bar'
import {
  createTaskDistributionOption,
  createTrendOption,
  TASK_STATUS_LABELS,
} from '@/charts/options/dashboard'
import { AppChart, AppChartPanel } from '@/components/chart'
import { AppEmptyState, AppMetricCard, AppPage } from '@/components/ui'
import { useChartTheme } from '@/composables/useChartTheme'
import { useRouteStore } from '@/stores/route'
import { useUserStore } from '@/stores/user'
import {
  createEmptyDashboardOverview,
} from '@/types/dashboard'
import {
  formatToday,
  getGreeting,
  limitShortcuts,
  projectAvailableShortcuts,
  resolveFirstNavigable,
} from './dashboard'

defineOptions({ name: 'Home' })

const router = useRouter()
const routeStore = useRouteStore()
const userStore = useUserStore()
const { tokens } = useChartTheme()

// 后端 Dashboard 聚合接口尚未提供（见 docs/admin-web/api-gaps.md GAP-001），
// 使用诚实空投影，不请求多个列表接口拼装统计、不使用随机 Mock。
const overview = ref<DashboardOverview>(createEmptyDashboardOverview())
const loading = ref(false)
const trendRange = ref<TrendRange>('7d')

const greeting = computed(() => getGreeting(new Date().getHours()))
const todayText = computed(() => formatToday())

const userName = computed(() => userStore.profile?.displayName ?? '管理员')
const primaryDepartment = computed(() =>
  userStore.departments.find(department => department.isPrimary)?.name
  ?? userStore.departments[0]?.name
  ?? '蓝格 VICP',
)

function canNavigate(path: string): boolean {
  const resolved = router.resolve(path)
  return resolved.matched.length > 0 && resolved.name !== 'NotFound'
}

const shortcuts = computed(() =>
  limitShortcuts(projectAvailableShortcuts(routeStore.sidebarMenus, canNavigate)),
)

const projectListRoute = computed(() =>
  resolveFirstNavigable(['/projects/my', '/projects'], canNavigate),
)

const metrics = computed(() => [
  {
    id: 'project-total',
    label: '项目总数',
    value: overview.value.summary?.projectTotal ?? null,
    status: 'info' as const,
    icon: Building1Icon,
    route: projectListRoute.value,
    enabled: projectListRoute.value !== null,
  },
  {
    id: 'pending-documents',
    label: '待处理资料',
    value: overview.value.summary?.pendingDocuments ?? null,
    status: 'warning' as const,
    icon: FolderIcon,
    route: null,
    enabled: false,
  },
  {
    id: 'pending-review',
    label: '待复核数据',
    value: overview.value.summary?.pendingReviewData ?? null,
    status: 'default' as const,
    icon: DataCheckedIcon,
    route: null,
    enabled: false,
  },
  {
    id: 'report-tasks',
    label: '报告任务',
    value: overview.value.summary?.reportTasks ?? null,
    status: 'default' as const,
    icon: FileIcon,
    route: null,
    enabled: false,
  },
])

const priorityOrder: Record<AttentionPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
}
const sortedAttentionItems = computed(() =>
  [...overview.value.attentionItems].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]),
)
const highPriorityCount = computed(() =>
  overview.value.attentionItems.filter(item => item.priority === 'high').length,
)
const attentionTotal = computed(() => overview.value.attentionItems.length)
const welcomeReminder = computed(() => {
  if (attentionTotal.value > 0 && highPriorityCount.value > 0) {
    return `今天有 ${attentionTotal.value} 项业务需要关注，其中 ${highPriorityCount.value} 项需要优先处理。`
  }
  if (attentionTotal.value > 0) {
    return `今天有 ${attentionTotal.value} 项业务需要关注。`
  }
  return '这里是你最近的项目和业务进展。'
})

const PIPELINE_META: ReadonlyArray<{
  stage: KnowledgePipelineStage
  label: string
  status: 'default' | 'processing' | 'warning' | 'success' | 'error'
}> = [
  { stage: 'PENDING_PARSE', label: '待解析', status: 'default' },
  { stage: 'PARSING', label: '解析中', status: 'processing' },
  { stage: 'PENDING_REVIEW', label: '待复核', status: 'warning' },
  { stage: 'STORED', label: '已入库', status: 'success' },
  { stage: 'FAILED', label: '处理失败', status: 'error' },
]

const pipelineByStage = computed(() =>
  new Map(overview.value.knowledgePipeline.map(item => [item.stage, item])),
)
const pipelineTotal = computed(() =>
  overview.value.knowledgePipeline.reduce((sum, item) => sum + item.count, 0),
)

const recentProjects = computed(() => overview.value.recentProjects)
const recentActivities = computed(() => overview.value.recentActivities)

const trendOption = computed(() => {
  const points = overview.value.trend
  if (!points || points.length === 0) {
    return null
  }
  return createTrendOption({ points, tokens: tokens.value })
})

const taskDistributionOption = computed(() => {
  const items = overview.value.taskDistribution
  if (!items || items.length === 0) {
    return null
  }
  return createTaskDistributionOption({ items, tokens: tokens.value })
})

const taskDistributionFallback = computed(() => {
  const items = overview.value.taskDistribution
  if (!items || items.length === 0 || taskDistributionOption.value) {
    return null
  }
  return items.map(item => ({
    status: item.status,
    label: TASK_STATUS_LABELS[item.status],
    count: item.count,
  }))
})
const taskDistributionTotal = computed(() =>
  overview.value.taskDistribution?.reduce((sum, item) => sum + item.count, 0) ?? 0,
)

const fallbackBarOption = computed(() => {
  const items = taskDistributionFallback.value
  if (!items || items.length === 0) {
    return null
  }
  return createBarOption({
    categories: items.map(item => item.label),
    series: [{ name: '任务数', data: items.map(item => item.count) }],
    tokens: tokens.value,
    horizontal: true,
  })
})

function switchTrendRange(): void {
  // 后端聚合接口接入后在此按 trendRange 拉取趋势数据；当前保持空投影
}

function openShortcut(path: string | null): void {
  if (path) {
    void router.push(path)
  }
}

function openItemRoute(route: string | undefined, permission: string | undefined): void {
  if (permission && !userStore.hasPermission(permission)) {
    return
  }
  if (route) {
    void router.push(route)
  }
}

/** 事项带权限码时按 RBAC 裁剪，无权限码视为可见 */
function itemAccessible(permission: string | undefined): boolean {
  return !permission || userStore.hasPermission(permission)
}

function openProject(route: string | undefined): void {
  if (route) {
    void router.push(route)
  }
}

function openPipelineRoute(route: string | null): void {
  if (route) {
    void router.push(route)
  }
}
</script>

<template>
  <AppPage class="dashboard-page" title="工作台">
    <section class="dashboard-welcome">
      <div class="dashboard-welcome__intro">
        <h2>{{ greeting }}，{{ userName }}</h2>
        <p class="dashboard-welcome__reminder">
          {{ welcomeReminder }}
        </p>
        <p class="dashboard-welcome__meta">
          {{ todayText }} · {{ primaryDepartment }}
        </p>
      </div>

      <div v-if="shortcuts.length > 0" class="dashboard-welcome__shortcuts" aria-label="快捷操作">
        <t-button
          v-for="shortcut in shortcuts"
          :key="shortcut.id"
          class="dashboard-shortcut"
          theme="default"
          variant="outline"
          @click="openShortcut(shortcut.path)"
        >
          <span class="dashboard-shortcut__content">
            <strong>{{ shortcut.title }}</strong>
            <small>{{ shortcut.description }}</small>
          </span>
        </t-button>
      </div>
    </section>

    <section class="dashboard-metrics" aria-label="核心指标">
      <AppMetricCard
        v-for="metric in metrics"
        :key="metric.id"
        :clickable="metric.enabled"
        :icon="metric.icon"
        :label="metric.label"
        :loading="loading"
        :route="metric.route ?? undefined"
        :status="metric.status"
        :value="metric.value"
      />
    </section>

    <div class="dashboard-grid dashboard-grid--primary">
      <section class="dashboard-panel dashboard-panel--attention" aria-labelledby="attention-title">
        <header class="dashboard-panel__header">
          <div class="dashboard-panel__heading">
            <strong id="attention-title">待处理事项</strong>
            <span v-if="attentionTotal > 0">{{ attentionTotal }} 项待关注</span>
          </div>
        </header>

        <template v-if="sortedAttentionItems.length > 0">
          <ul class="attention-list">
            <li v-for="item in sortedAttentionItems" :key="item.id" class="attention-item">
              <span class="attention-item__priority" :class="`is-${item.priority}`" aria-hidden="true" />
              <span
                class="attention-item__main"
                role="button"
                :tabindex="itemAccessible(item.permission) ? 0 : undefined"
                :aria-disabled="!itemAccessible(item.permission)"
                @click="openItemRoute(item.route, item.permission)"
                @keydown.enter="openItemRoute(item.route, item.permission)"
              >
                <span class="attention-item__title">{{ item.title }}</span>
                <span v-if="item.description" class="attention-item__description">{{ item.description }}</span>
              </span>
              <span v-if="item.count !== undefined" class="attention-item__count">{{ item.count }}</span>
              <span v-if="item.time" class="attention-item__time">
                <TimeIcon />
                {{ item.time }}
              </span>
            </li>
          </ul>
        </template>
        <AppEmptyState
          v-else
          description="来自项目的待处理事项会显示在这里"
          size="small"
          title="当前没有需要处理的事项"
        />
      </section>

      <section class="dashboard-panel dashboard-panel--pipeline" aria-labelledby="pipeline-title">
        <header class="dashboard-panel__header">
          <div class="dashboard-panel__heading">
            <strong id="pipeline-title">资料处理状态</strong>
            <span v-if="pipelineTotal > 0">共 {{ pipelineTotal }} 份资料</span>
          </div>
        </header>

        <template v-if="pipelineTotal > 0">
          <ul class="pipeline-list">
            <li v-for="meta in PIPELINE_META" :key="meta.stage" class="pipeline-item">
              <span
                class="pipeline-item__main"
                role="button"
                :tabindex="pipelineByStage.get(meta.stage)?.route ? 0 : undefined"
                :aria-disabled="!pipelineByStage.get(meta.stage)?.route"
                @click="openPipelineRoute(pipelineByStage.get(meta.stage)?.route ?? null)"
                @keydown.enter="openPipelineRoute(pipelineByStage.get(meta.stage)?.route ?? null)"
              >
                <span class="pipeline-item__label">
                  <span class="pipeline-item__dot" :class="`is-${meta.status}`" aria-hidden="true" />
                  {{ meta.label }}
                </span>
                <strong>{{ pipelineByStage.get(meta.stage)?.count ?? 0 }}</strong>
              </span>
              <div class="pipeline-item__track" aria-hidden="true">
                <span
                  class="pipeline-item__fill"
                  :class="`is-${meta.status}`"
                  :style="{
                    width: pipelineTotal > 0
                      ? `${((pipelineByStage.get(meta.stage)?.count ?? 0) / pipelineTotal) * 100}%`
                      : '0%',
                  }"
                />
              </div>
            </li>
          </ul>
        </template>
        <AppEmptyState
          v-else
          description="知识资料的解析与入库状态会显示在这里"
          size="small"
          title="暂无资料处理数据"
        />
      </section>
    </div>

    <div class="dashboard-grid dashboard-grid--primary">
      <section class="dashboard-panel dashboard-panel--projects" aria-labelledby="recent-projects-title">
        <header class="dashboard-panel__header">
          <div class="dashboard-panel__heading">
            <strong id="recent-projects-title">最近项目</strong>
            <span v-if="recentProjects.length > 0">{{ recentProjects.length }} 个项目</span>
          </div>
          <t-button v-if="recentProjects.length > 0" size="small" theme="default" variant="text" @click="openShortcut(projectListRoute)">
            查看全部
          </t-button>
        </header>

        <template v-if="recentProjects.length > 0">
          <ul class="project-list">
            <li v-for="project in recentProjects" :key="project.id" class="project-item">
              <span
                class="project-item__main"
                role="button"
                :tabindex="project.route ? 0 : undefined"
                :aria-disabled="!project.route"
                @click="openProject(project.route)"
                @keydown.enter="openProject(project.route)"
              >
                <strong class="project-item__name">{{ project.name }}</strong>
                <span v-if="project.region" class="project-item__region">{{ project.region }}</span>
                <span class="project-item__meta">
                  <span v-if="project.stage">{{ project.stage }}</span>
                  <span v-if="project.ownerName">负责人：{{ project.ownerName }}</span>
                </span>
              </span>
              <div class="project-item__side">
                <span class="project-item__visibility" :class="`is-${project.visibility.toLowerCase()}`">
                  {{ project.visibility === 'PUBLIC' ? '公开' : '私有' }}
                </span>
                <span class="project-item__time">
                  <TimeIcon />
                  {{ project.updatedAt }}
                </span>
              </div>
            </li>
          </ul>
        </template>
        <AppEmptyState
          v-else
          description="你最近参与的项目会显示在这里"
          size="small"
          title="暂无最近项目"
        />
      </section>

      <section class="dashboard-panel dashboard-panel--activities" aria-labelledby="activities-title">
        <header class="dashboard-panel__header">
          <div class="dashboard-panel__heading">
            <strong id="activities-title">最近动态</strong>
          </div>
        </header>

        <template v-if="recentActivities.length > 0">
          <ul class="activity-list">
            <li v-for="activity in recentActivities" :key="activity.id" class="activity-item">
              <span
                class="activity-item__main"
                role="button"
                :tabindex="activity.route ? 0 : undefined"
                :aria-disabled="!activity.route"
                @click="openItemRoute(activity.route, undefined)"
                @keydown.enter="openItemRoute(activity.route, undefined)"
              >
                <span class="activity-item__actor">{{ activity.actor }}</span>
                <span class="activity-item__text">
                  {{ activity.action }}「{{ activity.objectName }}」
                </span>
              </span>
              <span class="activity-item__time">{{ activity.time }}</span>
            </li>
          </ul>
        </template>
        <AppEmptyState
          v-else
          description="解析完成、报告生成等操作动态会显示在这里"
          size="small"
          title="暂无动态"
        />
      </section>
    </div>

    <div class="dashboard-grid dashboard-grid--primary">
      <AppChartPanel
        class="dashboard-panel--trend"
        description="最近 7 天 / 30 天业务处理量"
        title="业务处理趋势"
      >
        <template #actions>
          <t-radio-group v-model="trendRange" size="small" variant="default-filled" @change="switchTrendRange">
            <t-radio-button value="7d">
              7 天
            </t-radio-button>
            <t-radio-button value="30d">
              30 天
            </t-radio-button>
          </t-radio-group>
        </template>
        <AppChart
          empty-description="接入统计接口后自动展示"
          empty-text="暂无趋势数据"
          height="var(--dashboard-chart-height, 300px)"
          :option="trendOption"
        />
      </AppChartPanel>

      <AppChartPanel
        class="dashboard-panel--distribution"
        description="待处理、处理中、已完成与失败任务"
        title="任务状态分布"
      >
        <AppChart
          v-if="taskDistributionOption"
          height="var(--dashboard-chart-height, 300px)"
          :option="taskDistributionOption"
        />
        <AppChart
          v-else-if="fallbackBarOption"
          height="var(--dashboard-chart-height, 300px)"
          :option="fallbackBarOption"
        />
        <AppChart
          v-else
          :empty-description="taskDistributionTotal === 0 ? '' : '当前任务数较少，不展示分布图'"
          :empty-text="taskDistributionTotal === 0 ? '暂无任务数据' : '暂无分布数据'"
          height="var(--dashboard-chart-height, 300px)"
          :option="null"
        />
      </AppChartPanel>
    </div>
  </AppPage>
</template>

<style scoped>
.dashboard-page {
  --dashboard-grid-gap: var(--vicp-page-gap);
  --dashboard-chart-height: 300px;
}

.dashboard-welcome {
  display: flex;
  min-width: 0;
  align-items: stretch;
  justify-content: space-between;
  gap: var(--td-size-6);
  padding: var(--vicp-panel-padding);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.dashboard-welcome__intro {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: var(--td-size-2);
}

.dashboard-welcome h2,
.dashboard-welcome p {
  margin: 0;
}

.dashboard-welcome h2 {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-large);
  font-weight: 600;
}

.dashboard-welcome__reminder {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
}

.dashboard-welcome__meta {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.dashboard-welcome__shortcuts {
  display: flex;
  min-width: 0;
  flex: 0 1 auto;
  align-items: stretch;
  justify-content: flex-end;
  gap: var(--td-size-3);
}

.dashboard-shortcut {
  width: 168px;
  height: auto;
  justify-content: space-between;
  padding: var(--td-size-3) var(--td-size-4);
  text-align: left;
}

.dashboard-shortcut__content {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  flex-direction: column;
  gap: var(--td-size-1);
}

.dashboard-shortcut__content strong {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
}

.dashboard-shortcut__content small {
  overflow: hidden;
  max-width: 100%;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-metrics {
  display: grid;
  gap: var(--dashboard-grid-gap);
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.dashboard-grid {
  display: grid;
  min-width: 0;
  gap: var(--dashboard-grid-gap);
  grid-template-columns: repeat(12, minmax(0, 1fr));
}

.dashboard-grid--primary > * {
  min-width: 0;
}

/* 桌面 12 栏：主模块占 8 栏，辅助模块占 4 栏 */
.dashboard-grid--primary :deep(.dashboard-panel--attention),
.dashboard-grid--primary :deep(.dashboard-panel--projects),
.dashboard-grid--primary :deep(.dashboard-panel--trend) {
  grid-column: span 8;
}

.dashboard-grid--primary :deep(.dashboard-panel--pipeline),
.dashboard-grid--primary :deep(.dashboard-panel--activities),
.dashboard-grid--primary :deep(.dashboard-panel--distribution) {
  grid-column: span 4;
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

.dashboard-panel__icon {
  color: var(--td-text-color-placeholder);
}

.dashboard-panel :deep(.app-empty-state) {
  min-height: calc(var(--vicp-state-min-height) - var(--td-size-10));
}

/* 待处理事项 */
.attention-list,
.pipeline-list,
.project-list,
.activity-list {
  display: flex;
  min-width: 0;
  margin: 0;
  padding: 0;
  flex-direction: column;
  list-style: none;
}

.attention-item {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-3);
  padding: var(--td-size-3) 0;
  border-bottom: 1px solid var(--td-component-stroke);
}

.attention-item:last-child {
  border-bottom: 0;
}

.attention-item__priority {
  width: var(--td-size-1);
  height: var(--td-size-4);
  flex: 0 0 auto;
  border-radius: var(--td-radius-round);
  background: var(--td-gray-color-4);
}

.attention-item__priority.is-high {
  background: var(--td-error-color);
}

.attention-item__priority.is-medium {
  background: var(--td-warning-color);
}

.attention-item__priority.is-low {
  background: var(--td-success-color);
}

.attention-item__main {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: flex-start;
  flex-direction: column;
  gap: var(--td-size-1);
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.attention-item__main[aria-disabled='true'] {
  cursor: default;
}

.attention-item__title {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
}

.attention-item__main:not([aria-disabled='true']):hover .attention-item__title {
  color: var(--td-brand-color);
}

.attention-item__description {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.attention-item__count {
  flex: 0 0 auto;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
  font-weight: 600;
}

.attention-item__time {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--td-size-1);
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}

/* 资料处理状态 */
.pipeline-item {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-2);
  padding: var(--td-size-2) 0;
}

.pipeline-item__main {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-3);
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.pipeline-item__main[aria-disabled='true'] {
  cursor: default;
}

.pipeline-item__label {
  display: inline-flex;
  align-items: center;
  gap: var(--td-size-2);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-medium);
}

.pipeline-item__main:not([aria-disabled='true']):hover .pipeline-item__label {
  color: var(--td-brand-color);
}

.pipeline-item__dot {
  width: var(--td-size-2);
  height: var(--td-size-2);
  flex: 0 0 auto;
  border-radius: var(--td-radius-circle);
  background: var(--td-gray-color-4);
}

.pipeline-item__dot.is-processing {
  background: var(--td-brand-color);
}

.pipeline-item__dot.is-warning {
  background: var(--td-warning-color);
}

.pipeline-item__dot.is-success {
  background: var(--td-success-color);
}

.pipeline-item__dot.is-error {
  background: var(--td-error-color);
}

.pipeline-item__main strong {
  color: var(--td-text-color-primary);
  font-weight: 600;
}

.pipeline-item__track {
  overflow: hidden;
  width: 100%;
  height: var(--td-size-2);
  border-radius: var(--td-radius-round);
  background: var(--td-bg-color-secondarycontainer);
}

.pipeline-item__fill {
  display: block;
  height: 100%;
  border-radius: var(--td-radius-round);
  background: var(--td-gray-color-4);
  transition: width 0.2s ease;
}

.pipeline-item__fill.is-processing {
  background: var(--td-brand-color);
}

.pipeline-item__fill.is-warning {
  background: var(--td-warning-color);
}

.pipeline-item__fill.is-success {
  background: var(--td-success-color);
}

.pipeline-item__fill.is-error {
  background: var(--td-error-color);
}

/* 最近项目 */
.project-item {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-4);
  padding: var(--td-size-3) 0;
  border-bottom: 1px solid var(--td-component-stroke);
}

.project-item:last-child {
  border-bottom: 0;
}

.project-item__main {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: flex-start;
  flex-direction: column;
  gap: var(--td-size-1);
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.project-item__main[aria-disabled='true'] {
  cursor: default;
}

.project-item__name {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
  font-weight: 600;
}

.project-item__main:not([aria-disabled='true']):hover .project-item__name {
  color: var(--td-brand-color);
}

.project-item__region {
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}

.project-item__meta {
  display: inline-flex;
  align-items: center;
  gap: var(--td-size-3);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.project-item__side {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-end;
  flex-direction: column;
  gap: var(--td-size-1);
}

.project-item__visibility {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.project-item__visibility.is-public {
  color: var(--td-success-color);
}

.project-item__visibility.is-private {
  color: var(--td-warning-color);
}

.project-item__time {
  display: inline-flex;
  align-items: center;
  gap: var(--td-size-1);
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}

/* 最近动态 */
.activity-item {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-3);
  padding: var(--td-size-3) 0;
  border-bottom: 1px solid var(--td-component-stroke);
}

.activity-item:last-child {
  border-bottom: 0;
}

.activity-item__main {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: baseline;
  gap: var(--td-size-2);
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.activity-item__main[aria-disabled='true'] {
  cursor: default;
}

.activity-item__actor {
  flex: 0 0 auto;
  color: var(--td-text-color-primary);
  font-weight: 600;
}

.activity-item__text {
  overflow: hidden;
  min-width: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-item__main:not([aria-disabled='true']):hover .activity-item__text {
  color: var(--td-brand-color);
}

.activity-item__time {
  flex: 0 0 auto;
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}

/* 响应式：桌面 12 栏 → 平板 → 移动端 */
@media (max-width: 1280px) {
  .dashboard-welcome {
    flex-direction: column;
    gap: var(--td-size-5);
  }

  .dashboard-welcome__shortcuts {
    justify-content: flex-start;
  }

  /* 平板：待办、项目与图表全宽，资料状态与最近动态两列 */
  .dashboard-grid--primary :deep(.dashboard-panel--attention),
  .dashboard-grid--primary :deep(.dashboard-panel--projects),
  .dashboard-grid--primary :deep(.dashboard-panel--trend),
  .dashboard-grid--primary :deep(.dashboard-panel--distribution) {
    grid-column: span 12;
  }

  .dashboard-grid--primary :deep(.dashboard-panel--pipeline),
  .dashboard-grid--primary :deep(.dashboard-panel--activities) {
    grid-column: span 6;
  }
}

@media (max-width: 960px) {
  .dashboard-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .dashboard-page {
    --dashboard-chart-height: 240px;
  }

  .dashboard-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dashboard-welcome__shortcuts {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: var(--td-size-2);
  }

  .dashboard-shortcut {
    width: 148px;
    flex: 0 0 auto;
  }

  /* 移动端：全部单列 */
  .dashboard-grid--primary :deep(.dashboard-panel--attention),
  .dashboard-grid--primary :deep(.dashboard-panel--pipeline),
  .dashboard-grid--primary :deep(.dashboard-panel--projects),
  .dashboard-grid--primary :deep(.dashboard-panel--activities),
  .dashboard-grid--primary :deep(.dashboard-panel--trend),
  .dashboard-grid--primary :deep(.dashboard-panel--distribution) {
    grid-column: span 12;
  }

  /* 最近项目转为纵向卡片 */
  .project-item {
    align-items: flex-start;
    flex-direction: column;
    gap: var(--td-size-2);
    padding: var(--td-size-3);
    border: 1px solid var(--td-component-stroke);
    border-bottom: 1px solid var(--td-component-stroke);
    border-radius: var(--vicp-radius);
  }

  .project-item + .project-item {
    margin-top: var(--td-size-3);
  }

  .project-item:last-child {
    border-bottom: 1px solid var(--td-component-stroke);
  }

  .project-item__side {
    align-items: flex-start;
    flex-direction: row;
    gap: var(--td-size-4);
  }

  .activity-item {
    align-items: flex-start;
    flex-direction: column;
    gap: var(--td-size-1);
  }
}
</style>

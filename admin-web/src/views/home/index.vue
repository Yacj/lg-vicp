<script setup lang="ts">
import type { KnowledgeParsingJob } from '@/types/knowledge'
import type { MenuNavigationTarget } from '@/types/menu'
import type { ProjectItem } from '@/types/project'
import type { ReportCenterRow } from '@/types/report'
import { TimeIcon } from 'tdesign-icons-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetchKnowledgeDocuments, fetchKnowledgeParsingJobs } from '@/api/modules/knowledge'
import { fetchMyProjects } from '@/api/modules/projects'
import { fetchPlatformReportCenter } from '@/api/modules/reports'
import { fetchReviewQueue } from '@/api/modules/review-center'
import { AppEmptyState, AppPage, AppStatusTag } from '@/components/ui'
import { navigateMenuTarget } from '@/router/dynamic-routes'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { useRouteStore } from '@/stores/route'
import { useUserStore } from '@/stores/user'
import {
  formatToday,
  getGreeting,
  limitShortcuts,
  pickRecentReports,
  projectAvailableShortcuts,
  projectTodoCards,
} from './dashboard'
import type { TodoCategoryInput } from './dashboard'
import { formatDate } from '@/utils/day'
import { getReportTypeLabel, reportStateMeta } from '@/utils/report'

defineOptions({ name: 'Home' })

const router = useRouter()
const routeStore = useRouteStore()
const userStore = useUserStore()
const { canAccess } = usePermissionAccess()

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

// ===== 我的待办：知识资料 / 产品数据 / 标准指标 / 报告 / 统一审核（隐藏队列） =====

const knowledgeNeedsActionTotal = ref<number | null>(null)
const reviewPendingTotal = ref<number | null>(null)

const todoCategories = computed<TodoCategoryInput[]>(() => [
  {
    count: knowledgeNeedsActionTotal.value,
    description: '需要处理的资料内容与解析任务',
    id: 'knowledge',
    label: '知识资料',
    paths: ['/knowledge/documents'],
  },
  {
    description: '产品系列、规格、参数与材料数据',
    id: 'product',
    label: '产品数据',
    paths: ['/products/series', '/masterdata/materials'],
  },
  {
    description: '标准文件与结构化节能指标',
    id: 'standard',
    label: '标准指标',
    paths: ['/standard/documents', '/standard/indicators'],
  },
  {
    description: '项目报告成果与模板报告记录',
    id: 'reports',
    label: '报告',
    paths: ['/reports'],
  },
  {
    count: reviewPendingTotal.value,
    description: '产品数据、标准指标与报告的审核决议',
    id: 'review',
    label: '统一审核',
    paths: ['/review-center/queue'],
  },
])

const todoCards = computed(() => projectTodoCards(todoCategories.value, canNavigate))

function todoCountText(count: number | null): string {
  if (count === null) {
    return ''
  }
  return count > 0 ? `${count} 项待处理` : '暂无待处理'
}

async function loadTodoCounts(): Promise<void> {
  if (canAccess({ permissions: ['system:knowledge:doc:list'] })) {
    try {
      const result = await fetchKnowledgeDocuments({ page: 1, pageSize: 1, healthStatus: 'NEEDS_ACTION' })
      knowledgeNeedsActionTotal.value = result.total
    }
    catch {
      knowledgeNeedsActionTotal.value = null
    }
  }
  if (canAccess({ permissions: ['system:review:list'] })) {
    try {
      const result = await fetchReviewQueue({ page: 1, pageSize: 1, status: 'PENDING_REVIEW' })
      reviewPendingTotal.value = result.total
    }
    catch {
      reviewPendingTotal.value = null
    }
  }
}

function openTodoCard(card: { target: MenuNavigationTarget | null }): void {
  if (card.target) {
    navigateMenuTarget(card.target, router)
  }
}

// ===== 最近项目（我的项目列表）与最近报告（平台报告成果聚合） =====

const recentProjects = ref<ProjectItem[] | null>(null)

async function loadRecentProjects(): Promise<void> {
  try {
    const result = await fetchMyProjects({ page: 1, pageSize: 5 })
    recentProjects.value = [...result.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  catch {
    recentProjects.value = []
  }
}

function openProject(project: ProjectItem): void {
  void router.push(`/projects/${encodeURIComponent(project.id)}`)
}

const recentReports = ref<ReportCenterRow[] | null>(null)
const canAggregateReports = computed(() => canAccess({ permissions: ['system:project:list'] }))

async function loadRecentReports(): Promise<void> {
  if (!canAggregateReports.value) {
    recentReports.value = []
    return
  }
  const projects = (recentProjects.value ?? []).slice(0, 3)
  if (projects.length === 0) {
    recentReports.value = []
    return
  }
  const results = await Promise.all(projects.map(project =>
    fetchPlatformReportCenter(project.id)
      .then(result => result.items)
      .catch(() => [] as ReportCenterRow[])))
  recentReports.value = pickRecentReports(results.flat())
}

function openReport(report: ReportCenterRow): void {
  void router.push(`/reports/${encodeURIComponent(report.id)}`)
}

// ===== 资料异常（知识解析失败任务，隐藏入口按权限可达） =====

const parsingFailures = ref<KnowledgeParsingJob[] | null>(null)
const parsingFailureTotal = ref(0)
const parsingJobsPath = '/knowledge/parsing-jobs'
const parsingJobsReachable = computed(() => canNavigate(parsingJobsPath))

async function loadParsingFailures(): Promise<void> {
  if (!parsingJobsReachable.value) {
    parsingFailures.value = []
    return
  }
  try {
    const result = await fetchKnowledgeParsingJobs({ page: 1, pageSize: 5, status: 'FAILED' })
    parsingFailures.value = result.items
    parsingFailureTotal.value = result.total
  }
  catch {
    parsingFailures.value = []
  }
}

const JOB_TYPE_LABELS: Record<KnowledgeParsingJob['jobType'], string> = {
  CHUNK_REBUILD: '分块重建',
  OCR: 'OCR 识别',
  PARSE: '文档解析',
  REPARSE: '重新解析',
}

function openPath(path: string): void {
  void router.push(path)
}

onMounted(() => {
  void loadTodoCounts()
  void loadParsingFailures()
  void loadRecentProjects().then(() => {
    void loadRecentReports()
  })
})
</script>

<template>
  <AppPage class="dashboard-page" title="工作台">
    <section class="dashboard-welcome">
      <div class="dashboard-welcome__intro">
        <h2>{{ greeting }}，{{ userName }}</h2>
        <p class="dashboard-welcome__reminder">
          待办、项目与报告的最新进展都汇总在这里。
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
          @click="openTodoCard(shortcut)"
        >
          <span class="dashboard-shortcut__content">
            <strong>{{ shortcut.title }}</strong>
            <small>{{ shortcut.description }}</small>
          </span>
        </t-button>
      </div>
    </section>

    <section class="dashboard-panel" aria-labelledby="todo-title">
      <header class="dashboard-panel__header">
        <div class="dashboard-panel__heading">
          <strong id="todo-title">我的待办</strong>
          <span>按知识资料、产品数据、标准指标与报告分类，入口随菜单权限显示</span>
        </div>
      </header>

      <div v-if="todoCards.length > 0" class="dashboard-todo-grid">
        <t-button
          v-for="card in todoCards"
          :key="card.id"
          block
          class="dashboard-todo-card"
          theme="default"
          variant="outline"
          @click="openTodoCard(card)"
        >
          <span class="dashboard-todo-card__inner">
            <span class="dashboard-todo-card__head">
              <strong class="dashboard-todo-card__label">{{ card.label }}</strong>
              <span v-if="todoCountText(card.count)" class="dashboard-todo-card__count">
                {{ todoCountText(card.count) }}
              </span>
            </span>
            <span class="dashboard-todo-card__description">{{ card.description }}</span>
          </span>
        </t-button>
      </div>
      <AppEmptyState
        v-else
        description="待办分类入口按菜单权限显示，授权后自动出现"
        size="small"
        title="暂无可进入的待办分类"
      />
    </section>

    <div class="dashboard-grid dashboard-grid--primary">
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
                    {{ project.visibility === 'PUBLIC' ? '公开' : '私有' }}
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

      <section class="dashboard-panel dashboard-panel--reports" aria-labelledby="recent-reports-title">
        <header class="dashboard-panel__header">
          <div class="dashboard-panel__heading">
            <strong id="recent-reports-title">最近报告</strong>
          </div>
          <t-button
            v-if="canNavigate('/reports')"
            size="small"
            theme="default"
            variant="text"
            @click="openPath('/reports')"
          >
            报告管理
          </t-button>
        </header>

        <t-loading :loading="recentReports === null" size="small" text="正在加载最近报告">
          <template v-if="recentReports && recentReports.length > 0">
            <ul class="dashboard-line-list">
              <li v-for="report in recentReports" :key="report.id" class="dashboard-line-item">
                <t-button
                  class="dashboard-line-item__main"
                  theme="default"
                  variant="text"
                  @click="openReport(report)"
                >
                  <strong>{{ getReportTypeLabel(report.reportType) }}</strong>
                  <span class="dashboard-line-item__meta">
                    {{ report.projectName }} · {{ report.conversationTitle || '未关联会话' }}
                  </span>
                </t-button>
                <span class="dashboard-line-item__side">
                  <AppStatusTag
                    :label="reportStateMeta(report).label"
                    :status="reportStateMeta(report).status"
                  />
                  <span class="dashboard-line-item__time">
                    <TimeIcon />
                    {{ formatDate(new Date(report.updatedAt)) }}
                  </span>
                </span>
              </li>
            </ul>
          </template>
          <AppEmptyState
            v-else-if="recentReports && !canAggregateReports"
            description="报告按项目聚合展示，可进入报告管理按项目查看"
            size="small"
            title="暂无报告概览"
          />
          <AppEmptyState
            v-else-if="recentReports"
            description="在 AI 会话中生成报告后，最近成果会显示在这里"
            size="small"
            title="暂无最近报告"
          />
        </t-loading>
      </section>
    </div>

    <div class="dashboard-grid dashboard-grid--primary">
      <section class="dashboard-panel dashboard-panel--anomalies" aria-labelledby="anomalies-title">
        <header class="dashboard-panel__header">
          <div class="dashboard-panel__heading">
            <strong id="anomalies-title">资料异常</strong>
            <span v-if="parsingJobsReachable && parsingFailureTotal > 0">
              共 {{ parsingFailureTotal }} 条解析失败
            </span>
          </div>
          <t-button
            v-if="parsingJobsReachable"
            size="small"
            theme="default"
            variant="text"
            @click="openPath(parsingJobsPath)"
          >
            解析任务
          </t-button>
        </header>

        <t-loading :loading="parsingFailures === null" size="small" text="正在加载资料异常">
          <template v-if="parsingFailures && parsingFailures.length > 0">
            <ul class="dashboard-line-list">
              <li v-for="job in parsingFailures" :key="job.id" class="dashboard-line-item">
                <span class="dashboard-line-item__main is-static">
                  <strong>{{ job.document?.title || '未知文档' }}</strong>
                  <span class="dashboard-line-item__meta">
                    {{ JOB_TYPE_LABELS[job.jobType] }} · {{ job.errorMessage || '解析失败' }}
                  </span>
                </span>
                <span class="dashboard-line-item__time">
                  <TimeIcon />
                  {{ formatDate(new Date(job.finishedAt ?? job.createdAt)) }}
                </span>
              </li>
            </ul>
          </template>
          <AppEmptyState
            v-else-if="parsingFailures"
            description="知识资料解析失败任务会显示在这里"
            size="small"
            title="暂无资料异常"
          />
        </t-loading>
      </section>
    </div>
  </AppPage>
</template>

<style scoped>
.dashboard-page {
  --dashboard-grid-gap: var(--vicp-page-gap);
}

.dashboard-welcome,
.dashboard-panel {
  min-width: 0;
  padding: var(--vicp-panel-padding);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.dashboard-welcome {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: var(--td-size-6);
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

.dashboard-panel {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-4);
}

.dashboard-panel__header,
.dashboard-todo-card__head,
.dashboard-line-item,
.dashboard-line-item__side,
.dashboard-line-item__time {
  display: flex;
  min-width: 0;
  align-items: center;
}

.dashboard-panel__header,
.dashboard-todo-card__head,
.dashboard-line-item {
  justify-content: space-between;
}

.dashboard-panel__header {
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

.dashboard-todo-grid {
  display: grid;
  min-width: 0;
  gap: var(--td-size-3);
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.dashboard-todo-card {
  height: auto;
  min-width: 0;
  padding: var(--td-size-4);
  border-radius: var(--vicp-radius);
  text-align: left;
  white-space: normal;
}

.dashboard-todo-card__inner {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: var(--td-size-2);
  text-align: left;
}

.dashboard-todo-card__head {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-3);
}

.dashboard-todo-card__label {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
}

.dashboard-todo-card:hover .dashboard-todo-card__label {
  color: var(--td-brand-color);
}

.dashboard-todo-card__count {
  flex: 0 0 auto;
  color: var(--td-warning-color);
  font-size: var(--td-font-size-body-small);
}

.dashboard-todo-card__description,
.dashboard-line-item__meta,
.dashboard-line-item__time {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.dashboard-grid {
  display: grid;
  min-width: 0;
  gap: var(--dashboard-grid-gap);
  grid-template-columns: repeat(12, minmax(0, 1fr));
}

.dashboard-grid > * {
  min-width: 0;
}

.dashboard-panel--projects {
  grid-column: span 7;
}

.dashboard-panel--anomalies {
  grid-column: span 12;
}

.dashboard-panel--reports {
  grid-column: span 5;
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

.dashboard-line-item__main.is-static {
  cursor: default;
}

.dashboard-line-item__main strong {
  overflow: hidden;
  max-width: 100%;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-line-item__main:not(.is-static):hover strong {
  color: var(--td-brand-color);
}

.dashboard-line-item__meta {
  overflow: hidden;
  max-width: 100%;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-line-item__side {
  flex: 0 0 auto;
  align-items: flex-end;
  flex-direction: column;
  gap: var(--td-size-1);
}

.dashboard-line-item__time {
  flex: 0 0 auto;
  gap: var(--td-size-1);
  white-space: nowrap;
}

.dashboard-panel :deep(.app-empty-state) {
  min-height: calc(var(--vicp-state-min-height) - var(--td-size-10));
}

@media (max-width: 1100px) {
  .dashboard-welcome {
    flex-direction: column;
  }

  .dashboard-welcome__shortcuts {
    justify-content: flex-start;
  }

  .dashboard-panel--projects,
  .dashboard-panel--reports,
  .dashboard-panel--anomalies {
    grid-column: span 12;
  }
}

@media (max-width: 640px) {
  .dashboard-welcome__shortcuts {
    overflow-x: auto;
    justify-content: flex-start;
    padding-bottom: var(--td-size-2);
  }

  .dashboard-shortcut {
    width: 148px;
    flex: 0 0 auto;
  }

  .dashboard-todo-grid {
    grid-template-columns: 1fr;
  }

  .dashboard-line-item {
    align-items: flex-start;
    flex-direction: column;
    gap: var(--td-size-2);
  }

  .dashboard-line-item__side {
    align-items: center;
    flex-direction: row;
  }
}
</style>

<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { ArrowLeftIcon } from 'tdesign-icons-vue-next'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppTableActions from '@/components/business/AppTableActions.vue'
import ProjectConversationDetailDrawer from '@/components/business/ProjectConversationDetailDrawer.vue'
import ProjectAiMemoryPanel from '@/components/business/ProjectAiMemoryPanel.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppErrorState from '@/components/ui/AppErrorState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useProjectDetail } from '@/composables/useProjectDetail'
import { useCrudDelete } from '@/composables/useCrudActions'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { deletePlatformProject } from '@/api/modules/projects'
import type { AppTableAction } from '@/types/crud'
import type { ProjectItem } from '@/types/project'
import type { ProjectConversation, ProjectAuditLog } from '@/types/project'
import {
  formatProjectVisibilityScope,
  isProjectManager,
  projectStatusMeta,
  projectVisibilityMeta,
} from '@/utils/project'
import { useUserStore } from '@/stores/user'
import { getAiSceneLabel } from '@/utils/ai'
import { formatDate } from '@/utils/day'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const projectId = computed(() => (typeof route.params.id === 'string' ? route.params.id : null))

const {
  auditList,
  conversationsList,
  detail,
  detailError,
  detailStatus,
  reloadDetail,
  tabs,
} = useProjectDetail(projectId)

const activeTab = ref<string>('overview')
const currentProject = computed(() => detail.value)
const isManager = computed(() => currentProject.value
  ? isProjectManager(currentProject.value, userStore.profile?.id ?? null, userStore.isSuperAdmin)
  : false)

const deleteAction = useCrudDelete<ProjectItem, { message: string }>({
  action: project => deletePlatformProject(project.id),
  confirm: project => ({
    content: `确认删除项目“${project.name}”吗？删除后无法恢复。`,
    confirmText: '删除',
    danger: true,
    title: '删除项目',
  }),
  onSuccess: async () => {
    await router.push('/projects')
  },
  successMessage: (_project, result) => result.message,
})

const errorDescription = computed(() => detailError.value
  ? normalizeFeedbackError(detailError.value).message
  : '项目不存在或无权查看')

const conversationDetailVisible = ref(false)
const activeConversation = ref<ProjectConversation | null>(null)

function openConversationDetail(row: TableRowData): void {
  activeConversation.value = row as ProjectConversation
  conversationDetailVisible.value = true
}

function conversationActions(row: TableRowData): AppTableAction[] {
  return [{
    handler: () => openConversationDetail(row),
    key: 'detail',
    label: '对话详情',
  }]
}

const conversationColumns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => (row as ProjectConversation).title || '未命名会话',
    colKey: 'title',
    minWidth: 200,
    title: '会话标题',
  },
  {
    cell: (_h, { row }) => getAiSceneLabel((row as ProjectConversation).scene),
    colKey: 'scene',
    title: '场景',
    width: 120,
  },
  {
    cell: (_h, { row }) => String((row as ProjectConversation).messageCount),
    colKey: 'messageCount',
    title: '消息数',
    width: 90,
  },
  {
    cell: (_h, { row }) => formatDate(new Date((row as ProjectConversation).updatedAt)),
    colKey: 'updatedAt',
    title: '更新时间',
    width: 170,
  },
]

const auditColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'action', minWidth: 180, title: '动作' },
  { colKey: 'actorUserId', minWidth: 200, title: '操作人 ID' },
  { colKey: 'targetType', title: '目标类型', width: 110 },
  { colKey: 'ip', title: '请求 IP', width: 140 },
  {
    cell: (_h, { row }) => formatDate(new Date((row as ProjectAuditLog).createdAt)),
    colKey: 'createdAt',
    title: '操作时间',
    width: 170,
  },
]

function goBack(): void {
  void router.push('/projects')
}
</script>

<template>
  <AppPage
    :title="currentProject?.name ?? '项目详情'"
    :description="currentProject?.description ?? ''"
  >
    <template #navigation>
      <t-button variant="text" @click="goBack">
        <template #icon>
          <ArrowLeftIcon />
        </template>
        返回项目列表
      </t-button>
    </template>

    <template #actions>
      <template v-if="currentProject">
        <AppStatusTag
          :label="projectVisibilityMeta(currentProject.visibility).label"
          :status="projectVisibilityMeta(currentProject.visibility).status"
        />
        <AppStatusTag
          :label="projectStatusMeta(currentProject.status).label"
          :status="projectStatusMeta(currentProject.status).status"
        />
      </template>
      <template v-if="isManager">
        <t-button theme="danger" variant="outline" @click="deleteAction.run(currentProject!)">
          删除
        </t-button>
      </template>
    </template>

    <AppErrorState
      v-if="detailStatus === 'error'"
      :description="errorDescription"
      title="项目加载失败"
      @action="reloadDetail"
    />

    <template v-else-if="detailStatus === 'ready' && currentProject">
      <!-- <nav aria-label="项目任务入口" class="project-task-grid">
        <t-button
          v-for="entry in taskEntries"
          :key="entry.key"
          block
          class="project-task-card"
          theme="default"
          variant="outline"
          @click="openTaskEntry(entry)"
        >
          <span class="project-task-card__inner">
            <strong class="project-task-card__label">{{ entry.label }}</strong>
            <span class="project-task-card__description">{{ entry.description }}</span>
          </span>
        </t-button>
      </nav> -->

      <t-tabs v-model="activeTab" class="project-detail-tabs !bg-transparent">
        <t-tab-panel
          v-for="tab in tabs"
          :key="tab.key"
          :label="tab.label"
          :value="tab.key"
        >
          <!-- 项目概况 -->
          <section v-if="tab.key === 'overview'" class="project-overview mt-3">
            <t-card title="项目概况">
              <t-descriptions bordered :column="2" size="medium">
                <t-descriptions-item label="项目名称">{{ currentProject.name }}</t-descriptions-item>
                <t-descriptions-item label="创建用户">
                  {{ currentProject.createdByName || '—' }}
                </t-descriptions-item>
                <t-descriptions-item label="所属部门">
                  {{ currentProject.ownerDepartmentName || '—' }}
                </t-descriptions-item>
                <t-descriptions-item label="可见范围">
                  {{ formatProjectVisibilityScope(currentProject) }}
                </t-descriptions-item>
                <t-descriptions-item label="状态">
                  {{ projectStatusMeta(currentProject.status).label }}
                </t-descriptions-item>
                <t-descriptions-item label="项目地区">
                  {{ currentProject.region || '未填写' }}
                </t-descriptions-item>
                <t-descriptions-item label="建筑类型">
                  {{ currentProject.buildingType || '未填写' }}
                </t-descriptions-item>
                <t-descriptions-item label="创建时间">
                  {{ formatDate(new Date(currentProject.createdAt)) }}
                </t-descriptions-item>
                <t-descriptions-item label="更新时间">
                  {{ formatDate(new Date(currentProject.updatedAt)) }}
                </t-descriptions-item>
                <t-descriptions-item label="项目描述" :span="2">
                  {{ currentProject.description || '暂无描述' }}
                </t-descriptions-item>
              </t-descriptions>
            </t-card>
          </section>

          <!-- AI 会话 -->
          <section v-else-if="tab.key === 'conversations'" class="project-conversations mt-3">
            <AppDataTable
              :columns="conversationColumns"
              :current="conversationsList.current.value"
              :data="conversationsList.data.value"
              empty-description="该项目尚未关联 AI 会话"
              empty-title="暂无 AI 会话"
              :error-description="conversationsList.error.value
                ? normalizeFeedbackError(conversationsList.error.value).message
                : '请检查网络连接后重试'"
              :operations-width="120"
              :page-size="conversationsList.pageSize.value"
              row-key="id"
              :status="conversationsList.tableStatus.value"
              :total="conversationsList.total.value"
              @page-change="conversationsList.changePage"
              @refresh="conversationsList.refresh"
              @retry="conversationsList.retry"
            >
              <template #operations="{ row }">
                <AppTableActions :actions="conversationActions(row)" />
              </template>
            </AppDataTable>
          </section>

          <section v-else-if="tab.key === 'reports'" class="project-reports mt-3">
            <t-card title="报告">
              <p class="project-reports__hint">项目报告成果在报告管理中查看、发布与下载。</p>
              <t-button theme="primary" variant="outline" @click="router.push(`/reports?projectId=${encodeURIComponent(currentProject.id)}`)">
                打开报告管理
              </t-button>
            </t-card>
          </section>

          <!-- AI 记忆 -->
          <section v-else-if="tab.key === 'memory'" class="project-conversations mt-3">
            <ProjectAiMemoryPanel
              :can-manage="isManager"
              :project-id="currentProject.id"
            />
          </section>

          <!-- 操作记录 -->
          <section v-else-if="tab.key === 'audit'" class="project-audit mt-3">
            <AppDataTable
              :columns="auditColumns"
              :current="auditList.current.value"
              :data="auditList.data.value"
              empty-description="该项目暂无操作记录"
              empty-title="暂无操作记录"
              :error-description="auditList.error.value
                ? normalizeFeedbackError(auditList.error.value).message
                : '请检查网络连接后重试'"
              :page-size="auditList.pageSize.value"
              row-key="id"
              :status="auditList.tableStatus.value"
              :total="auditList.total.value"
              @page-change="auditList.changePage"
              @refresh="auditList.refresh"
              @retry="auditList.retry"
            />
          </section>
        </t-tab-panel>
      </t-tabs>
    </template>

    <template v-else-if="detailStatus === 'loading'">
      <div class="project-detail-loading">
        <t-loading size="large" text="正在加载项目详情" />
      </div>
    </template>

    <ProjectConversationDetailDrawer
      v-model:visible="conversationDetailVisible"
      :conversation-id="activeConversation?.id ?? null"
      :title="activeConversation?.title"
    />
  </AppPage>
</template>

<style scoped>
.project-detail-tabs {
  min-width: 0;
}

/* 任务入口：高密度白色卡片，悬停品牌色描边 */
.project-task-grid {
  display: grid;
  gap: var(--td-size-3);
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}

.project-task-card {
  height: auto;
  min-width: 0;
  padding: var(--vicp-panel-padding);
  border-radius: var(--vicp-radius);
  text-align: left;
  white-space: normal;
}

.project-task-card__inner {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: var(--td-size-1);
  text-align: left;
}

.project-task-card__label {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
  font-weight: 600;
}

.project-task-card:hover .project-task-card__label {
  color: var(--td-brand-color);
}

.project-task-card__description {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

/* 移动端 Tabs 横向滚动 */
.project-detail-tabs :deep(.t-tabs__nav-container) {
  overflow-x: auto;
}

.project-files,
.project-conversations,
.project-audit {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--vicp-page-gap);
}

  .project-files__uploader {
  min-width: 0;
}

.project-detail-loading {
  display: grid;
  min-height: var(--vicp-state-min-height);
  place-content: center;
}
</style>
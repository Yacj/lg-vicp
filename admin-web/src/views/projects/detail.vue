<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { ArrowLeftIcon } from 'tdesign-icons-vue-next'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppErrorState from '@/components/ui/AppErrorState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useProjectDetail } from '@/composables/useProjectDetail'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { useCrudDrawer } from '@/composables/useCrudDrawer'
import { useConfirmedCrudAction, useCrudDelete } from '@/composables/useCrudActions'
import { useAppFeedback, normalizeFeedbackError } from '@/composables/useAppFeedback'
import { createProject, updateProject, updateProjectVisibility, deleteProject } from '@/api/modules/projects'
import type { ProjectForm } from '@/composables/useProjectCenter'
import type { ProjectItem, ProjectMutationResult, ProjectVisibility } from '@/types/project'
import type { ProjectConversation, ProjectAuditLog } from '@/types/project'
import {
  isProjectManager,
  projectStatusMeta,
  projectTaskEntries,
  projectVisibilityMeta,
} from '@/utils/project'
import type { ProjectTaskEntry } from '@/utils/project'
import { useUserStore } from '@/stores/user'
import { formatDate } from '@/utils/day'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const feedback = useAppFeedback()
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

// ---- 任务入口（基本信息 / 项目条件 / 智能计算 / 方案选择 / 材料对比 / 节点方案 / 报告）----

const { canAccess } = usePermissionAccess()

function canNavigate(path: string): boolean {
  const resolved = router.resolve(path)
  return resolved.matched.length > 0 && resolved.name !== 'NotFound'
}

/** 任务入口按领域权限码与路由可达性裁剪；权限不足或路由未注册时不展示，不渲染死入口 */
const taskEntries = computed<ProjectTaskEntry[]>(() => {
  if (!currentProject.value) {
    return []
  }
  return projectTaskEntries(currentProject.value).filter((entry) => {
    if (!canAccess({ permissions: entry.permissions })) {
      return false
    }
    return entry.route === null || canNavigate(entry.route)
  })
})

function openTaskEntry(entry: ProjectTaskEntry): void {
  if (entry.route) {
    void router.push(entry.route)
    return
  }
  if (entry.tabKey) {
    activeTab.value = entry.tabKey
  }
}

const formRules: FormRules<ProjectForm> = {
  name: [
    { message: '请输入项目名称', required: true },
    { max: 120, message: '项目名称不能超过 120 个字符' },
  ],
  description: [{ max: 2000, message: '项目描述不能超过 2000 个字符' }],
  region: [{ max: 80, message: '地区不能超过 80 个字符' }],
  buildingType: [{ max: 80, message: '建筑类型不能超过 80 个字符' }],
}

function createProjectForm(): ProjectForm {
  return { buildingType: '', description: '', name: '', region: '', visibility: 'PRIVATE' }
}

function editProjectForm(project: ProjectItem): ProjectForm {
  return {
    buildingType: project.buildingType ?? '',
    description: project.description ?? '',
    name: project.name,
    region: project.region ?? '',
    visibility: project.visibility,
  }
}

const projectDrawer = useCrudDrawer<ProjectForm, ProjectItem, ProjectMutationResult>({
  createForm: createProjectForm,
  editForm: editProjectForm,
  onError: (error) => void feedback.messageError(error),
  onSuccess: async (result) => {
    await feedback.message('success', result.message)
    await reloadDetail()
  },
  submit: ({ data, entity, mode }) => {
    const name = data.name.trim()
    const description = data.description.trim() || undefined
    const region = data.region.trim() || undefined
    const buildingType = data.buildingType.trim() || undefined
    return mode === 'create'
      ? createProject({ name, description, region, buildingType, visibility: data.visibility })
      : updateProject(entity!.id, { name, description, region, buildingType })
  },
})

const visibilityAction = useConfirmedCrudAction<
  { project: ProjectItem, visibility: ProjectVisibility },
  ProjectMutationResult
>({
  action: ({ project, visibility }) => updateProjectVisibility(project.id, visibility),
  confirm: ({ project, visibility }) => ({
    content: `确认将项目“${project.name}”切换为${visibility === 'PUBLIC' ? '公开' : '私有'}吗？`,
    confirmText: visibility === 'PUBLIC' ? '设为公开' : '设为私有',
    danger: visibility === 'PRIVATE',
    title: '切换项目可见性',
  }),
  onSuccess: async () => {
    await reloadDetail()
  },
  successMessage: (_payload, result) => result.message,
})

const deleteAction = useCrudDelete<ProjectItem, { message: string }>({
  action: (project) => deleteProject(project.id),
  confirm: (project) => ({
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

/** AI 会话场景标签（与后端 AI_SCENES 对齐）。 */
const SCENE_LABELS: Record<string, string> = {
  general_chat: '普通对话',
  project_design: '项目设计',
  material_compare: '材料对比',
  standard_qa: '标准问答',
  report_generate: '报告生成',
  information_extract: '信息抽取',
}

function sceneLabel(scene: string): string {
  return SCENE_LABELS[scene] ?? scene
}

const conversationColumns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => (row as ProjectConversation).title || '未命名会话',
    colKey: 'title',
    minWidth: 200,
    title: '会话标题',
  },
  {
    cell: (_h, { row }) => sceneLabel((row as ProjectConversation).scene),
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
        <t-button theme="default" variant="outline" @click="projectDrawer.openEdit(currentProject!)">
          编辑
        </t-button>
        <t-button
          theme="default"
          variant="outline"
          @click="visibilityAction.run({
            project: currentProject!,
            visibility: currentProject!.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC',
          })"
        >
          {{ currentProject?.visibility === 'PUBLIC' ? '设为私有' : '设为公开' }}
        </t-button>
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
      <nav aria-label="项目任务入口" class="project-task-grid">
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
      </nav>

      <t-tabs v-model="activeTab" class="project-detail-tabs">
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
                <t-descriptions-item label="可见性">
                  {{ projectVisibilityMeta(currentProject.visibility).label }}
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
              :page-size="conversationsList.pageSize.value"
              row-key="id"
              :status="conversationsList.tableStatus.value"
              :total="conversationsList.total.value"
              @page-change="conversationsList.changePage"
              @refresh="conversationsList.refresh"
              @retry="conversationsList.retry"
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

    <AppCrudFormDialog
      description="项目名称与描述可修改，可见性切换请在页面操作中执行"
      :form-data="projectDrawer.formData"
      :mode="projectDrawer.mode.value"
      :rules="formRules"
      :submitting="projectDrawer.isSubmitting.value"
      title="编辑项目"
      :visible="projectDrawer.visible.value"
      @cancel="projectDrawer.close"
      @submit="projectDrawer.submit"
      @update:visible="projectDrawer.setVisible"
    >
      <t-form-item label="项目名称" name="name">
        <t-input v-model="projectDrawer.formData.name" maxlength="120" placeholder="请输入项目名称" />
      </t-form-item>
      <t-form-item label="项目地区" name="region">
        <t-input v-model="projectDrawer.formData.region" maxlength="80" placeholder="选填，如：上海市浦东新区" />
      </t-form-item>
      <t-form-item label="建筑类型" name="buildingType">
        <t-input v-model="projectDrawer.formData.buildingType" maxlength="80" placeholder="选填，如：办公建筑" />
      </t-form-item>
      <t-form-item label="项目描述" name="description">
        <t-textarea
          v-model="projectDrawer.formData.description"
          :autosize="{ minRows: 3, maxRows: 6 }"
          maxlength="2000"
          placeholder="选填，说明项目背景、节能目标或改造范围"
        />
      </t-form-item>
    </AppCrudFormDialog>
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
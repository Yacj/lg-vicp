<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { ArrowLeftIcon } from 'tdesign-icons-vue-next'
import { computed, h, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppFileUploader from '@/components/business/AppFileUploader.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppErrorState from '@/components/ui/AppErrorState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useProjectDetail } from '@/composables/useProjectDetail'
import { useCrudDrawer } from '@/composables/useCrudDrawer'
import { useConfirmedCrudAction, useCrudDelete } from '@/composables/useCrudActions'
import { useAppFeedback, normalizeFeedbackError } from '@/composables/useAppFeedback'
import { createProject, updateProject, updateProjectVisibility, deleteProject } from '@/api/modules/projects'
import type { ProjectForm } from '@/composables/useProjectCenter'
import type { ProjectItem, ProjectMutationResult, ProjectVisibility } from '@/types/project'
import type { ProjectConversation, ProjectAuditLog } from '@/types/project'
import type { FileRecord } from '@/types/file'
import type { AppTableAction } from '@/types/crud'
import {
  isProjectManager,
  projectStatusMeta,
  projectVisibilityMeta,
} from '@/utils/project'
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
  downloadFile,
  fileDeleteAction,
  fileDownloadRunning,
  filesList,
  reloadDetail,
  tabs,
} = useProjectDetail(projectId)

const activeTab = ref<string>('overview')

const currentProject = computed(() => detail.value)
const isManager = computed(() => currentProject.value
  ? isProjectManager(currentProject.value, userStore.profile?.id ?? null, userStore.isSuperAdmin)
  : false)

const formRules: FormRules<ProjectForm> = {
  name: [
    { message: '请输入项目名称', required: true },
    { max: 120, message: '项目名称不能超过 120 个字符' },
  ],
  description: [{ max: 2000, message: '项目描述不能超过 2000 个字符' }],
}

function createProjectForm(): ProjectForm {
  return { description: '', name: '', visibility: 'PRIVATE' }
}

function editProjectForm(project: ProjectItem): ProjectForm {
  return { description: project.description ?? '', name: project.name, visibility: project.visibility }
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
    return mode === 'create'
      ? createProject({ name, description, visibility: data.visibility })
      : updateProject(entity!.id, { name, description })
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
    await router.push('/project')
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

const fileColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'originalName', minWidth: 220, title: '文件名称' },
  {
    cell: (_h, { row }) => {
      const file = row as FileRecord
      const statusMap: Record<string, { label: string, status: 'default' | 'info' | 'processing' | 'success' | 'warning' | 'error' | 'disabled' }> = {
        UPLOADING: { label: '上传中', status: 'processing' },
        UPLOADED: { label: '已上传', status: 'info' },
        QUEUED: { label: '等待解析', status: 'processing' },
        PARSING: { label: '解析中', status: 'processing' },
        OCR_REQUIRED: { label: '待 OCR', status: 'warning' },
        INDEXING: { label: '索引中', status: 'processing' },
        READY: { label: '就绪', status: 'success' },
        FAILED: { label: '失败', status: 'error' },
        DELETED: { label: '已删除', status: 'disabled' },
      }
      const meta = statusMap[file.status] ?? { label: file.status, status: 'default' as const }
      return h(AppStatusTag, { label: meta.label, status: meta.status })
    },
    colKey: 'status',
    title: '状态',
    width: 110,
  },
  {
    cell: (_h, { row }) => formatDate(new Date((row as FileRecord).updatedAt)),
    colKey: 'updatedAt',
    title: '更新时间',
    width: 170,
  },
]

function getFileActions(row: TableRowData): AppTableAction[] {
  const file = row as FileRecord
  const actions: AppTableAction[] = [
    {
      handler: () => downloadFile(file),
      key: 'download',
      label: '下载',
      loading: fileDownloadRunning.value,
    },
  ]
  if (isManager.value) {
    actions.push({
      handler: () => fileDeleteAction.run(file),
      key: 'remove',
      label: '删除',
      loading: fileDeleteAction.running.value,
      theme: 'danger',
    })
  }
  return actions
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
  void router.push('/project')
}
</script>

<template>
  <AppPage>
    <template #header>
      <div class="project-detail-header">
        <t-button
          aria-label="返回项目列表"
          shape="square"
          theme="default"
          variant="text"
          @click="goBack"
        >
          <ArrowLeftIcon />
        </t-button>

        <div class="project-detail-header__main">
          <div class="project-detail-header__title-row">
            <h1>{{ currentProject?.name ?? '项目详情' }}</h1>
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
          </div>
          <p v-if="currentProject?.description" class="project-detail-header__description">
            {{ currentProject.description }}
          </p>
        </div>

        <div v-if="isManager" class="project-detail-header__actions">
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
        </div>
      </div>
    </template>

    <AppErrorState
      v-if="detailStatus === 'error'"
      :description="errorDescription"
      title="项目加载失败"
      @action="reloadDetail"
    />

    <template v-else-if="detailStatus === 'ready' && currentProject">
      <t-tabs v-model="activeTab" class="project-detail-tabs">
        <t-tab-panel
          v-for="tab in tabs"
          :key="tab.key"
          :label="tab.label"
          :value="tab.key"
        >
          <!-- 项目概况 -->
          <section v-if="tab.key === 'overview'" class="project-overview">
            <div class="project-overview__grid">
              <div class="project-overview__item">
                <span class="project-overview__label">项目名称</span>
                <span class="project-overview__value">{{ currentProject.name }}</span>
              </div>
              <div class="project-overview__item">
                <span class="project-overview__label">可见性</span>
                <span class="project-overview__value">
                  {{ projectVisibilityMeta(currentProject.visibility).label }}
                </span>
              </div>
              <div class="project-overview__item">
                <span class="project-overview__label">状态</span>
                <span class="project-overview__value">
                  {{ projectStatusMeta(currentProject.status).label }}
                </span>
              </div>
              <div class="project-overview__item">
                <span class="project-overview__label">创建时间</span>
                <span class="project-overview__value">
                  {{ formatDate(new Date(currentProject.createdAt)) }}
                </span>
              </div>
              <div class="project-overview__item">
                <span class="project-overview__label">更新时间</span>
                <span class="project-overview__value">
                  {{ formatDate(new Date(currentProject.updatedAt)) }}
                </span>
              </div>
              <div class="project-overview__item project-overview__item--wide">
                <span class="project-overview__label">项目描述</span>
                <span class="project-overview__value">
                  {{ currentProject.description || '暂无描述' }}
                </span>
              </div>
            </div>
          </section>

          <!-- 资料文件 -->
          <section v-else-if="tab.key === 'files'" class="project-files">
            <div v-if="isManager" class="project-files__uploader">
              <AppFileUploader
                :project-id="currentProject.id"
                tips="支持 PDF、DOCX、PNG、JPG，单文件不超过 50 MB"
                @success="filesList.refresh"
              />
            </div>
            <AppDataTable
              :columns="fileColumns"
              :current="filesList.current.value"
              :data="filesList.data.value"
              empty-description="尚未上传项目资料文件"
              empty-title="暂无资料文件"
              :error-description="filesList.error.value
                ? normalizeFeedbackError(filesList.error.value).message
                : '请检查网络连接后重试'"
              :page-size="filesList.pageSize.value"
              row-key="id"
              :status="filesList.tableStatus.value"
              :total="filesList.total.value"
              @page-change="filesList.changePage"
              @refresh="filesList.refresh"
              @retry="filesList.retry"
            >
              <template #operations="{ row }">
                <AppTableActions :actions="getFileActions(row)" />
              </template>
            </AppDataTable>
          </section>

          <!-- AI 会话 -->
          <section v-else-if="tab.key === 'conversations'" class="project-conversations">
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
          <section v-else-if="tab.key === 'audit'" class="project-audit">
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
.project-detail-header {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: var(--td-size-3);
}

.project-detail-header__main {
  min-width: 0;
  flex: 1;
}

.project-detail-header__title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-2);
}

.project-detail-header h1 {
  overflow: hidden;
  margin: 0;
  color: var(--td-text-color-primary);
  font-size: var(--vicp-page-title-size);
  font-weight: 600;
  line-height: var(--td-line-height-title-large);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-detail-header__description {
  max-width: 760px;
  margin: var(--td-size-2) 0 0;
  color: var(--td-text-color-secondary);
  line-height: var(--td-line-height-body-medium);
}

.project-detail-header__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--td-size-2);
}

.project-detail-tabs {
  min-width: 0;
}

/* 移动端 Tabs 横向滚动 */
.project-detail-tabs :deep(.t-tabs__nav-container) {
  overflow-x: auto;
}

.project-overview__grid {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--td-size-4);
  padding: var(--vicp-panel-padding);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.project-overview__item {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-1);
}

.project-overview__item--wide {
  grid-column: 1 / -1;
}

.project-overview__label {
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}

.project-overview__value {
  overflow-wrap: anywhere;
  color: var(--td-text-color-primary);
  line-height: var(--td-line-height-body-medium);
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

@media (max-width: 768px) {
  .project-detail-header {
    flex-wrap: wrap;
  }

  .project-detail-header__actions {
    width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .project-overview__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
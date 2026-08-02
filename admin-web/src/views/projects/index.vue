<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon, ChevronRightIcon } from 'tdesign-icons-vue-next'
import { computed, h } from 'vue'
import { useRouter } from 'vue-router'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { useResponsiveShell } from '@/composables/useResponsiveShell'
import { useProjectCenter } from '@/composables/useProjectCenter'
import type { AppTableAction } from '@/types/crud'
import type { ProjectForm } from '@/composables/useProjectCenter'
import type { ProjectItem, ProjectViewKey } from '@/types/project'
import {
  isProjectManager,
  normalizeVisibilityFilter,
  projectStatusMeta,
  projectVisibilityMeta,
} from '@/utils/project'
import { useUserStore } from '@/stores/user'
import { formatDate } from '@/utils/day'

const router = useRouter()
const userStore = useUserStore()
const { canAccess } = usePermissionAccess()
const { isMobile } = useResponsiveShell()

const {
  activeList,
  activeView,
  allList,
  applyVisibilityFilter,
  deleteAction,
  projectDrawer,
  setActiveView,
  visibilityAction,
} = useProjectCenter()

const canCreateProject = computed(() => canAccess({ permissions: ['project.create'] }))
const canViewAllProjects = computed(() => canAccess({ permissions: ['system:project:list'] }))

const viewOptions = computed(() => [
  { label: '我的项目', value: 'my' },
  { label: '公开项目', value: 'public' },
  ...(canViewAllProjects.value ? [{ label: '全部项目', value: 'all' as const }] : []),
])

const visibilityOptions = [
  { label: '公开', value: 'PUBLIC' },
  { label: '私有', value: 'PRIVATE' },
]

const formRules: FormRules<ProjectForm> = {
  name: [
    { message: '请输入项目名称', required: true },
    { max: 120, message: '项目名称不能超过 120 个字符' },
  ],
  description: [{ max: 2000, message: '项目描述不能超过 2000 个字符' }],
}

function isManagerOf(project: ProjectItem): boolean {
  return isProjectManager(project, userStore.profile?.id ?? null, userStore.isSuperAdmin)
}

const columns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => h('span', { class: 'project-name' }, (row as ProjectItem).name),
    colKey: 'name',
    minWidth: 220,
    title: '项目名称',
  },
  {
    cell: (_h, { row }) => {
      const meta = projectVisibilityMeta((row as ProjectItem).visibility)
      return h(AppStatusTag, { label: meta.label, status: meta.status })
    },
    colKey: 'visibility',
    title: '可见性',
    width: 100,
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

const tableErrorDescription = computed(() => {
  const error = activeList.value.error.value
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
      label: '详情',
      theme: 'primary',
    },
  ]
  if (isManagerOf(project)) {
    actions.push(
      {
        handler: () => projectDrawer.openEdit(project),
        key: 'edit',
        label: '编辑',
      },
      {
        handler: () => visibilityAction.run({
          project,
          visibility: project.visibility === 'PUBLIC' ? 'PRIVATE' : 'PUBLIC',
        }),
        key: 'visibility',
        label: project.visibility === 'PUBLIC' ? '设为私有' : '设为公开',
        loading: visibilityAction.running.value,
        theme: project.visibility === 'PUBLIC' ? 'warning' : 'success',
      },
      {
        handler: () => deleteAction.run(project),
        key: 'remove',
        label: '删除',
        loading: deleteAction.running.value,
        theme: 'danger',
      },
    )
  }
  return actions
}

function handleViewChange(value: string | number): void {
  setActiveView(value as ProjectViewKey)
}

function handleVisibilityChange(value: unknown): void {
  const visibility = typeof value === 'string' ? normalizeVisibilityFilter(value) : undefined
  applyVisibilityFilter(visibility)
}

function handleResetFilters(): void {
  applyVisibilityFilter(undefined)
}
</script>

<template>
  <AppPage>
    <template #header>
      <AppPageHeader
        description="管理建筑节能项目：创建者与超级管理员可管理项目，公开项目对其他登录用户只读"
        title="项目中心"
      >
        <template #actions>
          <t-button v-if="canCreateProject" theme="primary" @click="projectDrawer.openCreate">
            <template #icon>
              <AddIcon />
            </template>
            新建项目
          </t-button>
        </template>
      </AppPageHeader>
    </template>

    <t-tabs
      :value="activeView"
      class="project-center-tabs"
      @change="handleViewChange"
    >
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
                  ...visibilityOptions,
                ]"
                clearable
                placeholder="全部"
                @change="handleVisibilityChange"
              />
            </t-form-item>
          </AppSearchPanel>
        </template>

        <div v-if="!isMobile" class="project-center-table">
          <AppDataTable
            :columns="columns"
            :current="activeList.current.value"
            :data="activeList.data.value"
            empty-description="暂无符合条件的项目"
            empty-title="暂无项目"
            :error-description="tableErrorDescription"
            :page-size="activeList.pageSize.value"
            row-key="id"
            :status="activeList.tableStatus.value"
            :total="activeList.total.value"
            @page-change="activeList.changePage"
            @refresh="activeList.refresh"
            @retry="activeList.retry"
          >
            <template #operations="{ row }">
              <AppTableActions :actions="getActions(row)" />
            </template>
          </AppDataTable>
        </div>

        <div v-else class="project-center-cards">
          <article
            v-for="project in activeList.data.value"
            :key="project.id"
            class="project-card"
            @click="openProject(project)"
          >
            <div class="project-card__main">
              <div class="project-card__title-row">
                <strong class="project-card__name">{{ project.name }}</strong>
                <AppStatusTag
                  :label="projectVisibilityMeta(project.visibility).label"
                  :status="projectVisibilityMeta(project.visibility).status"
                />
              </div>
              <p v-if="project.description" class="project-card__description">
                {{ project.description }}
              </p>
              <p class="project-card__meta">
                <span>更新时间 {{ formatDate(new Date(project.updatedAt)) }}</span>
                <AppStatusTag
                  :label="projectStatusMeta(project.status).label"
                  :status="projectStatusMeta(project.status).status"
                />
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
            v-if="activeList.data.value.length === 0 && activeList.tableStatus.value === 'ready'"
            description="暂无符合条件的项目"
            title="暂无项目"
          />
        </div>
      </t-tab-panel>
    </t-tabs>

    <AppCrudFormDialog
      :description="projectDrawer.mode.value === 'create'
        ? '创建后可在项目详情中继续维护资料与 AI 会话'
        : '项目名称与描述可修改，可见性切换请在列表操作中执行'"
      :form-data="projectDrawer.formData"
      :mode="projectDrawer.mode.value"
      :rules="formRules"
      :submitting="projectDrawer.isSubmitting.value"
      :title="projectDrawer.mode.value === 'create' ? '新建项目' : '编辑项目'"
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
      <t-form-item v-if="projectDrawer.mode.value === 'create'" label="可见性" name="visibility">
        <t-radio-group v-model="projectDrawer.formData.visibility">
          <t-radio-button value="PRIVATE">私有</t-radio-button>
          <t-radio-button value="PUBLIC">公开</t-radio-button>
        </t-radio-group>
      </t-form-item>
    </AppCrudFormDialog>
  </AppPage>
</template>

<style scoped>
.project-center-tabs {
  min-width: 0;
}

.project-center-table {
  min-width: 0;
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
  transition: border-color var(--td-transition-duration) ease;
}

.project-card:active {
  border-color: var(--td-brand-color);
}

.project-card__main {
  min-width: 0;
  flex: 1;
}

.project-card__title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-2);
}

.project-card__name {
  overflow: hidden;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-large);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-card__description {
  display: -webkit-box;
  overflow: hidden;
  margin: var(--td-size-2) 0 0;
  color: var(--td-text-color-secondary);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-height: var(--td-line-height-body-medium);
}

.project-card__meta {
  display: flex;
  align-items: center;
  gap: var(--td-size-3);
  margin: var(--td-size-2) 0 0;
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}

.project-card__side {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--td-size-1);
  color: var(--td-text-color-placeholder);
}

.project-card__actions {
  min-width: 0;
}
</style>
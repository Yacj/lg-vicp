import type { TableRowData } from 'tdesign-vue-next'
import {
  createProject,
  deleteProject,
  fetchMyProjects,
  fetchPlatformProjects,
  fetchPublicProjects,
  updateProject,
  updateProjectVisibility,
} from '@/api/modules/projects'
import type {
  ProjectItem,
  ProjectMutationResult,
  ProjectPageQuery,
  ProjectVisibility,
  ProjectViewKey,
} from '@/types/project'
import { computed, ref } from 'vue'
import { useAppFeedback } from './useAppFeedback'
import { useConfirmedCrudAction, useCrudDelete } from './useCrudActions'
import { useCrudDrawer } from './useCrudDrawer'
import { useCrudList } from './useCrudList'

export interface ProjectForm extends Record<string, unknown> {
  name: string
  description: string
  visibility: ProjectVisibility
}

export interface UseProjectCenterOptions {
  /** 列表是否立即加载；详情页复用抽屉与动作时可传 false。 */
  immediate?: boolean
}

function createProjectForm(): ProjectForm {
  return {
    description: '',
    name: '',
    visibility: 'PRIVATE',
  }
}

function editProjectForm(project: ProjectItem): ProjectForm {
  return {
    description: project.description ?? '',
    name: project.name,
    visibility: project.visibility,
  }
}

function projectListQuery(visibility: ProjectVisibility | undefined): ProjectPageQuery {
  return visibility ? { visibility } : {}
}

export function useProjectCenter(options: UseProjectCenterOptions = {}) {
  const immediate = options.immediate !== false
  const feedback = useAppFeedback()
  const activeView = ref<ProjectViewKey>('my')

  const myList = useCrudList<ProjectItem & TableRowData, ProjectPageQuery & Record<string, unknown>>({
    createQuery: () => ({}),
    fetcher: ({ page, pageSize, query, signal }) =>
      fetchMyProjects({ ...query, page, pageSize }, signal),
    immediate,
    rowKey: 'id',
  })

  const publicList = useCrudList<ProjectItem & TableRowData, ProjectPageQuery & Record<string, unknown>>({
    createQuery: () => ({}),
    fetcher: ({ page, pageSize, query, signal }) =>
      fetchPublicProjects({ ...query, page, pageSize }, signal),
    immediate: false,
    rowKey: 'id',
  })

  const allList = useCrudList<ProjectItem & TableRowData, ProjectPageQuery & Record<string, unknown>>({
    createQuery: () => ({}),
    fetcher: ({ page, pageSize, query, signal }) =>
      fetchPlatformProjects({ ...query, page, pageSize }, signal),
    immediate: false,
    rowKey: 'id',
  })

  const activeList = computed(() => ({
    my: myList,
    public: publicList,
    all: allList,
  })[activeView.value])

  function setActiveView(view: ProjectViewKey): void {
    if (activeView.value === view) {
      return
    }
    activeView.value = view
    const list = ({
      my: myList,
      public: publicList,
      all: allList,
    })[view]
    if (list.data.value.length === 0 && list.status.value !== 'loading') {
      void list.refresh()
    }
  }

  const projectDrawer = useCrudDrawer<ProjectForm, ProjectItem, ProjectMutationResult>({
    createForm: createProjectForm,
    editForm: editProjectForm,
    onError: (error) => void feedback.messageError(error),
    onSuccess: async (result) => {
      await feedback.message('success', result.message)
      await Promise.all([myList.refresh(), allList.refresh()])
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
      await Promise.all([myList.refresh(), publicList.refresh(), allList.refresh()])
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
      await Promise.all([myList.refresh(), publicList.refresh(), allList.refresh()])
    },
    successMessage: (_project, result) => result.message,
  })

  /** 全部项目视图：后端仅支持 visibility 筛选参数。 */
  function applyVisibilityFilter(visibility: ProjectVisibility | undefined): void {
    allList.setQuery(projectListQuery(visibility))
    void allList.search()
  }

  return {
    activeList,
    activeView,
    allList,
    applyVisibilityFilter,
    deleteAction,
    myList,
    projectDrawer,
    publicList,
    setActiveView,
    visibilityAction,
  }
}
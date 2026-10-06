import type { TableRowData } from 'tdesign-vue-next'
import {
  deletePlatformProject,
  fetchPlatformProjects,
  fetchProjectStatistics,
} from '@/api/modules/projects'
import type {
  ProjectItem,
  ProjectPageQuery,
  ProjectStatistics,
  ProjectVisibility,
} from '@/types/project'
import { computed, ref } from 'vue'
import { useCrudDelete } from './useCrudActions'
import { useCrudList } from './useCrudList'

export interface ProjectCenterSearchQuery extends ProjectPageQuery, Record<string, unknown> {
  keyword: string
  visibility: ProjectVisibility | undefined
}

export interface UseProjectCenterOptions {
  immediate?: boolean
  loadStatistics?: boolean
}

export function useProjectCenter(options: UseProjectCenterOptions = {}) {
  const immediate = options.immediate !== false
  const projectStatistics = ref<ProjectStatistics>({ private: 0, public: 0, total: 0, department: 0 })
  const projectStatisticsError = ref<unknown>(null)
  const projectStatisticsLoading = ref(false)

  async function refreshProjectStatistics(): Promise<void> {
    if (!options.loadStatistics) return
    projectStatisticsLoading.value = true
    projectStatisticsError.value = null
    try {
      projectStatistics.value = await fetchProjectStatistics()
    }
    catch (cause) {
      projectStatisticsError.value = cause
    }
    finally {
      projectStatisticsLoading.value = false
    }
  }

  void refreshProjectStatistics()

  const allList = useCrudList<ProjectItem & TableRowData, ProjectCenterSearchQuery>({
    createQuery: () => ({ keyword: '', visibility: undefined }),
    fetcher: ({ page, pageSize, query, signal }) => fetchPlatformProjects({
      keyword: query.keyword,
      page,
      pageSize,
      visibility: query.visibility,
    }, signal),
    immediate,
    rowKey: 'id',
  })

  const activeList = computed(() => allList)
  const activeView = ref<'all'>('all')

  function setActiveView(_view: 'all'): void {
    void _view
  }

  function applyVisibilityFilter(visibility: ProjectVisibility | undefined): void {
    allList.query.visibility = visibility
    void allList.search()
  }

  const deleteAction = useCrudDelete<ProjectItem, { message: string }>({
    action: project => deletePlatformProject(project.id),
    confirm: project => ({
      content: `确认删除项目“${project.name}”吗？删除后无法恢复。`,
      confirmText: '删除',
      danger: true,
      title: '删除项目',
    }),
    onSuccess: async () => {
      await Promise.all([allList.refresh(), refreshProjectStatistics()])
    },
    successMessage: (_project, result) => result.message,
  })

  return {
    activeList,
    activeView,
    allList,
    applyVisibilityFilter,
    deleteAction,
    myList: allList,
    projectStatistics,
    projectStatisticsError,
    projectStatisticsLoading,
    publicList: allList,
    refreshProjectStatistics,
    setActiveView,
  }
}

import type { KnowledgeParsingJob } from '@/types/knowledge'
import type { ProjectItem } from '@/types/project'
import type { ReportCenterRow } from '@/types/report'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetchKnowledgeParsingJobs } from '@/api/modules/knowledge'
import { fetchMyProjects } from '@/api/modules/projects'
import { fetchPlatformReportCenter } from '@/api/modules/reports'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { pickRecentReports } from './dashboard'

/**
 * 工作台最近动态：最近项目、最近报告（按项目聚合）、资料异常（解析失败任务）。
 * 列表以 null 表示加载中，空数组表示已加载但无数据；各分组独立容错。
 */
export function useDashboardRecent() {
  const router = useRouter()
  const { canAccess } = usePermissionAccess()

  function canNavigate(path: string): boolean {
    const resolved = router.resolve(path)
    return resolved.matched.length > 0 && resolved.name !== 'NotFound'
  }

  // ===== 最近项目（我的项目列表） =====

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

  // ===== 最近报告（平台报告成果按项目聚合，需 system:project:list） =====

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

  // ===== 资料异常（知识解析失败任务，入口按路由可达性裁剪） =====

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

  onMounted(() => {
    void loadParsingFailures()
    void loadRecentProjects().then(() => {
      void loadRecentReports()
    })
  })

  return {
    recentProjects,
    recentReports,
    canAggregateReports,
    parsingFailures,
    parsingFailureTotal,
    parsingJobsPath,
    parsingJobsReachable,
  }
}

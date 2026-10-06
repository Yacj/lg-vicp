import type { ProjectStatistics } from '@/types/project'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { fetchKnowledgeDocuments, fetchKnowledgeParsingJobs } from '@/api/modules/knowledge'
import { fetchProjectStatistics } from '@/api/modules/projects'
import { fetchReviewQueue } from '@/api/modules/review-center'
import { usePermissionAccess } from '@/composables/usePermissionAccess'

/**
 * 工作台核心指标计数：全部来自既有统计/列表接口的 total，按权限与路由可达性裁剪。
 * 每个计数独立请求、独立容错，失败时保持 null（指标卡显示 "--"），不虚构数据。
 */
export function useDashboardMetrics() {
  const router = useRouter()
  const { canAccess } = usePermissionAccess()

  const projectStats = ref<ProjectStatistics | null>(null)
  const knowledgePendingCount = ref<number | null>(null)
  const reviewPendingCount = ref<number | null>(null)
  const parsingFailedCount = ref<number | null>(null)
  const loading = ref(true)

  function canNavigate(path: string): boolean {
    const resolved = router.resolve(path)
    return resolved.matched.length > 0 && resolved.name !== 'NotFound'
  }

  async function loadProjectStats(): Promise<void> {
    try {
      projectStats.value = await fetchProjectStatistics()
    }
    catch {
      projectStats.value = null
    }
  }

  async function loadKnowledgePending(): Promise<void> {
    if (!canAccess({ permissions: ['system:knowledge:doc:list'] })) {
      return
    }
    try {
      const result = await fetchKnowledgeDocuments({ page: 1, pageSize: 1, healthStatus: 'NEEDS_ACTION' })
      knowledgePendingCount.value = result.total
    }
    catch {
      knowledgePendingCount.value = null
    }
  }

  async function loadReviewPending(): Promise<void> {
    if (!canAccess({ permissions: ['system:review:list'] })) {
      return
    }
    try {
      const result = await fetchReviewQueue({ page: 1, pageSize: 1, status: 'PENDING_REVIEW' })
      reviewPendingCount.value = result.total
    }
    catch {
      reviewPendingCount.value = null
    }
  }

  async function loadParsingFailed(): Promise<void> {
    if (!canNavigate('/knowledge/parsing-jobs')) {
      return
    }
    try {
      const result = await fetchKnowledgeParsingJobs({ page: 1, pageSize: 1, status: 'FAILED' })
      parsingFailedCount.value = result.total
    }
    catch {
      parsingFailedCount.value = null
    }
  }

  async function load(): Promise<void> {
    loading.value = true
    await Promise.all([
      loadProjectStats(),
      loadKnowledgePending(),
      loadReviewPending(),
      loadParsingFailed(),
    ])
    loading.value = false
  }

  onMounted(() => {
    void load()
  })

  return {
    projectStats,
    knowledgePendingCount,
    reviewPendingCount,
    parsingFailedCount,
    loading,
    reload: load,
  }
}

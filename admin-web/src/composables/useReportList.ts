import type { TableRowData } from 'tdesign-vue-next'
import type { MyReportItem, ReportAffiliationFilter } from '@/types/report'
import { computed, ref, watch } from 'vue'
import { fetchMyReports } from '@/api/modules/reports'
import { fetchProjectDetail } from '@/api/modules/projects'
import { filterReportsByAffiliation } from '@/utils/report'
import { useCrudList } from './useCrudList'
import { useReportActions } from './useReportActions'

export type ReportListRow = MyReportItem & TableRowData

export interface ReportListQuery extends Record<string, unknown> {
  affiliation: ReportAffiliationFilter
}

const FETCH_ALL_PAGE_SIZE = 100
const FETCH_ALL_MAX_PAGES = 20

async function fetchAllMyReports(
  projectId: string | undefined,
  signal: AbortSignal,
): Promise<MyReportItem[]> {
  const items: MyReportItem[] = []
  for (let page = 1; page <= FETCH_ALL_MAX_PAGES; page++) {
    const result = await fetchMyReports({ page, pageSize: FETCH_ALL_PAGE_SIZE, projectId }, signal)
    items.push(...result.items)
    if (items.length >= result.total || result.items.length === 0) {
      break
    }
  }
  return items
}

/**
 * 成果报告列表：GET /reports/my。
 * 全部走服务端分页；项目报告 / 独立报告在拉全量后前端筛选。
 * 带 projectId 时只请求该项目，不再做归属筛选。
 */
export function useReportList(projectId: () => string) {
  const scopedProjectName = ref<string | null>(null)
  const actions = useReportActions({
    onChanged: () => {
      void list.refresh()
    },
  })

  const list = useCrudList<ReportListRow, ReportListQuery>({
    createQuery: () => ({ affiliation: 'all' }),
    fetcher: async ({ query, page, pageSize, signal }) => {
      const scopedId = projectId()
      if (scopedId || query.affiliation === 'all') {
        return fetchMyReports({
          page,
          pageSize,
          projectId: scopedId || undefined,
        }, signal)
      }
      const all = await fetchAllMyReports(undefined, signal)
      const filtered = filterReportsByAffiliation(all, query.affiliation)
      const start = (page - 1) * pageSize
      return {
        items: filtered.slice(start, start + pageSize),
        page,
        pageSize,
        total: filtered.length,
      }
    },
    immediate: true,
    rowKey: 'id',
  })

  const scoped = computed(() => Boolean(projectId()))

  watch(projectId, async (id) => {
    scopedProjectName.value = null
    if (!id) {
      return
    }
    try {
      const result = await fetchProjectDetail(id)
      scopedProjectName.value = result.project?.name ?? null
    }
    catch {
      scopedProjectName.value = null
    }
  }, { immediate: true })

  watch(projectId, () => {
    list.setQuery({ affiliation: 'all' })
    void list.search()
  })

  return {
    actions,
    list,
    scoped,
    scopedProjectName,
  }
}

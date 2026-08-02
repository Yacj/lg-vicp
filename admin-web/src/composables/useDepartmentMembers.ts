import type { TableRowData } from 'tdesign-vue-next'
import { fetchDepartmentMembers } from '@/api/modules/system-management'
import type {
  SystemDepartmentMember,
  SystemDepartmentMemberQuery,
} from '@/types/system-management'
import { trimToUndefined } from '@/utils/system-management'
import { useCrudList } from './useCrudList'

export interface DepartmentMemberSearchQuery extends Record<string, unknown> {
  keyword: string
  status: 'all' | 'ACTIVE' | 'DISABLED'
}

function toMemberQuery(
  departmentId: string,
  query: DepartmentMemberSearchQuery,
  page: number,
  pageSize: number,
): SystemDepartmentMemberQuery {
  return {
    departmentId,
    keyword: trimToUndefined(query.keyword),
    page,
    pageSize,
    ...(query.status !== 'all' ? { status: query.status } : {}),
  }
}

export function useDepartmentMembers(departmentId: string) {
  const memberList = useCrudList<SystemDepartmentMember & TableRowData, DepartmentMemberSearchQuery>({
    createQuery: () => ({ keyword: '', status: 'all' }),
    fetcher: ({ page, pageSize, query, signal }) => (
      fetchDepartmentMembers(toMemberQuery(departmentId, query, page, pageSize), signal)
    ),
    immediate: true,
    rowKey: 'id',
  })

  return {
    memberList,
  }
}
import type { TableRowData } from 'tdesign-vue-next'
import { computed, ref } from 'vue'
import { addDepartmentMember, fetchDepartmentMembers, removeDepartmentMember } from '@/api/modules/system-management'
import { fetchUsers } from '@/api/modules/users'
import type {
  DepartmentMemberItem,
  MutationMessage,
  SystemDepartmentMember,
} from '@/types/system-management'
import { useAppFeedback } from './useAppFeedback'
import { useCrudDelete } from './useCrudActions'
import { useCrudList } from './useCrudList'

export type DepartmentMemberRow = DepartmentMemberItem & TableRowData
export type DepartmentMemberCandidateRow = SystemDepartmentMember & TableRowData & { alreadyAssigned: boolean }

export interface DepartmentMemberSearchQuery extends Record<string, unknown> {
  keyword: string
  status: 'all' | 'ACTIVE' | 'DISABLED'
}

export interface DepartmentMemberCandidateQuery extends Record<string, unknown> {
  keyword: string
}

function matchesMemberKeyword(item: DepartmentMemberItem, keyword: string): boolean {
  if (!keyword) {
    return true
  }
  return item.displayName.includes(keyword) || (item.phone ?? '').includes(keyword)
}

export function useDepartmentMembers(departmentId: string) {
  const feedback = useAppFeedback()
  const addVisible = ref(false)
  const assignedUserIds = ref(new Set<string>())

  const memberList = useCrudList<DepartmentMemberRow, DepartmentMemberSearchQuery>({
    createQuery: () => ({ keyword: '', status: 'all' }),
    fetcher: async ({ page, pageSize, query, signal }) => {
      const result = await fetchDepartmentMembers(departmentId, signal)
      assignedUserIds.value = new Set(result.items.map(item => item.userId))
      const keyword = query.keyword.trim()
      const filtered = result.items.filter((item) => {
        if (query.status !== 'all' && item.status !== query.status) {
          return false
        }
        return matchesMemberKeyword(item, keyword)
      })
      const start = (page - 1) * pageSize
      return {
        items: filtered.slice(start, start + pageSize),
        page,
        pageSize,
        total: filtered.length,
      }
    },
    immediate: true,
    rowKey: 'userId',
  })

  const candidateList = useCrudList<SystemDepartmentMember & TableRowData, DepartmentMemberCandidateQuery>({
    createQuery: () => ({ keyword: '' }),
    fetcher: ({ page, pageSize, query, signal }) => fetchUsers({
      keyword: query.keyword.trim() || undefined,
      page,
      pageSize,
      role: 'NORMAL_USER',
    }, signal),
    immediate: false,
    rowKey: 'id',
  })

  const candidateRows = computed<DepartmentMemberCandidateRow[]>(() => candidateList.data.value.map(row => ({
    ...row,
    alreadyAssigned: assignedUserIds.value.has(row.id),
  })))

  function openAdd(): void {
    addVisible.value = true
    void candidateList.search()
  }

  function closeAdd(): void {
    addVisible.value = false
  }

  function setAddVisible(visible: boolean): void {
    if (visible) {
      openAdd()
      return
    }
    closeAdd()
  }

  const addingUserId = ref<string | null>(null)

  async function addMember(userId: string): Promise<void> {
    if (addingUserId.value || assignedUserIds.value.has(userId)) {
      return
    }
    addingUserId.value = userId
    try {
      const result = await addDepartmentMember(departmentId, { userId })
      await feedback.message('success', result.message)
      await Promise.all([memberList.refresh(), candidateList.refresh()])
    }
    catch (error) {
      await feedback.messageError(error)
    }
    finally {
      addingUserId.value = null
    }
  }

  const removeAction = useCrudDelete<DepartmentMemberRow, MutationMessage>({
    action: member => removeDepartmentMember(departmentId, member.userId),
    confirm: member => ({
      content: `确认将“${member.displayName}”移出当前部门吗？`,
      confirmText: '移除',
      danger: true,
      title: '移除成员',
    }),
    onSuccess: async () => {
      await memberList.refresh()
    },
    successMessage: (_member, result) => result.message,
  })

  return {
    addMember,
    addVisible,
    addingUserId,
    assignedUserIds,
    candidateList,
    candidateRows,
    closeAdd,
    memberList,
    openAdd,
    removeAction,
    setAddVisible,
  }
}

import type { TableRowData } from 'tdesign-vue-next'
import { computed, readonly, ref, shallowRef } from 'vue'
import {
  fetchUserDetail,
  fetchUsers,
  setUserRoles,
} from '@/api/modules/roles'
import type {
  SystemDepartmentMember,
  SystemRole,
} from '@/types/system-management'
import { useAppFeedback } from './useAppFeedback'
import { useCrudBatchAction } from './useCrudActions'
import { useCrudList } from './useCrudList'

export type RoleUserRow = SystemDepartmentMember & TableRowData

export interface RoleUserSearchQuery extends Record<string, unknown> {
  keyword: string
}

const ASSIGNED_PAGE_SIZE = 100

/**
 * 角色用户分配：
 * - 已分配用户来自 /users?roleId= 服务端分页（真实 total）；
 * - 未分配候选来自 /users 全量分页，用已分配集合标记禁用；
 * - 后端仅提供按用户全量设置角色接口，批量分配/移除按用户逐条设置。
 */
export function useRoleUsers() {
  const feedback = useAppFeedback()

  const role = shallowRef<SystemRole | null>(null)
  const visible = ref(false)
  const assignedIds = ref<ReadonlySet<string>>(new Set())
  const assignedIdsLoading = ref(false)
  let assignedIdsController: AbortController | null = null
  let loadedRoleId: string | null = null

  const assignedList = useCrudList<RoleUserRow, RoleUserSearchQuery>({
    createQuery: () => ({ keyword: '' }),
    fetcher: ({ query, page, pageSize, signal }) => {
      const roleId = role.value?.id
      if (!roleId) {
        return Promise.resolve({ items: [], page, pageSize, total: 0 })
      }
      return fetchUsers({
        keyword: String(query.keyword ?? ''),
        page,
        pageSize,
        roleId,
      }, signal)
    },
    immediate: false,
    rowKey: 'id',
  })

  const candidateList = useCrudList<RoleUserRow, RoleUserSearchQuery>({
    createQuery: () => ({ keyword: '' }),
    fetcher: ({ query, page, pageSize, signal }) => {
      if (!role.value) {
        return Promise.resolve({ items: [], page, pageSize, total: 0 })
      }
      return fetchUsers({
        keyword: String(query.keyword ?? ''),
        page,
        pageSize,
      }, signal)
    },
    immediate: false,
    rowKey: 'id',
  })

  const assignedRows = computed(() => assignedList.data.value)
  const candidateRows = computed(() => candidateList.data.value.map((row) => ({
    ...row,
    alreadyAssigned: assignedIds.value.has(row.id),
  })))
  const assignedCount = computed(() => assignedIds.value.size)

  async function loadAssignedIds(): Promise<void> {
    const currentRole = role.value
    if (!currentRole) {
      return
    }
    assignedIdsController?.abort()
    const controller = new AbortController()
    assignedIdsController = controller
    assignedIdsLoading.value = true
    try {
      const ids = new Set<string>()
      for (let page = 1; page <= 1000; page += 1) {
        const result = await fetchUsers({
          page,
          pageSize: ASSIGNED_PAGE_SIZE,
          roleId: currentRole.id,
        }, controller.signal)
        result.items.forEach((user) => ids.add(user.id))
        if (result.items.length < ASSIGNED_PAGE_SIZE
          || page * result.pageSize >= result.total) {
          break
        }
      }
      assignedIds.value = new Set(ids)
    }
    catch (error) {
      if (!controller.signal.aborted) {
        await feedback.messageError(error)
      }
    }
    finally {
      if (assignedIdsController === controller) {
        assignedIdsLoading.value = false
      }
    }
  }

  async function open(nextRole: SystemRole): Promise<void> {
    role.value = nextRole
    visible.value = true
    assignedIds.value = new Set()
    assignedList.clearSelection()
    candidateList.clearSelection()
    await Promise.all([
      loadAssignedIds(),
      assignedList.refresh(),
      candidateList.refresh(),
    ])
    loadedRoleId = nextRole.id
  }

  function close(): void {
    if (assignAction.running.value || removeAction.running.value) {
      return
    }
    assignedIdsController?.abort()
    visible.value = false
    role.value = null
    loadedRoleId = null
  }

  function setVisible(nextVisible: boolean): void {
    if (!nextVisible) {
      close()
    }
  }

  async function applyRoleToUsers(
    userIds: readonly (string | number)[],
    remove: boolean,
  ): Promise<string> {
    const currentRole = role.value
    if (!currentRole) {
      throw new Error('角色尚未加载')
    }
    let done = 0
    for (const rawUserId of userIds) {
      const userId = String(rawUserId)
      const detail = await fetchUserDetail(userId)
      const currentRoleIds = detail.roles.map(item => item.id)
      const nextRoleIds = remove
        ? currentRoleIds.filter(id => id !== currentRole.id)
        : [...new Set([...currentRoleIds, currentRole.id])]
      await setUserRoles(userId, nextRoleIds)
      done += 1
    }
    return remove
      ? `已从 ${done} 名用户移除角色“${currentRole.name}”`
      : `已为 ${done} 名用户分配角色“${currentRole.name}”`
  }

  const assignAction = useCrudBatchAction<string>({
    action: userIds => applyRoleToUsers(userIds, false),
    confirm: userIds => ({
      content: `确认为选中的 ${userIds.length} 名用户分配角色“${role.value?.name ?? ''}”吗？`,
      confirmText: '分配',
      title: '批量分配角色',
    }),
    successMessage: (_ids, message) => message,
    onSuccess: async () => {
      await Promise.all([
        loadAssignedIds(),
        assignedList.refresh(),
        candidateList.refresh(),
      ])
    },
  })

  const removeAction = useCrudBatchAction<string>({
    action: userIds => applyRoleToUsers(userIds, true),
    confirm: userIds => ({
      content: `确认将选中的 ${userIds.length} 名用户移出角色“${role.value?.name ?? ''}”吗？`,
      confirmText: '移除',
      danger: true,
      title: '批量移除角色',
    }),
    successMessage: (_ids, message) => message,
    onSuccess: async () => {
      await Promise.all([
        loadAssignedIds(),
        assignedList.refresh(),
        candidateList.refresh(),
      ])
    },
  })

  function syncAssignedSelection(keys: Array<string | number>): void {
    assignedList.changeSelection(keys)
  }

  function syncCandidateSelection(keys: Array<string | number>): void {
    candidateList.changeSelection(keys)
  }

  return {
    assignAction,
    assignedCount,
    assignedList,
    assignedRows,
    assignedIdsLoading,
    candidateList,
    candidateRows,
    close,
    loadedRoleId,
    open,
    removeAction,
    role: readonly(role),
    setVisible,
    syncAssignedSelection,
    syncCandidateSelection,
    visible: readonly(visible),
  }
}
import type { TableRowData } from 'tdesign-vue-next'
import type { CrudKey, CrudPermissionOption } from '@/types/crud'
import type {
  RoleMutationResult,
  SystemPermissionResource,
  SystemRole,
  SystemRoleInput,
} from '@/types/system-management'
import type { RoleStatusFilter } from '@/utils/system-role'
import { computed, readonly, ref, shallowRef, watch } from 'vue'
import {
  createRole,
  deleteRole,
  fetchRolePermissions,
  fetchRoles,
  fetchUsers,
  setRolePermissions,
  updateRole,
  updateRoleStatus,
} from '@/api/modules/roles'
import { fetchMenus, fetchPermissionResources } from '@/api/modules/system-management'
import { projectClientPage } from '@/utils/system-management'
import { buildMenuTree } from '@/utils/system-menu'
import {
  buildPermissionTree,
  collectPermissionCodes,
  countSelectedPermissions,
  mapPermissionCodesToIds,
  mapPermissionIdsToCodes,
  matchesRoleFilter,

} from '@/utils/system-role'
import { confirmAndRun } from './useAppConfirm'
import { useAppFeedback } from './useAppFeedback'
import { useConfirmedCrudAction } from './useCrudActions'
import { useCrudDrawer } from './useCrudDrawer'
import { useCrudList } from './useCrudList'
import { usePermissionAccess } from './usePermissionAccess'

export type RoleTableRow = SystemRole & TableRowData

export interface RoleSearchQuery extends Record<string, unknown> {
  keyword: string
  status: RoleStatusFilter
}

export interface RoleForm extends Record<string, unknown> {
  code: string
  name: string
  description: string
  enabled: boolean
}

/** 表单内权限树的加载状态（unavailable = 当前账号无配置权限的权限码）。 */
export type RolePermissionLoadStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'

function createRoleForm(): RoleForm {
  return {
    code: '',
    description: '',
    enabled: true,
    name: '',
  }
}

function editRoleForm(role: SystemRole): RoleForm {
  return {
    code: role.code,
    description: role.description ?? '',
    enabled: role.enabled,
    name: role.name,
  }
}

export interface RoleDeleteResult {
  message: string
}

/**
 * 角色列表契约：后端 GET /roles 返回全量且无筛选参数，
 * 关键词与启停筛选在客户端完成（与菜单/部门列表一致）。
 */
export function useRoleManagement() {
  const feedback = useAppFeedback()
  const { canAccess } = usePermissionAccess()

  const roleList = useCrudList<RoleTableRow, RoleSearchQuery>({
    createQuery: () => ({ keyword: '', status: 'all' }),
    fetcher: async ({ query, page, pageSize, signal }) => {
      const result = await fetchRoles(signal)
      const filtered = result.items.filter(role =>
        matchesRoleFilter(role, String(query.keyword ?? ''), query.status))
      return projectClientPage(filtered, { page, pageSize })
    },
    immediate: true,
    rowKey: 'id',
  })

  const roleDrawer = useCrudDrawer<RoleForm, SystemRole, RoleMutationResult>({
    createForm: createRoleForm,
    editForm: editRoleForm,
    onError: error => void feedback.messageError(error),
    onSuccess: async (result) => {
      await feedback.message('success', result.message)
      await roleList.refresh()
    },
    submit: async ({ data, entity, mode }) => {
      const common = {
        enabled: data.enabled,
        name: data.name.trim(),
        description: data.description.trim() || undefined,
      }
      if (mode === 'create') {
        const input: SystemRoleInput = {
          ...common,
          code: data.code.trim(),
          dataScope: 'SELF',
        }
        if (permissionLoadStatus.value === 'ready') {
          input.permissionIds = mapPermissionCodesToIds(permissionResources.value, permissionValues.value)
        }
        return createRole(input)
      }
      const roleId = entity!.id
      const result = await updateRole(roleId, common)
      // 覆盖语义：本次勾选 = 角色最终权限；权限写入失败不阻断角色保存。
      if (permissionLoadStatus.value === 'ready') {
        try {
          await setRolePermissions(roleId, mapPermissionCodesToIds(permissionResources.value, permissionValues.value))
        }
        catch (error) {
          await feedback.notifyError(error, '角色已保存，权限写入失败')
        }
      }
      return result
    },
  })

  const canEditRolePermission = computed(() => canAccess({ permissions: ['system:role:permission'] }))

  const permissionTree = shallowRef<CrudPermissionOption[]>([])
  const permissionValues = ref<CrudKey[]>([])
  const permissionResources = shallowRef<SystemPermissionResource[]>([])
  const permissionLoadStatus = ref<RolePermissionLoadStatus>('idle')
  const permissionLoadError = shallowRef<unknown>(null)

  const selectedPermissionCount = computed(() =>
    countSelectedPermissions(permissionValues.value, permissionTree.value))
  const permissionCount = computed(() => collectPermissionCodes(permissionTree.value).length)

  let permissionLoadSequence = 0

  /** 打开表单时加载权限树素材；编辑模式额外回显已分配权限。 */
  async function loadPermissionSection(): Promise<void> {
    const sequence = ++permissionLoadSequence
    permissionTree.value = []
    permissionValues.value = []
    permissionResources.value = []
    permissionLoadError.value = null

    if (!canEditRolePermission.value) {
      permissionLoadStatus.value = 'unavailable'
      return
    }
    permissionLoadStatus.value = 'loading'
    try {
      const [menusResult, resourcesResult] = await Promise.all([
        fetchMenus(),
        fetchPermissionResources(),
      ])
      if (sequence !== permissionLoadSequence) {
        return
      }
      permissionResources.value = resourcesResult.items
      permissionTree.value = buildPermissionTree(
        buildMenuTree(menusResult.items),
        resourcesResult.items,
      )
      permissionLoadStatus.value = 'ready'

      const entity = roleDrawer.entity.value
      if (roleDrawer.mode.value === 'edit' && entity) {
        try {
          const echo = await fetchRolePermissions(entity.id)
          if (sequence !== permissionLoadSequence) {
            return
          }
          permissionValues.value = mapPermissionIdsToCodes(resourcesResult.items, echo.permissionIds)
        }
        catch (error) {
          if (sequence !== permissionLoadSequence) {
            return
          }
          permissionLoadError.value = error
          permissionLoadStatus.value = 'error'
        }
      }
    }
    catch (error) {
      if (sequence !== permissionLoadSequence) {
        return
      }
      permissionLoadError.value = error
      permissionLoadStatus.value = 'error'
    }
  }

  watch(roleDrawer.visible, (visible) => {
    if (!visible) {
      permissionLoadSequence += 1
      permissionTree.value = []
      permissionValues.value = []
      permissionResources.value = []
      permissionLoadStatus.value = 'idle'
      permissionLoadError.value = null
      return
    }
    void loadPermissionSection()
  })

  function setPermissionValues(values: CrudKey[]): void {
    permissionValues.value = [...new Set(values)]
  }

  const roleStatusAction = useConfirmedCrudAction<
    { enabled: boolean, role: SystemRole },
    RoleMutationResult
  >({
    action: ({ enabled, role }) => updateRoleStatus(role.id, enabled),
    confirm: ({ enabled, role }) => ({
      content: `确认${enabled ? '启用' : '停用'}角色“${role.name}”吗？停用后持有该角色的用户将立即失去其权限。`,
      confirmText: enabled ? '启用' : '停用',
      danger: !enabled,
      title: `${enabled ? '启用' : '停用'}角色`,
    }),
    onSuccess: async () => {
      await roleList.refresh()
    },
    successMessage: (_payload, result) => result.message,
  })

  /**
   * 删除前先统计已分配用户数（真实 total），统计失败时不展示数字，
   * 只提示删除后所有持有该角色的用户将失去权限。
   */
  async function deleteWithImpact(role: SystemRole): Promise<{ message: string }> {
    let userCount: number | null = null
    try {
      const result = await fetchUsers({ page: 1, pageSize: 1, roleId: role.id })
      userCount = result.total
    }
    catch {
      userCount = null
    }

    const impact = userCount !== null
      ? `该角色当前已分配 ${userCount} 名用户。删除后，这些用户将失去该角色授予的全部权限，无法恢复。`
      : '已分配用户数量暂无法获取。删除后，所有持有该角色的用户将失去其授予的全部权限，无法恢复。'

    const confirmed = await confirmAndRun({
      content: `角色“${role.name}”（${role.code}）将被永久删除。${impact}`,
      confirmText: '删除',
      danger: true,
      title: '删除角色',
    }, () => deleteRole(role.id))
    if (!confirmed.confirmed) {
      return { message: '' }
    }
    return confirmed.value
  }

  const deleteRunningRef = ref(false)

  const roleDeleteAction = {
    running: readonly(deleteRunningRef),
    async run(role: SystemRole): Promise<void> {
      if (deleteRunningRef.value) {
        return
      }
      deleteRunningRef.value = true
      try {
        const result = await deleteWithImpact(role)
        if (result.message) {
          await feedback.message('success', result.message)
          await roleList.refresh()
        }
      }
      catch (error) {
        await feedback.messageError(error)
      }
      finally {
        deleteRunningRef.value = false
      }
    },
  }

  return {
    permissionCount,
    permissionLoadError,
    permissionLoadStatus,
    permissionTree,
    permissionValues,
    roleDeleteAction,
    roleDrawer,
    roleList,
    roleStatusAction,
    selectedPermissionCount,
    setPermissionValues,
  }
}

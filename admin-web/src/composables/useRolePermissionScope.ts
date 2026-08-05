import type {
  SystemDataScope,
  SystemDepartmentTreeNode,
  SystemRole,
} from '@/types/system-management'
import { computed, onScopeDispose, ref, shallowRef } from 'vue'
import {
  fetchRoleDepartments,
  setRoleDepartments,
  updateRole,
} from '@/api/modules/roles'
import {
  fetchDepartmentTree,
} from '@/api/modules/system-management'
import { DATA_SCOPE_META } from '@/utils/system-role'
import { useAppFeedback } from './useAppFeedback'
import { usePermissionAccess } from './usePermissionAccess'

export type RoleTreeStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'

export interface RolePermissionScopeState {
  departmentIds: string[]
  departmentTree: SystemDepartmentTreeNode[] | null
  dataScope: SystemDataScope
  role: SystemRole | null
  visible: boolean
}

function createState(): RolePermissionScopeState {
  return {
    departmentIds: [],
    departmentTree: null,
    dataScope: 'SELF',
    role: null,
    visible: false,
  }
}

export function dataScopeDescription(dataScope: SystemDataScope): string {
  return DATA_SCOPE_META[dataScope]?.description ?? ''
}

export interface RolePermissionScopeOptions {
  /** 数据范围保存成功后回调（用于刷新角色列表等外部状态）。 */
  onScopeSaved?: () => void | Promise<void>
}

export function useRolePermissionScope(options: RolePermissionScopeOptions = {}) {
  const feedback = useAppFeedback()
  const { canAccess } = usePermissionAccess()

  const state = shallowRef<RolePermissionScopeState>(createState())
  const departmentStatus = ref<RoleTreeStatus>('idle')
  const departmentError = shallowRef<unknown>(null)
  const saving = ref(false)

  let disposed = false

  const canReadDepartments = computed(() => canAccess({ permissions: ['system:dept:list'] }))
  const canEditScope = computed(() => canAccess({ permissions: ['system:role:data-scope'] }))

  const selectedDepartmentCount = computed(() => state.value.departmentIds.length)
  const customDepartmentVisible = computed(() => state.value.dataScope === 'CUSTOM')

  async function loadDepartments(signal: AbortSignal): Promise<boolean> {
    if (!canReadDepartments.value) {
      departmentStatus.value = 'unavailable'
      departmentError.value = null
      state.value = { ...state.value, departmentTree: null }
      return false
    }
    departmentStatus.value = 'loading'
    try {
      const result = await fetchDepartmentTree(signal)
      if (disposed || signal.aborted) {
        return false
      }
      state.value = { ...state.value, departmentTree: result.items }
      departmentStatus.value = 'ready'
      return true
    }
    catch (error) {
      if (disposed || signal.aborted) {
        return false
      }
      state.value = { ...state.value, departmentTree: null }
      departmentError.value = error
      departmentStatus.value = 'error'
      return false
    }
  }

  /** 回显角色已配置的部门范围（仅 CUSTOM 场景使用）。 */
  async function loadDepartmentIds(roleId: string, signal: AbortSignal): Promise<void> {
    try {
      const result = await fetchRoleDepartments(roleId, signal)
      if (disposed || signal.aborted) {
        return
      }
      state.value = { ...state.value, departmentIds: result.departmentIds }
    }
    catch {
      // 回显失败保持为空，面板提示以本次勾选为准。
    }
  }

  function open(role: SystemRole): void {
    state.value = {
      ...createState(),
      dataScope: role.dataScope,
      role,
      visible: true,
    }
    departmentStatus.value = 'idle'
    departmentError.value = null
    const controller = new AbortController()
    void loadDepartments(controller.signal)
    void loadDepartmentIds(role.id, controller.signal)
  }

  function close(): void {
    if (saving.value) {
      return
    }
    state.value = createState()
  }

  function setVisible(visible: boolean): void {
    if (!visible) {
      close()
    }
  }

  function setDataScope(dataScope: SystemDataScope): void {
    state.value = { ...state.value, dataScope }
  }

  function setDepartmentIds(ids: Array<string | number>): void {
    state.value = { ...state.value, departmentIds: [...new Set(ids.map(String))] }
  }

  async function saveScope(): Promise<void> {
    const role = state.value.role
    if (!role || saving.value) {
      return
    }
    saving.value = true
    try {
      if (state.value.dataScope === 'CUSTOM') {
        await setRoleDepartments(role.id, state.value.departmentIds)
      }
      const result = await updateRole(role.id, { dataScope: state.value.dataScope })
      await feedback.message('success', result.message)
      state.value = { ...state.value, role: { ...role, dataScope: state.value.dataScope } }
      await options.onScopeSaved?.()
    }
    catch (error) {
      await feedback.messageError(error)
    }
    finally {
      saving.value = false
    }
  }

  onScopeDispose(() => {
    disposed = true
  })

  return {
    canEditScope,
    canReadDepartments,
    close,
    customDepartmentVisible,
    departmentError,
    departmentStatus,
    open,
    saveScope,
    saving,
    selectedDepartmentCount,
    setDataScope,
    setDepartmentIds,
    setVisible,
    state,
  }
}

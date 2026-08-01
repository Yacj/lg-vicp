import type { CurrentUserInfo, UserDataScope, UserDepartment } from '@/types/user'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { fetchCurrentUserInfo } from '@/api/modules/auth'
import { hasAllPermissions, hasAnyPermission, hasPermission } from '@/permissions/rbac'
import { B_ADMIN_CLIENT } from '@/types/auth'
import { HttpRequestError } from '@/types/error'

export const useUserStore = defineStore('user', () => {
  const profile = ref<CurrentUserInfo['user'] | null>(null)
  const departments = ref<UserDepartment[]>([])
  const roles = ref<string[]>([])
  const permissions = ref<string[]>([])
  const dataScopes = ref<UserDataScope[]>([])

  const isSuperAdmin = computed(() => profile.value?.role === 'SUPER_ADMIN')
  const permissionSet = computed(() => new Set(permissions.value))

  function applyUserInfo(info: CurrentUserInfo): void {
    if (info.user.clientType !== B_ADMIN_CLIENT || info.user.role === 'NORMAL_USER') {
      throw new HttpRequestError('当前账号不能进入管理后台', { status: 403 })
    }
    profile.value = info.user
    departments.value = info.departments
    roles.value = info.roles
    permissions.value = info.permissions
    dataScopes.value = info.dataScopes
  }

  async function loadUserInfo(): Promise<CurrentUserInfo> {
    const info = await fetchCurrentUserInfo()
    applyUserInfo(info)
    return info
  }

  function reset(): void {
    profile.value = null
    departments.value = []
    roles.value = []
    permissions.value = []
    dataScopes.value = []
  }

  return {
    applyUserInfo,
    dataScopes,
    departments,
    hasAllPermissions: (required: string[]) => hasAllPermissions(permissionSet.value, required, isSuperAdmin.value),
    hasAnyPermission: (required: string[]) => hasAnyPermission(permissionSet.value, required, isSuperAdmin.value),
    hasPermission: (required: string) => hasPermission(permissionSet.value, required, isSuperAdmin.value),
    isSuperAdmin,
    loadUserInfo,
    permissions,
    profile,
    reset,
    roles,
  }
})

import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useUserStore } from '@/stores/user'

export type PermissionMatchMode = 'all' | 'any'

export interface PermissionRequirement {
  permissions?: readonly string[]
  permissionMatch?: PermissionMatchMode
}

export function usePermissionAccess() {
  const userStore = useUserStore()

  function canAccess(requirement?: PermissionRequirement): boolean {
    const permissions = [...(requirement?.permissions ?? [])]
    if (permissions.length === 0) {
      return true
    }
    return requirement?.permissionMatch === 'all'
      ? userStore.hasAllPermissions(permissions)
      : userStore.hasAnyPermission(permissions)
  }

  function filterPermitted<T extends PermissionRequirement>(items: readonly T[]): T[] {
    return items.filter(item => canAccess(item))
  }

  function permitted(requirement: MaybeRefOrGetter<PermissionRequirement>) {
    return computed(() => canAccess(toValue(requirement)))
  }

  return {
    canAccess,
    filterPermitted,
    permitted,
  }
}
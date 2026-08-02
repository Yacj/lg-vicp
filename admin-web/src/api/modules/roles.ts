import type { PageResult } from '@/types/api'
import type {
  ItemListResult,
  MutationMessage,
  RoleDepartmentIdsResult,
  RoleMutationResult,
  RolePageQuery,
  RolePermissionIdsResult,
  RolePermissionMutationResult,
  SystemRole,
  SystemRoleInput,
  SystemRoleUser,
  UpdateSystemRoleInput,
} from '@/types/system-management'
import { api } from '@/api/http/client'
import { fetchUserDetail, fetchUsers, setUserRoles } from './users'

export { fetchUserDetail, fetchUsers, setUserRoles }

const PLATFORM_PREFIX = '/api/v1/platform'

function resourcePath(resource: string, id: string): string {
  return `${PLATFORM_PREFIX}/${resource}/${encodeURIComponent(id)}`
}

export function fetchRoles(signal?: AbortSignal): Promise<ItemListResult<SystemRole>> {
  return api.get<ItemListResult<SystemRole>>(`${PLATFORM_PREFIX}/roles`, { signal })
}

export function createRole(input: SystemRoleInput): Promise<RoleMutationResult> {
  return api.post<RoleMutationResult>(`${PLATFORM_PREFIX}/roles`, input)
}

export function updateRole(id: string, input: UpdateSystemRoleInput): Promise<RoleMutationResult> {
  return api.patch<RoleMutationResult>(resourcePath('roles', id), input)
}

export function updateRoleStatus(id: string, enabled: boolean): Promise<RoleMutationResult> {
  return api.patch<RoleMutationResult>(`${resourcePath('roles', id)}/status`, { enabled })
}

export function deleteRole(id: string): Promise<MutationMessage> {
  return api.delete<MutationMessage>(resourcePath('roles', id))
}

export function setRolePermissions(
  id: string,
  permissionIds: string[],
): Promise<RolePermissionMutationResult> {
  return api.put<RolePermissionMutationResult>(
    `${resourcePath('roles', id)}/permissions`,
    { permissionIds },
  )
}

export function fetchRolePermissions(id: string, signal?: AbortSignal): Promise<RolePermissionIdsResult> {
  return api.get<RolePermissionIdsResult>(`${resourcePath('roles', id)}/permissions`, { signal })
}

export function fetchRoleDepartments(id: string, signal?: AbortSignal): Promise<RoleDepartmentIdsResult> {
  return api.get<RoleDepartmentIdsResult>(`${resourcePath('roles', id)}/departments`, { signal })
}

export function setRoleDepartments(id: string, departmentIds: string[]): Promise<MutationMessage> {
  return api.put<MutationMessage>(`${resourcePath('roles', id)}/departments`, { ids: departmentIds })
}

export function fetchRoleUsers(
  id: string,
  query: RolePageQuery,
  signal?: AbortSignal,
): Promise<PageResult<SystemRoleUser>> {
  return api.get<PageResult<SystemRoleUser>>(`${resourcePath('roles', id)}/users`, {
    params: query,
    signal,
  })
}
import type { PageResult } from '@/types/api'
import type {
  CreateSystemUserInput,
  MutationMessage,
  SystemDepartmentMember,
  SystemUserDetail,
  SystemUserQuery,
  UpdateSystemUserInput,
  UserImportResult,
  UserMutationResult,
} from '@/types/system-management'
import { api, httpClient } from '@/api/http/client'

const PLATFORM_PREFIX = '/api/v1/platform'

function resourcePath(id: string): string {
  return `${PLATFORM_PREFIX}/users/${encodeURIComponent(id)}`
}

export function fetchUsers(
  query: SystemUserQuery,
  signal?: AbortSignal,
): Promise<PageResult<SystemDepartmentMember>> {
  return api.get<PageResult<SystemDepartmentMember>>(`${PLATFORM_PREFIX}/users`, {
    params: query,
    signal,
  })
}

export function fetchUserDetail(id: string): Promise<SystemUserDetail> {
  return api.get<SystemUserDetail>(resourcePath(id))
}

export function createUser(input: CreateSystemUserInput): Promise<UserMutationResult> {
  return api.post<UserMutationResult>(`${PLATFORM_PREFIX}/users`, input)
}

export function updateUser(id: string, input: UpdateSystemUserInput): Promise<UserMutationResult> {
  return api.patch<UserMutationResult>(resourcePath(id), input)
}

export function updateUserStatus(
  id: string,
  status: 'ACTIVE' | 'DISABLED',
): Promise<UserMutationResult> {
  return api.patch<UserMutationResult>(`${resourcePath(id)}/status`, { status })
}

export function deleteUser(id: string): Promise<MutationMessage> {
  return api.delete<MutationMessage>(resourcePath(id))
}

export function restoreUser(id: string): Promise<UserMutationResult> {
  return api.post<UserMutationResult>(`${resourcePath(id)}/restore`)
}

export function resetUserPassword(id: string, password: string): Promise<MutationMessage> {
  return api.post<MutationMessage>(`${resourcePath(id)}/reset-password`, { password })
}

export function setUserRoles(id: string, roleIds: string[]): Promise<MutationMessage> {
  return api.put<MutationMessage>(`${resourcePath(id)}/roles`, { roleIds })
}

export function setUserDepartments(id: string, ids: string[]): Promise<MutationMessage> {
  return api.put<MutationMessage>(`${resourcePath(id)}/departments`, { ids })
}

export function setUserPosts(id: string, ids: string[]): Promise<MutationMessage> {
  return api.put<MutationMessage>(`${resourcePath(id)}/posts`, { ids })
}

/** 导入用户 CSV：dryRun 仅校验不落库；失败行明细由后端逐行返回。 */
export function importUsers(input: { csv: string; dryRun?: boolean }): Promise<UserImportResult> {
  return api.post<UserImportResult>(`${PLATFORM_PREFIX}/users/import`, input)
}

/**
 * 导出用户 CSV：后端直接返回 text/csv（含 BOM），
 * 不走统一 JSON 契约，因此绕过 api 包装直接使用 httpClient（拦截器仍会附加令牌）。
 */
export async function exportUsersCsv(signal?: AbortSignal): Promise<Blob> {
  const response = await httpClient.request<Blob>({
    method: 'GET',
    responseType: 'blob',
    signal,
    url: `${PLATFORM_PREFIX}/users/export`,
  })
  return response.data
}
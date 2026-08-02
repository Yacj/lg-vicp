import type { PageResult } from '@/types/api'
import type {
  CreateSystemDepartmentInput,
  CreateSystemDictionaryInput,
  CreateSystemMenuInput,
  DepartmentMutationResult,
  DictionaryItemMutationResult,
  DictionaryMutationResult,
  ItemListResult,
  MenuMutationResult,
  MutationMessage,
  PermissionResourceListResult,
  PostMutationResult,
  SystemDepartmentMember,
  SystemDepartmentMemberQuery,
  SystemDepartmentTreeNode,
  SystemDictionary,
  SystemDictionaryItem,
  SystemDictionaryItemInput,
  SystemMenu,
  SystemPost,
  SystemPostInput,
  SystemPostPageQuery,
  UpdateSystemDepartmentInput,
  UpdateSystemDictionaryInput,
  UpdateSystemMenuInput,
} from '@/types/system-management'
import { api } from '@/api/http/client'

const PLATFORM_PREFIX = '/api/v1/platform'

function resourcePath(resource: string, id: string): string {
  return `${PLATFORM_PREFIX}/${resource}/${encodeURIComponent(id)}`
}

export function fetchMenus(signal?: AbortSignal): Promise<ItemListResult<SystemMenu>> {
  return api.get<ItemListResult<SystemMenu>>(`${PLATFORM_PREFIX}/menus`, { signal })
}

export function fetchPermissionResources(signal?: AbortSignal): Promise<PermissionResourceListResult> {
  return api.get<PermissionResourceListResult>(`${PLATFORM_PREFIX}/permissions`, { signal })
}

export function createMenu(input: CreateSystemMenuInput): Promise<MenuMutationResult> {
  return api.post<MenuMutationResult>(`${PLATFORM_PREFIX}/menus`, input)
}

export function updateMenu(id: string, input: UpdateSystemMenuInput): Promise<MenuMutationResult> {
  return api.patch<MenuMutationResult>(resourcePath('menus', id), input)
}

export function updateMenuStatus(id: string, enabled: boolean): Promise<MenuMutationResult> {
  return updateMenu(id, { enabled })
}

export function deleteMenu(id: string): Promise<MutationMessage> {
  return api.delete<MutationMessage>(resourcePath('menus', id))
}


export function fetchDepartmentTree(signal?: AbortSignal): Promise<ItemListResult<SystemDepartmentTreeNode>> {
  return api.get<ItemListResult<SystemDepartmentTreeNode>>(`${PLATFORM_PREFIX}/departments/tree`, { signal })
}

export function createDepartment(input: CreateSystemDepartmentInput): Promise<DepartmentMutationResult> {
  return api.post<DepartmentMutationResult>(`${PLATFORM_PREFIX}/departments`, input)
}

export function updateDepartment(
  id: string,
  input: UpdateSystemDepartmentInput,
): Promise<DepartmentMutationResult> {
  return api.patch<DepartmentMutationResult>(resourcePath('departments', id), input)
}

export function updateDepartmentStatus(id: string, enabled: boolean): Promise<DepartmentMutationResult> {
  return api.patch<DepartmentMutationResult>(`${resourcePath('departments', id)}/status`, { enabled })
}

export function deleteDepartment(id: string): Promise<MutationMessage> {
  return api.delete<MutationMessage>(resourcePath('departments', id))
}

export function fetchDepartmentMembers(
  query: SystemDepartmentMemberQuery,
  signal?: AbortSignal,
): Promise<PageResult<SystemDepartmentMember>> {
  return api.get<PageResult<SystemDepartmentMember>>(`${PLATFORM_PREFIX}/users`, { params: query, signal })
}

export function fetchPosts(
  query: SystemPostPageQuery,
  signal?: AbortSignal,
): Promise<PageResult<SystemPost>> {
  return api.get<PageResult<SystemPost>>(`${PLATFORM_PREFIX}/posts`, { params: query, signal })
}

export function createPost(input: SystemPostInput): Promise<PostMutationResult> {
  return api.post<PostMutationResult>(`${PLATFORM_PREFIX}/posts`, input)
}

export function updatePost(id: string, input: Partial<SystemPostInput>): Promise<PostMutationResult> {
  return api.patch<PostMutationResult>(resourcePath('posts', id), input)
}

export function updatePostStatus(id: string, enabled: boolean): Promise<PostMutationResult> {
  return api.patch<PostMutationResult>(`${resourcePath('posts', id)}/status`, { enabled })
}

export function deletePost(id: string): Promise<MutationMessage> {
  return api.delete<MutationMessage>(resourcePath('posts', id))
}

export function fetchDictionaries(signal?: AbortSignal): Promise<ItemListResult<SystemDictionary>> {
  return api.get<ItemListResult<SystemDictionary>>(`${PLATFORM_PREFIX}/dictionaries`, { signal })
}

export function createDictionary(input: CreateSystemDictionaryInput): Promise<DictionaryMutationResult> {
  return api.post<DictionaryMutationResult>(`${PLATFORM_PREFIX}/dictionaries`, input)
}

export function updateDictionary(
  id: string,
  input: UpdateSystemDictionaryInput,
): Promise<DictionaryMutationResult> {
  return api.patch<DictionaryMutationResult>(resourcePath('dictionaries', id), input)
}

export function deleteDictionary(id: string): Promise<MutationMessage> {
  return api.delete<MutationMessage>(resourcePath('dictionaries', id))
}

export function fetchDictionaryItems(
  dictionaryId: string,
  signal?: AbortSignal,
): Promise<ItemListResult<SystemDictionaryItem>> {
  return api.get<ItemListResult<SystemDictionaryItem>>(
    `${resourcePath('dictionaries', dictionaryId)}/items`,
    { signal },
  )
}

export function createDictionaryItem(
  dictionaryId: string,
  input: SystemDictionaryItemInput,
): Promise<DictionaryItemMutationResult> {
  return api.post<DictionaryItemMutationResult>(
    `${resourcePath('dictionaries', dictionaryId)}/items`,
    input,
  )
}

export function updateDictionaryItem(
  dictionaryId: string,
  itemId: string,
  input: Partial<SystemDictionaryItemInput>,
): Promise<DictionaryItemMutationResult> {
  return api.patch<DictionaryItemMutationResult>(
    `${resourcePath('dictionaries', dictionaryId)}/items/${encodeURIComponent(itemId)}`,
    input,
  )
}

export function deleteDictionaryItem(dictionaryId: string, itemId: string): Promise<MutationMessage> {
  return api.delete<MutationMessage>(
    `${resourcePath('dictionaries', dictionaryId)}/items/${encodeURIComponent(itemId)}`,
  )
}
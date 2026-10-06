import type {
  CreateProjectInput,
  ProjectDetailResult,
  ProjectMutationResult,
  ProjectPageQuery,
  ProjectPageResult,
  ProjectStatistics,
  ProjectVisibility,
  UpdateProjectInput,
} from '@/types/project'
import { api } from '@/api/http/client'

/** 我的项目：工作台接口（GET /api/v1/workspace/projects/my）。 */
export function fetchMyProjects(query: ProjectPageQuery, signal?: AbortSignal): Promise<ProjectPageResult> {
  return api.get<ProjectPageResult>('/api/v1/workspace/projects/my', { params: query, signal })
}

/** 公开项目：共用接口（GET /api/v1/projects/public）。 */
export function fetchPublicProjects(query: ProjectPageQuery, signal?: AbortSignal): Promise<ProjectPageResult> {
  return api.get<ProjectPageResult>('/api/v1/projects/public', { params: query, signal })
}

/** 平台项目列表只发送后端 schema 接受的字段，避免空 visibility 触发 400。 */
export function toPlatformProjectListParams(query: ProjectPageQuery): {
  page?: number
  pageSize?: number
  visibility?: ProjectVisibility
  keyword?: string
} {
  const keyword = query.keyword?.trim()
  return {
    ...(query.page ? { page: query.page } : {}),
    ...(query.pageSize ? { pageSize: query.pageSize } : {}),
    ...(query.visibility === 'PUBLIC' || query.visibility === 'PRIVATE' || query.visibility === 'DEPARTMENT'
      ? { visibility: query.visibility }
      : {}),
    ...(keyword ? { keyword } : {}),
  }
}

/** 全部项目：平台接口（GET /api/v1/platform/projects，需 system:project:list）。 */
export function fetchPlatformProjects(query: ProjectPageQuery, signal?: AbortSignal): Promise<ProjectPageResult> {
  return api.get<ProjectPageResult>('/api/v1/platform/projects', {
    params: toPlatformProjectListParams(query),
    signal,
  })
}

/** 项目统计：平台接口（GET /api/v1/platform/projects/statistics）。 */
export function fetchProjectStatistics(signal?: AbortSignal): Promise<ProjectStatistics> {
  return api.get<ProjectStatistics>('/api/v1/platform/projects/statistics', { signal })
}

export function fetchProjectDetail(projectId: string, signal?: AbortSignal): Promise<ProjectDetailResult> {
  return api.get<ProjectDetailResult>(`/api/v1/projects/${encodeURIComponent(projectId)}`, { signal })
}

/** 创建项目（POST /api/v1/workspace/projects，需 project.create）。 */
export function createProject(input: CreateProjectInput): Promise<ProjectMutationResult> {
  return api.post<ProjectMutationResult>('/api/v1/workspace/projects', input)
}

/** 修改项目信息（PATCH /api/v1/workspace/projects/:id；仅创建者或超级管理员）。 */
export function updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectMutationResult> {
  return api.patch<ProjectMutationResult>(
    `/api/v1/workspace/projects/${encodeURIComponent(projectId)}`,
    input,
  )
}

/** 切换项目可见性（PATCH /api/v1/workspace/projects/:id/visibility；仅创建者或超级管理员）。 */
export function updateProjectVisibility(
  projectId: string,
  visibility: ProjectVisibility,
): Promise<ProjectMutationResult> {
  return api.patch<ProjectMutationResult>(
    `/api/v1/workspace/projects/${encodeURIComponent(projectId)}/visibility`,
    { visibility },
  )
}

/** 删除项目（DELETE /api/v1/workspace/projects/:id；仅创建者或超级管理员）。 */
export function deleteProject(projectId: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/v1/workspace/projects/${encodeURIComponent(projectId)}`)
}

/** 平台项目详情（GET /api/v1/platform/projects/:id）。 */
export function fetchPlatformProject(projectId: string, signal?: AbortSignal): Promise<ProjectDetailResult> {
  return api.get<ProjectDetailResult>(`/api/v1/platform/projects/${encodeURIComponent(projectId)}`, { signal })
}

/** 平台删除项目（DELETE /api/v1/platform/projects/:id）。 */
export function deletePlatformProject(projectId: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/v1/platform/projects/${encodeURIComponent(projectId)}`)
}

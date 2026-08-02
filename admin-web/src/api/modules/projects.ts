import type {
  CreateProjectInput,
  ProjectDetailResult,
  ProjectMutationResult,
  ProjectPageQuery,
  ProjectPageResult,
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

/** 全部项目：平台接口（GET /api/v1/platform/projects，需 system:project:list）。 */
export function fetchPlatformProjects(query: ProjectPageQuery, signal?: AbortSignal): Promise<ProjectPageResult> {
  return api.get<ProjectPageResult>('/api/v1/platform/projects', { params: query, signal })
}

/** 项目详情（GET /api/v1/projects/:id，私有项目仅创建者与超级管理员可见）。 */
export function fetchProjectDetail(projectId: string, signal?: AbortSignal): Promise<ProjectDetailResult> {
  return api.get<ProjectDetailResult>(`/api/v1/projects/${encodeURIComponent(projectId)}`, { signal })
}

/** 创建项目（POST /api/v1/workspace/projects，需 project.create）。 */
export function createProject(input: CreateProjectInput): Promise<ProjectMutationResult> {
  return api.post<ProjectMutationResult>('/api/v1/workspace/projects', input)
}

/** 修改项目名称/描述（PATCH /api/v1/workspace/projects/:id，仅创建者或超级管理员）。 */
export function updateProject(projectId: string, input: UpdateProjectInput): Promise<ProjectMutationResult> {
  return api.patch<ProjectMutationResult>(
    `/api/v1/workspace/projects/${encodeURIComponent(projectId)}`,
    input,
  )
}

/** 切换项目可见性（PATCH /api/v1/workspace/projects/:id/visibility，仅创建者或超级管理员）。 */
export function updateProjectVisibility(
  projectId: string,
  visibility: ProjectVisibility,
): Promise<ProjectMutationResult> {
  return api.patch<ProjectMutationResult>(
    `/api/v1/workspace/projects/${encodeURIComponent(projectId)}/visibility`,
    { visibility },
  )
}

/** 删除项目（DELETE /api/v1/workspace/projects/:id，仅创建者或超级管理员）。 */
export function deleteProject(projectId: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/v1/workspace/projects/${encodeURIComponent(projectId)}`)
}
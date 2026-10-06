import type {
  CreateProjectBody,
  PageQuery,
  ProjectListQuery,
  ProjectMemoryView,
  UpdateProjectBody,
  UpdateProjectMemoryBody,
  UpdateProjectVisibilityBody,
} from '../types'
import { request } from '../request'

export const projectApi = {
  /** C 端我的项目分页列表（GET /projects/my 被 B 端网关注定，客户端走 /client/projects） */
  getMy(params: ProjectListQuery = {}) {
    return request('GET', '/client/projects', { params })
  },

  /** 公开/部门可见项目（含历史 PUBLIC），不要用 getMy + scope=public 代替 */
  getPublic(params: PageQuery = {}) {
    return request('GET', '/projects/public', { params })
  },

  getDetail(id: string) {
    return request('GET', '/projects/{id}', { pathParams: { id } })
  },

  create(data: CreateProjectBody) {
    return request('POST', '/projects', { data })
  },

  /** 更新项目基础信息（C 端 PATCH /client/projects/:id，可见性走 updateVisibility 专用接口） */
  update(id: string, data: UpdateProjectBody) {
    return request('PATCH', '/client/projects/{id}', { pathParams: { id }, data })
  },

  /** 切换项目可见性（C 端 PATCH /client/projects/:id/visibility） */
  updateVisibility(id: string, data: UpdateProjectVisibilityBody) {
    return request('PATCH', '/client/projects/{id}/visibility', { pathParams: { id }, data })
  },

  /** 删除项目（C 端 DELETE /client/projects/:id，软删，不级联对话/报告） */
  remove(id: string) {
    return request('DELETE', '/client/projects/{id}', { pathParams: { id } })
  },

  listAiMemories(id: string, view: ProjectMemoryView = 'active') {
    return request('GET', '/projects/{id}/ai-memories', { pathParams: { id }, params: { view } })
  },

  updateAiMemory(id: string, memoryId: string, data: UpdateProjectMemoryBody) {
    return request('PUT', '/projects/{id}/ai-memories/{memoryId}', { pathParams: { id, memoryId }, data })
  },

  confirmAiMemory(id: string, memoryId: string) {
    return request('POST', '/projects/{id}/ai-memories/{memoryId}/confirm', { pathParams: { id, memoryId } })
  },

  rejectAiMemory(id: string, memoryId: string) {
    return request('POST', '/projects/{id}/ai-memories/{memoryId}/reject', { pathParams: { id, memoryId } })
  },
}

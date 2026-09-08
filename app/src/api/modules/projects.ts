import type { CreateProjectBody, PageQuery, ProjectListQuery, ProjectVisibility, UpdateProjectBody, UpdateProjectVisibilityBody } from '../types'
import { request } from '../request'

export const projectApi = {
  /** C 端我的项目分页列表（GET /projects/my 被 B 端网关注定，客户端走 /client/projects） */
  getMy(params: ProjectListQuery = {}) {
    return request('GET', '/client/projects', { params })
  },

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
}

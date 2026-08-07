import type { CreateProjectBody, PageQuery, ProjectListQuery, UpdateProjectBody } from '../types'
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

  /** 更新仅在 B 端工作台路由下提供（/api/v1/workspace/projects/:id） */
  update(id: string, data: UpdateProjectBody) {
    return request('PATCH', '/workspace/projects/{id}', { pathParams: { id }, data })
  },
}

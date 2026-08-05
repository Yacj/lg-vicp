import type { CreateProjectBody, PageQuery, UpdateProjectBody } from '../types'
import { request } from '../request'

export const projectApi = {
  /** C 端我的项目分页列表（GET /projects/my 被 B 端网关注定，客户端走 /client/projects） */
  getMy(params: PageQuery = {}) {
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

  update(id: string, data: UpdateProjectBody) {
    return request('PATCH', '/projects/{id}', { pathParams: { id }, data })
  },
}

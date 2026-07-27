import type { CreateProjectBody, PageQuery, ProjectVisibility, UpdateProjectBody } from '../types'
import { request } from '../request'

export const projectApi = {
  create(data: CreateProjectBody) {
    return request('POST', '/workspace/projects', { data })
  },

  getMine(params: PageQuery = {}) {
    return request('GET', '/workspace/projects/my', { params })
  },

  getPublic(params: PageQuery = {}) {
    return request('GET', '/projects/public', { params })
  },

  getDetail(id: string) {
    return request('GET', '/projects/{id}', { pathParams: { id } })
  },

  update(id: string, data: UpdateProjectBody) {
    return request('PATCH', '/workspace/projects/{id}', { pathParams: { id }, data })
  },

  updateVisibility(id: string, data: { visibility: ProjectVisibility }) {
    return request('PATCH', '/workspace/projects/{id}/visibility', { pathParams: { id }, data })
  },

  remove(id: string) {
    return request('DELETE', '/workspace/projects/{id}', { pathParams: { id } })
  },
}

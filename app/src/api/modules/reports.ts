import type { CreateReportBody, LinkReportProjectBody, ReportArtifactType, ReportListQuery } from '../types'
import { request } from '../request'

export const reportApi = {
  listTypes() {
    return request('GET', '/reports/types')
  },

  listMy(params: ReportListQuery = {}) {
    return request('GET', '/reports/my', { params })
  },

  create(data: CreateReportBody) {
    return request('POST', '/reports', { data })
  },

  getDetail(id: string) {
    return request('GET', '/reports/{id}', { pathParams: { id } })
  },

  linkProject(id: string, data: LinkReportProjectBody) {
    return request('PATCH', '/reports/{id}/project', { pathParams: { id }, data })
  },

  generate(id: string) {
    return request('POST', '/reports/{id}/generate', { pathParams: { id } })
  },

  retry(id: string) {
    return request('POST', '/reports/{id}/retry', { pathParams: { id } })
  },

  publish(id: string) {
    return request('POST', '/reports/{id}/publish', { pathParams: { id } })
  },

  getArtifactDownloadUrl(id: string, type: ReportArtifactType) {
    return request('GET', '/reports/{id}/artifacts/{type}/download-url', {
      pathParams: { id, type },
    })
  },

  remove(id: string) {
    return request('DELETE', '/reports/{id}', { pathParams: { id } })
  },
}

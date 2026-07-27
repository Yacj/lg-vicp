import type { CreateReportBody, ReportArtifactType } from '../types'
import { request } from '../request'

export const reportApi = {
  create(data: CreateReportBody) {
    return request('POST', '/reports', { data })
  },

  getDetail(id: string) {
    return request('GET', '/reports/{id}', { pathParams: { id } })
  },

  generate(id: string) {
    return request('POST', '/reports/{id}/generate', { pathParams: { id } })
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

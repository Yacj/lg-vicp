import type { FileListQuery, UploadIntentBody } from '../types'
import { request } from '../request'

export const fileApi = {
  list(params: FileListQuery = {}) {
    return request('GET', '/files/', { params })
  },

  createUploadIntent(data: UploadIntentBody) {
    return request('POST', '/files/upload-intents', { data })
  },

  complete(id: string) {
    return request('POST', '/files/{id}/complete', { pathParams: { id } })
  },

  getStatus(id: string) {
    return request('GET', '/files/{id}/status', { pathParams: { id } })
  },

  getDownloadUrl(id: string) {
    return request('GET', '/files/{id}/download-url', { pathParams: { id } })
  },

  remove(id: string) {
    return request('DELETE', '/files/{id}', { pathParams: { id } })
  },
}

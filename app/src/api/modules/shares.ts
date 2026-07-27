import type { CreateShareBody } from '../types'
import { request } from '../request'

export const shareApi = {
  create(data: CreateShareBody) {
    return request('POST', '/shares', { data })
  },

  disable(id: string) {
    return request('PATCH', '/shares/{id}/disable', { pathParams: { id } })
  },

  getPublic(token: string) {
    return request('GET', '/public/shares/{token}', { pathParams: { token } })
  },
}

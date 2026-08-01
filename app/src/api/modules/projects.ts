import type { PageQuery } from '../types'
import { request } from '../request'

export const projectApi = {
  getPublic(params: PageQuery = {}) {
    return request('GET', '/projects/public', { params })
  },
}

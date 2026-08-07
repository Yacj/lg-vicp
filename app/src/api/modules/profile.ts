import { request } from '../request'

export const profileApi = {
  getSummary() {
    return request('GET', '/client/profile/summary')
  },
}

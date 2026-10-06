import { request } from '../request'

export const profileApi = {
  getSummary() {
    return request('GET', '/client/profile/summary')
  },

  /** 当前用户可用于项目 DEPARTMENT 可见范围的部门（GET /client/me/departments） */
  getMyDepartments() {
    return request('GET', '/client/me/departments')
  },
}

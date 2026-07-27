import type { AuthClient, PasswordLoginBody, SmsLoginBody, SmsSendBody } from '../types'
import { request } from '../request'

export const authApi = {
  loginPassword(data: PasswordLoginBody) {
    return request('POST', '/auth/client/login/password', { data })
  },

  sendSms(data: SmsSendBody) {
    return request('POST', '/auth/client/sms/send', { data })
  },

  loginSms(data: SmsLoginBody) {
    return request('POST', '/auth/client/login/sms', { data })
  },

  loginWechat(data: { clientType: AuthClient, code: string }) {
    return request('POST', '/auth/client/login/wechat', { data })
  },

  refresh(data: { refreshToken: string }) {
    return request('POST', '/auth/refresh', { data })
  },

  logout(data: { refreshToken: string }) {
    return request('POST', '/auth/logout', { data })
  },

  getClientInfo() {
    return request('GET', '/auth/client/getInfo')
  },

  getCurrentUser() {
    return request('GET', '/auth/me')
  },
}

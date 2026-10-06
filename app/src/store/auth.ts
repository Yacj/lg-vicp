import type { AuthClient, ClientCapabilities, ClientInfo, ClientUser, LoginResult, RefreshResult } from '@/api/types'
import { defineStore } from 'pinia'

export type AuthUser = ClientUser

export interface AuthSession {
  accessToken: string
  refreshToken?: string
  expiresAt?: number | null
  user?: AuthUser | null
  clientType?: AuthClient
  capabilities?: ClientCapabilities | null
}

interface AuthState {
  accessToken: string
  refreshToken: string
  expiresAt: number | null
  user: AuthUser | null
  clientType: AuthClient
  capabilities: ClientCapabilities | null
  /** 来自登录结果。微信 loginCode / phoneCode 不进入本 store，也不持久化。 */
  passwordSet: boolean | null
  isFirstLogin: boolean
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    accessToken: '',
    refreshToken: '',
    expiresAt: null,
    user: null,
    clientType: 'C_APP',
    capabilities: null,
    passwordSet: null,
    isFirstLogin: false,
  }),

  getters: {
    isAuthenticated: state => Boolean(state.accessToken),
    isExpired: state => Boolean(state.expiresAt && state.expiresAt <= Date.now()),
  },

  actions: {
    setSession(session: AuthSession | LoginResult | RefreshResult) {
      this.accessToken = session.accessToken
      this.refreshToken = 'refreshToken' in session ? session.refreshToken || '' : this.refreshToken
      this.expiresAt = ('expiresAt' in session ? session.expiresAt : null)
        ?? ('refreshTokenExpiresAt' in session ? Date.parse(session.refreshTokenExpiresAt) : null)
      this.user = 'user' in session ? session.user || null : this.user
      this.clientType = ('clientType' in session && session.clientType) ? session.clientType : this.clientType
      if ('capabilities' in session) {
        this.capabilities = session.capabilities || null
      }
      if ('passwordSet' in session && typeof session.passwordSet === 'boolean') {
        this.passwordSet = session.passwordSet
      }
      if ('isFirstLogin' in session && typeof session.isFirstLogin === 'boolean') {
        this.isFirstLogin = session.isFirstLogin
      }
    },

    markPasswordSet(value = true) {
      this.passwordSet = value
    },

    setClientInfo(info: ClientInfo) {
      this.user = info.user
      this.clientType = info.user.clientType
      this.capabilities = info.capabilities
    },

    clearSession() {
      this.$reset()
    },
  },
})

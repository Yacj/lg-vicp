import type { LoginCredentials, StoredAuthSession } from '@/types/auth'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { loginBAdmin, logoutBAdmin } from '@/api/modules/auth'
import { B_ADMIN_CLIENT } from '@/types/auth'
import { HttpRequestError } from '@/types/error'
import { clearAuthSession, readAuthSession, writeAuthSession } from '@/utils/auth'

export type AuthStatus = 'anonymous' | 'authenticated' | 'authenticating' | 'restoring'

export const useAuthStore = defineStore('auth', () => {
  const initialSession = readAuthSession()
  const accessToken = ref(initialSession?.accessToken ?? '')
  const refreshToken = ref(initialSession?.refreshToken ?? '')
  const refreshTokenExpiresAt = ref(initialSession?.refreshTokenExpiresAt ?? '')
  const status = ref<AuthStatus>(initialSession ? 'restoring' : 'anonymous')

  const hasSession = computed(() => Boolean(accessToken.value && refreshToken.value))

  function replaceSession(session: StoredAuthSession): void {
    accessToken.value = session.accessToken
    refreshToken.value = session.refreshToken
    refreshTokenExpiresAt.value = session.refreshTokenExpiresAt
    writeAuthSession(session)
  }

  function clearSession(): void {
    accessToken.value = ''
    refreshToken.value = ''
    refreshTokenExpiresAt.value = ''
    status.value = 'anonymous'
    clearAuthSession()
  }

  async function login(credentials: LoginCredentials): Promise<void> {
    status.value = 'authenticating'
    try {
      const result = await loginBAdmin(credentials)
      if (result.user.clientType !== B_ADMIN_CLIENT || result.user.role === 'NORMAL_USER') {
        throw new HttpRequestError('当前账号不能进入 B 端管理后台', { status: 403 })
      }
      replaceSession({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        refreshTokenExpiresAt: result.refreshTokenExpiresAt,
        clientType: B_ADMIN_CLIENT,
      })
      status.value = 'authenticated'
    }
    catch (error) {
      clearSession()
      throw error
    }
  }

  async function logout(): Promise<boolean> {
    const token = refreshToken.value
    try {
      if (token) {
        await logoutBAdmin(token)
      }
      return true
    }
    catch {
      return false
    }
    finally {
      clearSession()
    }
  }

  function markAuthenticated(): void {
    if (hasSession.value) {
      status.value = 'authenticated'
    }
  }

  return {
    accessToken,
    clearSession,
    hasSession,
    login,
    logout,
    markAuthenticated,
    refreshToken,
    refreshTokenExpiresAt,
    replaceSession,
    status,
  }
})

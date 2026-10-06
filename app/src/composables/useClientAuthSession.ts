import type { ApiEnvelope, ClientInfo, LoginResult } from '@/api/types'
import { authApi } from '@/api/modules/auth'
import { useAuthStore } from '@/store/auth'
import { applyAuthRedirect, getLoginRedirect } from '@/utils/authRedirect'

function isClientInfo(value: unknown): value is ClientInfo {
  if (!value || typeof value !== 'object') {
    return false
  }

  const clientInfo = value as Partial<ClientInfo>
  return Boolean(clientInfo.user && clientInfo.capabilities)
}

export function useClientAuthSession() {
  const router = useRouter()
  const route = useRoute()
  const authStore = useAuthStore()

  async function applyAuthResult(result: LoginResult) {
    if (!result.accessToken) {
      throw new Error('登录响应缺少访问令牌')
    }

    authStore.setSession(result)

    try {
      const infoResponse = await authApi.getClientInfo().send() as ApiEnvelope<unknown>
      if (isClientInfo(infoResponse.data)) {
        authStore.setClientInfo(infoResponse.data)
      }
    }
    catch (error) {
      if (!authStore.isAuthenticated) {
        throw error
      }
    }
  }

  async function redirectAfterAuth() {
    await applyAuthRedirect(router, getLoginRedirect(route))
  }

  return {
    applyAuthResult,
    redirectAfterAuth,
  }
}

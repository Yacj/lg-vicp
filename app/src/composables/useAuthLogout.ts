import { authApi } from '@/api/modules/auth'

export function useAuthLogout() {
  const router = useRouter()
  const authStore = useAuthStore()
  const globalDialog = useGlobalDialog()
  const globalLoading = useGlobalLoading()
  const { info } = useGlobalToast()

  function requestLogout() {
    globalDialog.confirm({
      title: '退出登录',
      msg: '退出后需要重新登录才能查看项目和对话记录。',
      confirmButtonText: '退出登录',
      cancelButtonText: '取消',
      success() {
        void logout()
      },
    })
  }

  async function logout() {
    globalLoading.loading('正在退出登录...')
    try {
      if (authStore.refreshToken) {
        await authApi.logout({ refreshToken: authStore.refreshToken }).send()
      }
    }
    catch {
      // 服务端退出失败时仍清理本地会话，避免继续使用失效凭证。
    }
    finally {
      authStore.clearSession()
      globalLoading.close()
      info('已退出登录')
      await router.replaceAll({ name: 'home' })
    }
  }

  return {
    requestLogout,
  }
}

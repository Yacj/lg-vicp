import { useRoute, useRouter } from '@wot-ui/router'
import { useAuthStore } from '@/store/auth'

type LoginRedirect = string

interface RequireLoginOptions {
  redirect?: LoginRedirect
  message?: string
  showToast?: boolean
}

const defaultLoginMessage = '暂无登录'

export function useAuthGate() {
  const router = useRouter()
  const route = useRoute()
  const authStore = useAuthStore()
  const toast = useGlobalToast()

  function goLogin(options: RequireLoginOptions = {}) {
    const redirect = options.redirect || route.fullPath

    if (options.showToast !== false) {
      toast.warning(options.message || defaultLoginMessage)
    }

    const timer = setTimeout(() => {
      clearTimeout(timer)
      router.push({ name: 'login', query: { redirect } }).catch(() => {})
    }, options.showToast === false ? 0 : 300)
  }

  function requireLogin(options: RequireLoginOptions = {}) {
    if (authStore.isAuthenticated) {
      return true
    }

    goLogin(options)
    return false
  }

  return {
    isAuthenticated: computed(() => authStore.isAuthenticated),
    user: computed(() => authStore.user),
    goLogin,
    requireLogin,
  }
}

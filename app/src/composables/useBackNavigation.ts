import { useRouter } from '@wot-ui/router'

/**
 * 统一处理页面返回：优先返回页面栈，根页面回到指定 Tab（默认首页）。
 * getCurrentPages 是 uni-app 在 H5、App 和各小程序端都提供的页面栈 API。
 */
export function useBackNavigation(fallbackTab: 'home' | 'assistant' = 'home') {
  const router = useRouter()

  function goBack() {
    if (getCurrentPages().length > 1) {
      router.back()
      return
    }

    router.pushTab({ name: fallbackTab })
  }

  return {
    goBack,
  }
}

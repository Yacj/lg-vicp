import type { NavigationGuardReturn, RouteLocationNormalized, Router } from 'vue-router'
import NProgress from 'nprogress'
import { useAuthStore } from '@/stores/auth'
import { useRouteStore } from '@/stores/route'
import { useUserStore } from '@/stores/user'
import { getAppEnv } from '@/utils/env'

import 'nprogress/nprogress.css'

NProgress.configure({ showSpinner: false })

let reportedProjectionSignature = ''

function loginRedirect(to: RouteLocationNormalized): NavigationGuardReturn {
  return {
    name: 'Login',
    query: to.fullPath === '/' ? undefined : { redirect: to.fullPath },
  }
}

async function ensureAuthenticatedContext(router: Router): Promise<void> {
  const authStore = useAuthStore()
  const userStore = useUserStore()
  const routeStore = useRouteStore()

  if (!userStore.profile) {
    await userStore.loadUserInfo()
  }
  if (!routeStore.dynamicRoutesReady) {
    await routeStore.initialize(router)
  }
  authStore.markAuthenticated()

  if (routeStore.projectionIssues.length > 0) {
    const signature = routeStore.projectionIssues
      .map(issue => `${issue.menuId}:${issue.component}:${issue.reason}`)
      .join('|')
    if (signature !== reportedProjectionSignature) {
      reportedProjectionSignature = signature
      // useAppFeedback().notify(
      //   'warning',
      //   '部分动态菜单未加载',
      //   `有 ${routeStore.projectionIssues.length} 个菜单未命中本地组件白名单，请管理员检查菜单 component 配置。`,
      // )
    }
  }
}

export function setupRouterGuards(router: Router): void {
  router.beforeEach(async (to) => {
    NProgress.start()
    const authStore = useAuthStore()
    const userStore = useUserStore()
    const routeStore = useRouteStore()

    if (to.name === 'Login') {
      if (!authStore.hasSession) {
        return true
      }
      try {
        await ensureAuthenticatedContext(router)
        return typeof to.query.redirect === 'string' ? to.query.redirect : '/'
      }
      catch {
        authStore.clearSession()
        userStore.reset()
        routeStore.reset(router)
        return true
      }
    }

    if (!authStore.hasSession) {
      return to.name === 'Forbidden' || to.name === 'NotFound'
        ? true
        : loginRedirect(to)
    }

    const routesWereReady = routeStore.dynamicRoutesReady
    try {
      await ensureAuthenticatedContext(router)
    }
    catch {
      authStore.clearSession()
      userStore.reset()
      routeStore.reset(router)
      return loginRedirect(to)
    }

    if (!routesWereReady) {
      return to.fullPath
    }

    const requiredPermissions = to.meta.permissions ?? []
    if (!userStore.hasAnyPermission(requiredPermissions)) {
      return { name: 'Forbidden', query: { from: to.fullPath } }
    }

    return true
  })

  router.afterEach((to) => {
    NProgress.done()
    const appTitle = getAppEnv().appTitle
    const pageTitle = typeof to.meta.title === 'string' ? to.meta.title : ''
    document.title = pageTitle ? `${pageTitle} - ${appTitle}` : appTitle
  })

  router.onError((error) => {
    NProgress.done()
    console.error('路由错误:', error)
  })
}

import { createRouter, createWebHashHistory } from 'vue-router'
import { setupRouterGuards } from './guards'
import { staticRoutes } from './routes'

export function createAppRouter() {
  const router = createRouter({
    history: createWebHashHistory(),
    routes: staticRoutes,
    scrollBehavior: () => ({ left: 0, top: 0 }),
  })

  setupRouterGuards(router)
  return router
}

const router = createAppRouter()

export default router

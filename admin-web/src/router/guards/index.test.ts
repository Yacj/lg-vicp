import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useRouteStore } from '@/stores/route'
import { useUserStore } from '@/stores/user'
import { setupRouterGuards } from './index'

const EmptyView = defineComponent({ template: '<div />' })

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('permission router guard', () => {
  it('falls back to 403 when the current user lacks page permission', async () => {
    const authStore = useAuthStore()
    const userStore = useUserStore()
    const routeStore = useRouteStore()

    authStore.replaceSession({
      accessToken: 'access-token',
      clientType: 'B_ADMIN',
      refreshToken: 'refresh-token',
      refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z',
    })
    userStore.applyUserInfo({
      dataScopes: [],
      departments: [],
      permissions: ['system:user:list'],
      roles: ['channel_operator'],
      user: {
        channelType: 'DEALER',
        clientType: 'B_ADMIN',
        displayName: '渠道用户',
        email: null,
        id: 'user-id',
        phone: null,
        role: 'CHANNEL_USER',
        status: 'ACTIVE',
      },
    })
    routeStore.dynamicRoutesReady = true

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', name: 'Login', component: EmptyView },
        { path: '/403', name: 'Forbidden', component: EmptyView },
        { path: '/secret', name: 'Secret', component: EmptyView, meta: { permissions: ['system:role:list'] } },
        { path: '/:pathMatch(.*)*', name: 'NotFound', component: EmptyView },
      ],
    })
    setupRouterGuards(router)

    await router.push('/secret')
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('Forbidden')
    expect(router.currentRoute.value.query.from).toBe('/secret')
  })
})

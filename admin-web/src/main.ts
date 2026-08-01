import { createApp } from 'vue'
import { configureHttpSession } from './api'
import App from './App.vue'
import { permissionDirective } from './permissions'
import router from './router'
import pinia from './stores'
import { useAuthStore } from './stores/auth'
import { useRouteStore } from './stores/route'
import { useTabsStore } from './stores/tabs'
import { useUserStore } from './stores/user'
import { validateEnv } from './utils/env'

import 'virtual:uno.css'
import 'virtual:svg-icons-register'
import '@unocss/reset/tailwind-compat.css'
import '@/styles/index.css'

validateEnv()

const app = createApp(App)
app.use(pinia)

const authStore = useAuthStore(pinia)
const routeStore = useRouteStore(pinia)
const tabsStore = useTabsStore(pinia)
const userStore = useUserStore(pinia)

configureHttpSession({
  getAccessToken: () => authStore.accessToken,
  getRefreshToken: () => authStore.refreshToken,
  replaceSession: session => authStore.replaceSession(session),
  onSessionExpired: async () => {
    authStore.clearSession()
    userStore.reset()
    routeStore.reset(router)
    tabsStore.reset()
    if (router.currentRoute.value.name !== 'Login') {
      await router.replace({ name: 'Login' })
    }
  },
})

app.directive('permission', permissionDirective)
app.use(router)
app.mount('#app')

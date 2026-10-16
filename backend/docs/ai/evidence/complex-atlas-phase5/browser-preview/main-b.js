import { createApp, h, Suspense } from 'vue'
import { createPinia } from 'pinia'
import TDesign from 'tdesign-vue-next'
import '/@fs/D:/work/lg-vicp/admin-web/node_modules/tdesign-vue-next/es/style/index.css'
import '/@fs/D:/work/lg-vicp/admin-web/src/styles/tokens.css'
import { useUserStore } from '@/stores/user'
import App from './Atlas.vue'
const pinia = createPinia()
useUserStore(pinia).permissions = ['system:knowledge:doc:list', 'system:knowledge:doc:test', 'system:knowledge:page:review']
createApp({ render: () => h(Suspense, null, { default: () => h(App) }) }).use(pinia).use(TDesign).mount('#app')

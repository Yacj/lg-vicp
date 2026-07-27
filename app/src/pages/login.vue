<script setup lang="ts">
import type { ApiEnvelope, ClientInfo, LoginResult } from '@/api/types'
import { authApi } from '@/api/modules/auth'

definePage({
  name: 'login',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '登录',
  },
})

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const globalLoading = useGlobalLoading()
const { warning, success } = useGlobalToast()
const phone = ref('')
const password = ref('')
const submitting = ref(false)

async function submit() {
  if (!phone.value.trim() || !password.value.trim()) {
    warning('请填写手机号和密码')
    return
  }

  submitting.value = true
  globalLoading.loading('正在登录...')
  try {
    const loginResponse = await authApi.loginPassword({
      clientType: 'C_APP',
      phone: phone.value.trim(),
      password: password.value,
    }).send() as ApiEnvelope<LoginResult>
    authStore.setSession(loginResponse.data)

    const infoResponse = await authApi.getClientInfo().send() as ApiEnvelope<ClientInfo>
    authStore.setClientInfo(infoResponse.data)
    success('登录成功')
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    router.replace(redirect ? { path: redirect } : { name: 'home' })
  }
  catch {
    authStore.clearSession()
  }
  finally {
    submitting.value = false
    globalLoading.close()
  }
}
</script>

<template>
  <view class="app-page app-page--immersive app-page--login box-border">
    <wd-navbar
      custom-class="app-navbar app-navbar--brand"
      safe-area-inset-top
      left-arrow
      title="登录"
      @click-left="router.back"
    />
    <view class="app-enter box-border px-5 py-5 pb-8">
      <view class="app-gradient-hero mb-6 overflow-hidden p-5">
        <view class="app-eyebrow mb-2 text-white/70">
          VICP CLIENT WORKSPACE
        </view>
        <view class="text-7 text-white font-bold leading-9">
          登录蓝格智配
        </view>
        <view class="mt-2 text-3.5 text-white/75 leading-5">
          使用渠道账号进入项目工作空间
        </view>
      </view>

      <view class="app-panel-flat mb-5 overflow-hidden p-4">
        <view class="mb-4">
          <view class="mb-2 text-3.5 font-bold">
            手机号
          </view>
          <wd-input v-model="phone" type="number" placeholder="请输入手机号" clearable no-border />
        </view>
        <view>
          <view class="mb-2 text-3.5 font-bold">
            密码
          </view>
          <wd-input v-model="password" type="password" placeholder="请输入密码" clearable no-border />
        </view>
      </view>

      <view class="app-ai-soft mb-5 rounded-3 p-3 text-3 leading-5">
        登录后可访问项目、筑小格会话和个人归档。项目数据按当前账号权限隔离。
      </view>

      <wd-button type="primary" block :loading="submitting" :disabled="submitting" @click="submit">
        登录
      </wd-button>
    </view>
  </view>
</template>

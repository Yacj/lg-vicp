<script setup lang="ts">
import type { ApiEnvelope, ClientInfo, LoginResult } from '@/api/types'
import { authApi } from '@/api/modules/auth'
import { useBackNavigation } from '@/composables/useBackNavigation'

definePage({
  name: 'login',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
  },
})

const router = useRouter()
const { goBack } = useBackNavigation()
const route = useRoute()
const authStore = useAuthStore()
const globalLoading = useGlobalLoading()
const globalDialog = useGlobalDialog()
const { info, success } = useGlobalToast()
const formRef = ref()
const loginMode = ref<'wechat' | 'phone'>('wechat')
const agreementChecked = ref(false)
const submitting = ref(false)
const formModel = reactive({
  phone: '',
  password: '',
})

const formRules = {
  phone: [
    { required: true, message: '请输入手机号' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号' },
  ],
  password: [
    { required: true, message: '请输入密码' },
    { pattern: /^.{5,}$/, message: '密码至少需要 5 位' },
  ],
}

function isClientInfo(value: unknown): value is ClientInfo {
  if (!value || typeof value !== 'object') {
    return false
  }

  const clientInfo = value as Partial<ClientInfo>
  return Boolean(clientInfo.user && clientInfo.capabilities)
}

const canSubmit = computed(() => {
  return Boolean(formModel.phone.trim() && formModel.password.trim()) && !submitting.value
})

function switchLoginMode(mode: 'wechat' | 'phone') {
  loginMode.value = mode
}

function confirmAgreement(onConfirm: () => void) {
  globalDialog.confirm({
    title: '请先确认协议',
    msg: '您尚未勾选并确认《用户协议》和《隐私政策》。点击“同意并继续”后，将自动提交登录。',
    confirmButtonText: '同意并继续',
    cancelButtonText: '返回修改',
    success() {
      agreementChecked.value = true
      onConfirm()
    },
  })
}

function handleWechatLogin() {
  if (!agreementChecked.value) {
    confirmAgreement(() => info('微信快捷登录即将上线'))
    return
  }
  info('微信快捷登录即将上线')
}

function requestSubmit() {
  if (!agreementChecked.value) {
    confirmAgreement(() => void submitLogin())
    return
  }
  void submitLogin()
}

async function submitLogin() {
  const validation = await formRef.value?.validate()
  if (validation && !validation.valid) {
    return
  }

  submitting.value = true
  globalLoading.loading('正在登录...')
  try {
    const loginResponse = await authApi.loginPassword({
      clientType: 'C_APP',
      phone: formModel.phone.trim(),
      password: formModel.password,
    }).send() as ApiEnvelope<LoginResult>

    if (!loginResponse.data?.accessToken) {
      throw new Error('登录响应缺少访问令牌')
    }

    // 登录接口已经返回完整会话，先保存令牌，保证后续请求能携带 Authorization。
    authStore.setSession(loginResponse.data)

    try {
      const infoResponse = await authApi.getClientInfo().send() as ApiEnvelope<unknown>
      if (isClientInfo(infoResponse.data)) {
        authStore.setClientInfo(infoResponse.data)
      }
    }
    catch (error) {
      // 客户端扩展信息不是登录成功的必要条件；401/403 等会话失效错误继续抛出。
      if (!authStore.isAuthenticated) {
        throw error
      }
    }

    success('登录成功')
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
    await router.replaceAll(redirect ? { path: redirect } : { name: 'home' })
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
  <view class="app-page app-page--immersive app-page--login login-page box-border min-h-screen flex flex-col">
    <wd-navbar
      custom-class="!bg-transparent"
      safe-area-inset-top
      left-arrow
      title=""
      @click-left="goBack"
    />

    <view class="login-page__main min-h-0 flex flex-1 flex-col items-center justify-center px-5">
      <view class="login-content w-full">
        <view class="login-brand flex flex-col items-center text-center">
          <view class="login-logo-placeholder mb-5 flex items-center justify-center" aria-label="Logo 图片占位">
            <wd-icon name="picture" size="72rpx" color="var(--app-action-primary)" />
          </view>
          <view class="text-7 font-bold leading-9">
            蓝格智配
          </view>
          <view class="app-tertiary mt-2 max-w-600rpx text-3.5 leading-6">
            连接建筑节能项目，让设计协作更简单
          </view>
        </view>

        <view class="login-panel mt-8">
          <view v-if="loginMode === 'wechat'" class="login-wechat flex flex-col items-center">
            <wd-button type="primary" block custom-class="login-primary-button" @click="handleWechatLogin">
              <view class="flex items-center justify-center gap-2">
                微信快捷登录
              </view>
            </wd-button>
          </view>

          <wd-form v-else ref="formRef" :model="formModel" :rules="formRules" class="login-form">
            <wd-input
              v-model="formModel.phone"
              prop="phone"
              label="手机号"
              type="number"
              placeholder="请输入手机号"
              clearable
              no-border
              custom-class="login-input"
            />
            <wd-input
              v-model="formModel.password"
              prop="password"
              label="密码"
              show-password
              placeholder="请输入密码"
              clearable
              no-border
              custom-class="login-input"
            />
            <wd-button
              type="primary"
              block
              custom-class="login-primary-button mt-5"
              :loading="submitting"
              :disabled="!canSubmit"
              @click="requestSubmit"
            >
              登录
            </wd-button>
          </wd-form>
        </view>

        <view
          class="login-mode-link mt-6 text-center text-3.5"
          @click="switchLoginMode(loginMode === 'wechat' ? 'phone' : 'wechat')"
        >
          {{ loginMode === 'wechat' ? '手机号登录' : '微信快捷登录' }}
        </view>
      </view>
    </view>

    <view class="login-agreement box-border px-5 pb-4 text-center text-3">
      <view class="login-agreement__content">
        <wd-checkbox v-model="agreementChecked" shape="circle">
          我已阅读并同意
          <text class="login-agreement__link">
            《用户协议》
          </text>
          和
          <text class="login-agreement__link">
            《隐私政策》
          </text>
        </wd-checkbox>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.login-page {
  overflow: hidden;
}

.login-page__main {
  width: 100%;
}

.login-content {
  max-width: 640rpx;
}

.login-logo-placeholder {
  width: 144rpx;
  height: 144rpx;
  border: 1px solid var(--app-action-primary-soft);
  border-radius: var(--app-radius-lg);
  background: var(--app-bg-surface);
  box-shadow: var(--app-shadow-card);
}

.login-panel {
  width: 100%;
}

:deep(.login-input) {
  margin-bottom: 24rpx;
  overflow: hidden;
  border-radius: var(--app-radius-sm);
  background: var(--app-login-input-bg);
  padding: 24rpx;
}

:deep(.login-input .wd-input__inner) {
  background: transparent;
}

:deep(.login-primary-button) {
  min-height: 88rpx;
}

.login-mode-link,
.login-agreement__link {
  color: var(--app-action-primary);
}

.login-mode-link {
  font-weight: 600;
}

.login-agreement {
  flex-shrink: 0;
  padding-bottom: calc(32rpx + env(safe-area-inset-bottom));
  color: var(--app-text-tertiary);
}

.login-agreement__content {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  text-align: left;
}

:deep(.login-agreement__content .wd-checkbox) {
  display: inline-flex;
  width: auto;
  margin: 0 auto;
}

:deep(.login-agreement .wd-checkbox__label) {
  color: var(--app-text-tertiary);
  font-size: 24rpx;
}
</style>

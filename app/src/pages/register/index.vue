<script setup lang="ts">
import type { ApiEnvelope, RegisterResult } from '@/api/types'
import { authApi } from '@/api/modules/auth'
import { useBackNavigation } from '@/composables/useBackNavigation'
import { useClientAuthSession } from '@/composables/useClientAuthSession'
import { buildAuthPageLocation, getLoginRedirect, rememberLoginRedirect } from '@/utils/authRedirect'
import { buildRegisterPasswordBody } from '@/utils/clientRegister'

definePage({
  name: 'register',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
  },
})

const router = useRouter()
const route = useRoute()
const { goBack } = useBackNavigation()
const { applyAuthResult, redirectAfterAuth } = useClientAuthSession()
const globalLoading = useGlobalLoading()
const globalDialog = useGlobalDialog()
const { success } = useGlobalToast()
const formRef = ref()
const agreementChecked = ref(false)
const submitting = ref(false)
const formModel = reactive({
  phone: '',
  password: '',
  confirmPassword: '',
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
  confirmPassword: [
    { required: true, message: '请再次输入密码' },
    {
      validator: (value: string) => value === formModel.password,
      message: '两次输入的密码不一致',
    },
  ],
}

const canSubmit = computed(() => {
  return Boolean(
    formModel.phone.trim()
    && formModel.password
    && formModel.confirmPassword,
  ) && !submitting.value
})

function confirmAgreement(onConfirm: () => void) {
  globalDialog.confirm({
    title: '请先确认协议',
    msg: '您尚未勾选并确认《用户协议》和《隐私政策》。点击“同意并继续”后，将自动提交注册。',
    confirmButtonText: '同意并继续',
    cancelButtonText: '返回修改',
    success() {
      agreementChecked.value = true
      onConfirm()
    },
  })
}

function goLogin() {
  const redirect = getLoginRedirect(route)
  rememberLoginRedirect(redirect)
  router.replace(buildAuthPageLocation('login', redirect))
}

function requestSubmit() {
  if (!agreementChecked.value) {
    confirmAgreement(() => void submitRegister())
    return
  }
  void submitRegister()
}

async function submitRegister() {
  const validation = await formRef.value?.validate()
  if (validation && !validation.valid) {
    return
  }

  const payload = buildRegisterPasswordBody({
    phone: formModel.phone,
    password: formModel.password,
    confirmPassword: formModel.confirmPassword,
    agreementChecked: agreementChecked.value,
  })
  if (!payload.ok) {
    return
  }

  submitting.value = true
  globalLoading.loading('正在注册...')
  try {
    const registerResponse = await authApi.registerPassword(payload.data).send() as ApiEnvelope<RegisterResult>
    if (!registerResponse.data?.accessToken) {
      throw new Error('注册响应缺少访问令牌')
    }
    await applyAuthResult(registerResponse.data)
    success(registerResponse.data?.message || '注册成功')
    await redirectAfterAuth()
  }
  catch {
    useAuthStore().clearSession()
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
            注册筑小格
          </view>
          <view class="app-tertiary mt-2 max-w-600rpx text-3.5 leading-6">
            使用手机号创建普通用户账号
          </view>
        </view>

        <view class="login-panel mt-8">
          <wd-form ref="formRef" :model="formModel" :rules="formRules" class="login-form">
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
              placeholder="请设置密码"
              clearable
              no-border
              custom-class="login-input"
            />
            <wd-input
              v-model="formModel.confirmPassword"
              prop="confirmPassword"
              label="确认密码"
              show-password
              placeholder="请再次输入密码"
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
              注册
            </wd-button>
          </wd-form>
        </view>

        <view class="login-mode-link mt-6 text-center text-3.5" @click="goLogin">
          已有账号？去登录
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
  border-radius: 999rpx;
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

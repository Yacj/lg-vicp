<script setup lang="ts">
import type { ApiEnvelope, LoginResult, WechatPhoneLoginResult } from '@/api/types'
import { getAuthErrorCode } from '@/api/core/handlers'
import { authApi } from '@/api/modules/auth'
import { useBackNavigation } from '@/composables/useBackNavigation'
import { useClientAuthSession } from '@/composables/useClientAuthSession'
import { isWechatMiniProgram } from '@/services/platform'
import { applyAuthRedirect } from '@/utils/authRedirect'
import {
  AGREEMENT_REQUIRED_MESSAGE,
  PASSWORD_NOT_SET_MESSAGE,
  planWechatPhoneLogin,
  postLoginRoute,
} from '@/utils/wechatPhoneLogin'

definePage({
  name: 'login',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
  },
})

const router = useRouter()
const route = useRoute()
const { goBack } = useBackNavigation()
const authStore = useAuthStore()
const { applyAuthResult, redirectAfterAuth } = useClientAuthSession()
const globalLoading = useGlobalLoading()
const globalDialog = useGlobalDialog()
const { info, success } = useGlobalToast()
const formRef = ref()
const loginMode = ref<'wechat' | 'phone'>(initialLoginMode())
const agreementChecked = ref(false)
const submitting = ref(false)
const formModel = reactive({
  phone: readRoutePhone(),
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

const canSubmit = computed(() => {
  return Boolean(formModel.phone.trim() && formModel.password.trim()) && !submitting.value
})

const wechatOpenType = computed(() => agreementChecked.value ? 'getPhoneNumber' : '')

function initialLoginMode(): 'wechat' | 'phone' {
  if (readRoutePhone()) {
    return 'phone'
  }
  // #ifdef MP-WEIXIN
  return 'wechat'
  // #endif
  // #ifndef MP-WEIXIN
  return 'phone'
  // #endif
}

function readRoutePhone() {
  const value = route.query?.phone
  return typeof value === 'string' ? value : ''
}

function switchLoginMode(mode: 'wechat' | 'phone') {
  if (submitting.value) {
    return
  }
  loginMode.value = mode
}

function currentPlatform() {
  // #ifdef MP-WEIXIN
  return 'mp-weixin'
  // #endif
  // #ifndef MP-WEIXIN
  return isWechatMiniProgram() ? 'mp-weixin' : 'h5'
  // #endif
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

function promptAgreementForWechat() {
  globalDialog.confirm({
    title: '请先确认协议',
    msg: '您尚未勾选并确认《用户协议》和《隐私政策》。同意后，请再次点击微信快速登录。',
    confirmButtonText: '同意',
    cancelButtonText: '返回',
    success() {
      agreementChecked.value = true
    },
  })
}

function onWechatButtonClick() {
  if (submitting.value || agreementChecked.value) {
    return
  }
  promptAgreementForWechat()
}

function loginWithWeixin() {
  return new Promise<{ code?: string }>((resolve, reject) => {
    // #ifdef MP-WEIXIN
    uni.login({
      provider: 'weixin',
      success: result => resolve(result),
      fail: error => reject(error),
    })
    // #endif
    // #ifndef MP-WEIXIN
    reject(new Error('unsupported'))
    // #endif
  })
}

async function handleWechatPhoneLogin(event: { detail?: { code?: string, errMsg?: string } }) {
  const prepared = planWechatPhoneLogin({
    platform: currentPlatform(),
    submitting: submitting.value,
    agreementChecked: agreementChecked.value,
    phoneDetail: event?.detail,
  })
  if (prepared.action === 'stop') {
    if (prepared.message === AGREEMENT_REQUIRED_MESSAGE) {
      promptAgreementForWechat()
      return
    }
    if (prepared.message) {
      info(prepared.message)
    }
    return
  }
  if (prepared.action !== 'need-login-code') {
    return
  }

  submitting.value = true
  globalLoading.loading('正在登录...')
  try {
    let loginCode = ''
    try {
      const loginResult = await loginWithWeixin()
      loginCode = loginResult.code || ''
    }
    catch {
      loginCode = ''
    }

    const planned = planWechatPhoneLogin({
      platform: currentPlatform(),
      submitting: false,
      agreementChecked: agreementChecked.value,
      phoneDetail: event?.detail,
      loginCode,
    })
    if (planned.action !== 'submit') {
      if (planned.action === 'stop' && planned.message) {
        info(planned.message)
      }
      return
    }

    const loginResponse = await authApi.wechatPhoneLogin(planned.request).send() as ApiEnvelope<WechatPhoneLoginResult>
    const next = postLoginRoute({ isFirstLogin: loginResponse.data.isFirstLogin })
    await applyAuthResult({
      ...loginResponse.data,
      isFirstLogin: next.isFirstLogin,
    })
    success('登录成功')
    if (next.isFirstLogin) {
      await applyAuthRedirect(router, '')
      return
    }
    await redirectAfterAuth()
  }
  catch {
    authStore.clearSession()
  }
  finally {
    submitting.value = false
    globalLoading.close()
  }
}

function requestSubmit() {
  if (submitting.value) {
    return
  }
  if (!agreementChecked.value) {
    confirmAgreement(() => void submitLogin())
    return
  }
  void submitLogin()
}

function goForgotPassword() {
  router.push({
    path: '/pages/password/index',
    query: {
      mode: 'reset',
      phone: formModel.phone.trim(),
    },
  })
}

function promptSetPassword() {
  globalDialog.confirm({
    title: '登录密码未设置',
    msg: PASSWORD_NOT_SET_MESSAGE,
    confirmButtonText: '设置密码',
    cancelButtonText: '取消',
    success() {
      router.push({
        path: '/pages/password/index',
        query: {
          mode: 'set',
          phone: formModel.phone.trim(),
        },
      })
    },
  })
}

async function submitLogin() {
  if (submitting.value) {
    return
  }
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

    await applyAuthResult(loginResponse.data)
    authStore.markPasswordSet(true)
    success('登录成功')
    await redirectAfterAuth()
  }
  catch (error) {
    authStore.clearSession()
    if (getAuthErrorCode(error) === 'PASSWORD_NOT_SET') {
      promptSetPassword()
    }
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
            筑小格
          </view>
          <view class="app-tertiary mt-2 max-w-600rpx text-3.5 leading-6">
            连接建筑节能项目，让设计协作更简单
          </view>
        </view>

        <view class="login-panel mt-8">
          <view v-if="loginMode === 'wechat'" class="login-wechat">
            <!-- #ifdef MP-WEIXIN -->
            <button
              class="wechat-login-button"
              :open-type="wechatOpenType"
              :loading="submitting"
              :disabled="submitting"
              hover-class="wechat-login-button--hover"
              @click="onWechatButtonClick"
              @getphonenumber="handleWechatPhoneLogin"
            >
              微信快速登录
            </button>
            <!-- #endif -->
            <view class="login-mode-link mt-6 text-center text-3.5" @click="switchLoginMode('phone')">
              账号密码登录
            </view>
          </view>

          <view v-else>
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
            <view class="login-mode-link mt-4 text-center text-3.5" @click="goForgotPassword">
              忘记密码
            </view>
            <!-- #ifdef MP-WEIXIN -->
            <view class="login-mode-link mt-4 text-center text-3.5" @click="switchLoginMode('wechat')">
              微信快速登录
            </view>
            <!-- #endif -->
          </view>
        </view>
      </view>
    </view>

    <view class="login-agreement box-border px-5 pb-4 text-center text-3">
      <!-- #ifdef MP-WEIXIN -->
      <!-- #endif -->
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

.wechat-login-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 88rpx;
  margin: 0;
  padding: 0 32rpx;
  border: 0;
  border-radius: 999rpx;
  color: var(--app-text-inverse);
  background: var(--app-action-primary);
  font-size: 32rpx;
  font-weight: 600;
  line-height: 88rpx;
}

.wechat-login-button::after {
  border: none;
}

.wechat-login-button[disabled] {
  opacity: 0.65;
}

.wechat-login-button--hover {
  opacity: 0.88;
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

.login-wechat-hint {
  margin-bottom: 12rpx;
  color: var(--app-text-tertiary);
  font-size: 24rpx;
  line-height: 34rpx;
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

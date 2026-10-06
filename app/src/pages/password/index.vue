<script setup lang="ts">
import type { ApiEnvelope, PasswordMutationResult } from '@/api/types'
import { getAuthErrorCode } from '@/api/core/handlers'
import { authApi } from '@/api/modules/auth'
import { useBackNavigation } from '@/composables/useBackNavigation'
import { buildClientPasswordSmsBody, buildSendPasswordSmsBody } from '@/utils/clientPassword'
import { PASSWORD_NOT_SET_MESSAGE } from '@/utils/wechatPhoneLogin'

definePage({
  name: 'password',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '登录密码',
  },
})

const router = useRouter()
const route = useRoute()
const { goBack } = useBackNavigation()
const authStore = useAuthStore()
const globalLoading = useGlobalLoading()
const { info, success } = useGlobalToast()
const formRef = ref()
const submitting = ref(false)
const sendingSms = ref(false)
const smsCooldown = ref(0)
const mode = ref<'set' | 'reset'>(readQuery('mode') === 'set' ? 'set' : 'reset')
const formModel = reactive({
  phone: readQuery('phone') || authStore.user?.phone || '',
  code: '',
  password: '',
  confirmPassword: '',
})

const pageTitle = computed(() => mode.value === 'set' ? '设置登录密码' : '重置登录密码')
const submitText = computed(() => mode.value === 'set' ? '设置密码' : '确认重置')
const smsButtonText = computed(() => smsCooldown.value > 0 ? `${smsCooldown.value}s` : '获取验证码')

const formRules = {
  phone: [
    { required: true, message: '请输入手机号' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号' },
  ],
  code: [
    { required: true, message: '请输入短信验证码' },
    { pattern: /^\d{6}$/, message: '请输入 6 位短信验证码' },
  ],
  password: [
    { required: true, message: '请输入新密码' },
    { pattern: /^.{5,}$/, message: '密码至少需要 5 位' },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码' },
    {
      validator: (value: string) => value === formModel.password,
      message: '两次输入的密码不一致',
    },
  ],
}

const canSubmit = computed(() => {
  return Boolean(
    formModel.phone.trim()
    && formModel.code.trim()
    && formModel.password
    && formModel.confirmPassword,
  ) && !submitting.value
})

let cooldownTimer: ReturnType<typeof setInterval> | undefined

onUnmounted(() => {
  if (cooldownTimer) {
    clearInterval(cooldownTimer)
  }
})

function readQuery(key: string) {
  const value = route.query?.[key]
  return typeof value === 'string' ? value : ''
}

function startCooldown() {
  smsCooldown.value = 60
  if (cooldownTimer) {
    clearInterval(cooldownTimer)
  }
  cooldownTimer = setInterval(() => {
    smsCooldown.value -= 1
    if (smsCooldown.value <= 0 && cooldownTimer) {
      clearInterval(cooldownTimer)
      cooldownTimer = undefined
    }
  }, 1000)
}

async function sendSmsCode() {
  if (sendingSms.value || smsCooldown.value > 0) {
    return
  }
  const payload = buildSendPasswordSmsBody(formModel.phone)
  if (!payload.ok) {
    info(payload.error)
    return
  }

  sendingSms.value = true
  try {
    await authApi.sendSms(payload.data).send()
    success('短信验证码已发送')
    startCooldown()
  }
  finally {
    sendingSms.value = false
  }
}

async function submitPassword() {
  if (submitting.value) {
    return
  }
  const validation = await formRef.value?.validate()
  if (validation && !validation.valid) {
    return
  }

  const payload = buildClientPasswordSmsBody(formModel)
  if (!payload.ok) {
    info(payload.error)
    return
  }

  submitting.value = true
  globalLoading.loading(mode.value === 'set' ? '正在设置密码...' : '正在重置密码...')
  try {
    const request = mode.value === 'set'
      ? authApi.setPassword(payload.data)
      : authApi.resetPassword(payload.data)
    const response = await request.send() as ApiEnvelope<PasswordMutationResult>
    if (authStore.isAuthenticated) {
      authStore.markPasswordSet(true)
      success(response.data?.message || (mode.value === 'set' ? '密码设置成功' : '密码已更新'))
      router.back()
      return
    }
    success(response.data?.message || '密码已更新，请使用手机号密码登录')
    router.replace({
      path: '/pages/login',
      query: { phone: payload.data.phone },
    })
  }
  catch (error) {
    if (getAuthErrorCode(error) === 'PASSWORD_NOT_SET') {
      mode.value = 'set'
      info(PASSWORD_NOT_SET_MESSAGE)
    }
  }
  finally {
    submitting.value = false
    globalLoading.close()
  }
}
</script>

<template>
  <view class="app-page app-page--immersive password-page box-border min-h-screen flex flex-col">
    <wd-navbar
      custom-class="!bg-transparent"
      safe-area-inset-top
      left-arrow
      :title="pageTitle"
      @click-left="goBack"
    />

    <view class="password-page__main min-h-0 flex flex-1 flex-col px-5 pt-6">
      <view class="password-content w-full">
        <view class="app-tertiary text-3.5 leading-6">
          {{ mode === 'set' ? '验证手机号后即可设置登录密码。' : '验证手机号后即可设置新的登录密码。' }}
        </view>

        <wd-form ref="formRef" :model="formModel" :rules="formRules" class="mt-6">
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
          <view class="password-code">
            <wd-input
              v-model="formModel.code"
              prop="code"
              label="验证码"
              type="number"
              placeholder="请输入短信验证码"
              clearable
              no-border
              custom-class="login-input password-code__input"
            />
            <wd-button
              size="small"
              plain
              custom-class="password-code__button"
              :loading="sendingSms"
              :disabled="sendingSms || smsCooldown > 0"
              @click="sendSmsCode"
            >
              {{ smsButtonText }}
            </wd-button>
          </view>
          <wd-input
            v-model="formModel.password"
            prop="password"
            label="新密码"
            show-password
            placeholder="请输入新密码"
            clearable
            no-border
            custom-class="login-input"
          />
          <wd-input
            v-model="formModel.confirmPassword"
            prop="confirmPassword"
            label="确认密码"
            show-password
            placeholder="请再次输入新密码"
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
            @click="submitPassword"
          >
            {{ submitText }}
          </wd-button>
        </wd-form>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.password-page__main {
  width: 100%;
}

.password-content {
  max-width: 640rpx;
  margin: 0 auto;
}

.password-code {
  position: relative;
}

.password-code__button {
  position: absolute;
  top: 28rpx;
  right: 24rpx;
  z-index: 1;
}

:deep(.login-input) {
  margin-bottom: 24rpx;
  overflow: hidden;
  border-radius: 999rpx;
  background: var(--app-login-input-bg);
  padding: 24rpx;
}

:deep(.password-code__input) {
  padding-right: 180rpx;
}

:deep(.login-input .wd-input__inner) {
  background: transparent;
}

:deep(.login-primary-button) {
  min-height: 88rpx;
}
</style>

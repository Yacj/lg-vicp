<script setup lang="ts">
import { useAuthGate } from '@/composables/useAuthGate'
import { useAuthLogout } from '@/composables/useAuthLogout'
import { useBackNavigation } from '@/composables/useBackNavigation'

definePage({
  name: 'profile-info',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '个人信息',
  },
})

const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const { requestLogout } = useAuthLogout()
const authStore = useAuthStore()
const user = computed(() => authStore.user)
const isAuthenticated = computed(() => authStore.isAuthenticated)
const profileName = computed(() => user.value?.displayName || '暂无登录')
const avatarText = computed(() => profileName.value.slice(0, 1))
const phoneText = computed(() => maskPhone(user.value?.phone) || '未绑定手机号')
const emailText = computed(() => user.value?.email || '未设置邮箱')
const roleText = computed(() => {
  const roleLabels: Record<string, string> = {
    SUPER_ADMIN: '超级管理员',
    CHANNEL_USER: '渠道用户',
    NORMAL_USER: '普通用户',
  }
  return roleLabels[user.value?.role || ''] || '普通用户'
})

onMounted(() => {
  if (!isAuthenticated.value) {
    requireLogin({ showToast: false })
  }
})

function maskPhone(phone?: string | null) {
  if (!phone) {
    return ''
  }
  if (phone.length < 7) {
    return phone
  }
  return `${phone.slice(0, 3)} **** ${phone.slice(-4)}`
}
</script>

<template>
  <view class="app-page app-page--immersive min-h-screen">
    <wd-navbar
      custom-class="app-navbar"
      safe-area-inset-top
      left-arrow
      title="个人信息"
      @click-left="goBack"
    />

    <view v-if="isAuthenticated" class="app-enter box-border px-4 py-4 pb-6">
      <view class="app-panel mb-5 flex flex-col items-center px-4 py-6">
        <wd-avatar
          :text="avatarText"
          size="160rpx"
          shape="round"
          bg-color="var(--app-action-primary)"
          color="var(--app-text-inverse)"
        />
        <view class="mt-3 text-5 font-bold">
          {{ profileName }}
        </view>
        <view class="app-muted mt-1 text-3">
          蓝格智配工作空间
        </view>
      </view>

      <view class="app-section-title mb-3">
        账号信息
      </view>
      <wd-cell-group insert custom-class="mb-6! overflow-hidden">
        <wd-cell title="姓名" :value="profileName" />
        <wd-cell title="手机号" :value="phoneText" />
        <wd-cell title="邮箱" :value="emailText" />
        <wd-cell title="身份" :value="roleText" />
      </wd-cell-group>

      <wd-button plain block type="danger" @click="requestLogout">
        退出登录
      </wd-button>
    </view>
  </view>
</template>

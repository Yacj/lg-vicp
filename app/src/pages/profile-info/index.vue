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

interface ProfileInfoItem {
  key: 'name' | 'phone' | 'email' | 'role'
  label: string
  value: string
  icon: string
  placeholder: boolean
}

const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const { requestLogout } = useAuthLogout()
const authStore = useAuthStore()
const user = computed(() => authStore.user)
const isAuthenticated = computed(() => authStore.isAuthenticated)
const profileName = computed(() => user.value?.displayName || '暂无登录')
const avatarText = computed(() => profileName.value.slice(0, 1))
const phoneText = computed(() => maskPhone(user.value?.phone))
const emailText = computed(() => user.value?.email || '')
const roleText = computed(() => {
  const roleLabels: Record<string, string> = {
    SUPER_ADMIN: '超级管理员',
    CHANNEL_USER: '渠道用户',
    NORMAL_USER: '普通用户',
  }
  const channelLabels: Record<string, string> = {
    DEALER: '经销商',
    SALESPERSON: '业务员',
  }
  const role = roleLabels[user.value?.role || ''] || '普通用户'
  const channel = user.value?.channelType ? channelLabels[user.value.channelType] : ''
  return channel ? `${role} · ${channel}` : role
})
const infoItems = computed<ProfileInfoItem[]>(() => [
  {
    key: 'name',
    label: '姓名',
    value: profileName.value,
    icon: 'i-my-icons-profile',
    placeholder: false,
  },
  {
    key: 'phone',
    label: '手机号',
    value: phoneText.value || '未绑定手机号',
    icon: 'i-my-icons-phone',
    placeholder: !phoneText.value,
  },
  {
    key: 'email',
    label: '邮箱',
    value: emailText.value || '未设置邮箱',
    icon: 'i-my-icons-email',
    placeholder: !emailText.value,
  },
  {
    key: 'role',
    label: '身份',
    value: roleText.value,
    icon: 'i-my-icons-identity',
    placeholder: false,
  },
])

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
  <view class="app-page profile-info-page min-h-screen">
    <wd-navbar
      custom-class="profile-info-navbar"
      safe-area-inset-top
      left-arrow
      title="个人信息"
      @click-left="goBack"
    />

    <view v-if="isAuthenticated" class="mx-auto box-border max-w-750px w-full pb-10">
      <view class="flex flex-col items-center px-4 pb-6 pt-8">
        <view class="profile-info-avatar">
          <view class="profile-info-avatar__ring">
            <wd-avatar
              :text="avatarText"
              size="144rpx"
              shape="round"
              bg-color="var(--app-action-primary)"
              color="var(--app-text-inverse)"
            />
          </view>
        </view>
        <view class="mt-4 max-w-full truncate px-4 text-40rpx font-bold leading-56rpx">
          {{ profileName }}
        </view>
        <view class="profile-info-role mt-2">
          {{ roleText }}
        </view>
        <view class="app-tertiary mt-2 text-24rpx leading-34rpx">
          蓝格智配工作空间
        </view>
      </view>

      <view class="px-4 pb-2 text-26rpx font-bold leading-40rpx">
        账号信息
      </view>
      <view class="">
        <wd-cell-group insert custom-class="profile-info-cells">
          <wd-cell
            v-for="(item, index) in infoItems"
            :key="item.key"
            :title="item.label"
            :border="index > 0"
            center
          >
            <template #prefix>
              <view class="profile-info-icon relative top-0.5" :class="item.icon" />
            </template>
            <view
              class="min-w-0 truncate text-right text-28rpx leading-40rpx"
              :class="item.placeholder ? 'app-tertiary' : ''"
            >
              {{ item.value }}
            </view>
          </wd-cell>
        </wd-cell-group>
      </view>
      <view class="mt-6">
        <view
          class="profile-info-logout app-pressable"
          role="button"
          aria-label="退出登录"
          @click="requestLogout"
        >
          退出登录
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.profile-info-page {
  min-height: 100vh;
  background: var(--app-profile-page-gradient);
}

:deep(.profile-info-navbar),
:deep(.profile-info-navbar.wd-navbar) {
  background: transparent !important;
}

:deep(.profile-info-navbar .wd-navbar__title),
:deep(.profile-info-navbar .wd-navbar__arrow) {
  color: var(--app-text-primary);
}

.profile-info-avatar {
  padding: 8rpx;
  border-radius: var(--app-radius-pill);
  background: var(--app-gradient-brand);
  box-shadow: var(--app-shadow-float);
}

.profile-info-avatar__ring {
  padding: 6rpx;
  border-radius: var(--app-radius-pill);
  background: var(--app-bg-surface);
}

.profile-info-role {
  padding: 10rpx 22rpx;
  border-radius: var(--app-radius-pill);
  color: var(--app-action-primary);
  background: var(--app-action-primary-soft);
  font-size: 24rpx;
  font-weight: 600;
  line-height: 34rpx;
}

.profile-info-section {
  border-top: 1px solid var(--app-border-default);
  border-bottom: 1px solid var(--app-border-default);
  background: var(--app-bg-surface);
}

.profile-info-icon {
  width: 40rpx;
  height: 40rpx;
  margin-right: 16rpx;
  color: var(--app-text-secondary);
}

.profile-info-logout {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 104rpx;
  color: var(--app-project-danger);
  font-size: 30rpx;
  font-weight: 600;
  line-height: 42rpx;
}

:deep(.profile-info-cells),
:deep(.profile-info-cells .wd-cell) {
  background: transparent;
}

:deep(.profile-info-cells .wd-cell.is-hover) {
  background: var(--app-bg-soft);
}
</style>

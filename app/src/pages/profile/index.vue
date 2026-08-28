<script setup lang="ts">
import type { ApiEnvelope, ClientInfo, ProfileSummary } from '@/api/types'
import { authApi } from '@/api/modules/auth'
import { profileApi } from '@/api/modules/profile'
import { useAuthGate } from '@/composables/useAuthGate'
import { getPlatformInfo } from '@/services/platform'

definePage({
  name: 'profile',
  layout: 'tabbar',
  style: {
    navigationStyle: 'custom',
  },
})

type ProfileEntry = 'projects' | 'conversations' | 'profile-info' | 'appearance' | 'agreement' | 'privacy' | 'ai-guide' | 'about'
type LegalEntry = Extract<ProfileEntry, 'agreement' | 'privacy' | 'ai-guide'>
type SummaryStatus = 'idle' | 'loading' | 'success' | 'error'

interface ProfileMenuItem {
  key: ProfileEntry
  label: string
  description?: string
  icon: string
  route?: string
  requiresAuth?: boolean
}

const router = useRouter()
const { requireLogin } = useAuthGate()
const { theme, followSystem } = useManualTheme()
const globalDialog = useGlobalDialog()
const authStore = useAuthStore()

const summary = shallowRef<ProfileSummary>()
const summaryStatus = ref<SummaryStatus>('idle')
const isAuthenticated = computed(() => authStore.isAuthenticated)
const user = computed(() => authStore.user)
const profileName = computed(() => isAuthenticated.value ? user.value?.displayName || '已登录用户' : '欢迎使用蓝格智配')
const avatarText = computed(() => profileName.value.slice(0, 1))
const profileDescription = computed(() => {
  if (!isAuthenticated.value) {
    return '登录后管理项目和 AI 对话记录'
  }
  return maskPhone(user.value?.phone) || (user.value?.email ? '邮箱已绑定' : '已登录工作空间')
})
const appearanceLabel = computed(() => {
  if (followSystem.value) {
    return '跟随系统'
  }
  return theme.value === 'dark' ? '深色' : '浅色'
})
const statistics = computed(() => [
  { key: 'projects', label: '项目总数', value: summary.value?.projects.total },
  { key: 'public-projects', label: '公开项目', value: summary.value?.projects.public },
  { key: 'conversations', label: 'AI 对话', value: summary.value?.conversations.total },
])

const workspaceItems: ProfileMenuItem[] = [
  {
    key: 'projects',
    label: '我的项目',
    description: '查看和管理你创建的项目',
    icon: 'i-my-icons-project',
    route: 'projects',
    requiresAuth: true,
  },
  {
    key: 'conversations',
    label: 'AI 对话记录',
    description: '继续历史对话与项目分析',
    icon: 'i-my-icons-conversation',
    route: 'conversation-history',
    requiresAuth: true,
  },
]

const accountItems: ProfileMenuItem[] = [
  {
    key: 'profile-info',
    label: '个人信息',
    description: '姓名、手机号、邮箱和身份',
    icon: 'i-my-icons-profile',
    route: 'profile-info',
    requiresAuth: true,
  },
  {
    key: 'appearance',
    label: '外观设置',
    icon: 'i-my-icons-appearance',
    route: 'appearance-settings',
  },
]

const serviceItems: ProfileMenuItem[] = [
  { key: 'agreement', label: '用户协议', icon: 'i-my-icons-agreement' },
  { key: 'privacy', label: '隐私政策', icon: 'i-my-icons-privacy' },
  // { key: 'ai-guide', label: 'AI 使用说明', icon: 'i-my-icons-ai-guide' },
  { key: 'about', label: '关于蓝格智配', icon: 'i-my-icons-about', route: 'about' },
]

const legalContent: Record<LegalEntry, { title: string, message: string }> = {
  'agreement': {
    title: '用户协议',
    message: '当前版本暂未提供独立的协议详情页，请以登录流程中确认的协议内容为准。',
  },
  'privacy': {
    title: '隐私政策',
    message: '当前版本暂未提供独立的隐私政策详情页；微信端可通过系统隐私保护指引查看授权说明。',
  },
  'ai-guide': {
    title: 'AI 使用说明',
    message: 'AI 生成内容仅供项目分析参考，请结合实际项目资料和现行规范进行复核。',
  },
}

const platformInfo = getPlatformInfo()
let profileTopInset = platformInfo.statusBarHeight
  ? `${platformInfo.statusBarHeight}px`
  : 'env(safe-area-inset-top)'

// #ifdef MP-WEIXIN
const menuButtonRect = uni.getMenuButtonBoundingClientRect()
profileTopInset = `${menuButtonRect.bottom + 4}px`
// #endif

const pageStyle = {
  '--profile-top-inset': profileTopInset,
}

onShow(() => {
  if (!isAuthenticated.value) {
    resetSummary()
    return
  }

  void refreshClientInfo()
  void loadSummary()
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

function statisticValue(value?: number) {
  return summaryStatus.value === 'success' ? String(value ?? 0) : '—'
}

async function refreshClientInfo() {
  try {
    const response = await authApi.getClientInfo().send() as ApiEnvelope<ClientInfo>
    if (response.data?.user && response.data?.capabilities) {
      authStore.setClientInfo(response.data)
    }
  }
  catch {
    // 请求层统一处理会话失效；页面继续使用持久化的账户资料作为兜底。
  }
}

async function loadSummary() {
  summaryStatus.value = 'loading'
  try {
    const response = await profileApi.getSummary().send() as ApiEnvelope<ProfileSummary>
    summary.value = response.data
    summaryStatus.value = 'success'
  }
  catch {
    summaryStatus.value = 'error'
  }
}

function resetSummary() {
  summary.value = undefined
  summaryStatus.value = 'idle'
}

function openProfileInfo() {
  if (!requireLogin({ showToast: false })) {
    return
  }
  router.push({ name: 'profile-info' })
}

function openEntry(item: ProfileMenuItem) {
  if (item.requiresAuth && !requireLogin({ showToast: false })) {
    return
  }

  if (item.route) {
    if (item.route === 'projects') {
      router.pushTab({ name: item.route })
      return
    }
    router.push({ name: item.route })
    return
  }

  openLegalContent(item.key as LegalEntry)
}

function openLegalContent(key: LegalEntry) {
  const item = legalContent[key]
  if (!item) {
    return
  }

  globalDialog.alert({
    title: item.title,
    msg: item.message,
    confirmButtonText: '知道了',
  })
}
</script>

<template>
  <view class="app-page profile-page min-h-screen" :style="pageStyle">
    <view class="profile-hero">
      <view class="profile-hero__safe" />
      <view class="mx-auto box-border max-w-750px w-full px-4 pb-2">
        <view
          v-if="isAuthenticated"
          class="app-pressable pt-4 flex items-center"
          role="button"
          aria-label="查看个人信息"
          @click="openProfileInfo"
        >
          <wd-avatar
            :text="avatarText"
            size="104rpx"
            shape="round"
            bg-color="var(--app-action-primary)"
            color="var(--app-text-inverse)"
          />
          <view class="ml-3 min-w-0 flex-1">
            <view class="truncate text-34rpx font-bold leading-46rpx">
              {{ profileName }}
            </view>
            <view class="app-muted mt-1 truncate text-24rpx leading-34rpx">
              {{ profileDescription }}
            </view>
          </view>
          <wd-icon name="arrow-right" size="34rpx" color="var(--app-text-tertiary)" />
        </view>

        <view v-else class="pt-4 flex items-center">
          <wd-avatar
            icon="user"
            size="104rpx"
            shape="round"
            bg-color="var(--app-action-primary-soft)"
            color="var(--app-action-primary)"
          />
          <view class="ml-3 min-w-0 flex-1">
            <view class="truncate text-34rpx font-bold leading-46rpx">
              {{ profileName }}
            </view>
            <view class="app-muted mt-1 text-24rpx leading-34rpx">
              {{ profileDescription }}
            </view>
          </view>
          <view class="profile-login app-pressable" role="button" @click="openProfileInfo">
            登录
          </view>
        </view>

        <view v-if="isAuthenticated" class="profile-statistics mt-5 flex">
          <view
            v-for="item in statistics"
            :key="item.key"
            class="profile-statistics__item min-w-0 flex-1 py-3 text-center"
          >
            <view class="text-36rpx font-semibold leading-48rpx">
              <wd-count-to :end-val="item.value" color="var(--app-text-primary)" custom-class="text-36rpx font-semibold leading-48rpx"/>
            </view>
            <view class="app-tertiary mt-1 text-22rpx leading-30rpx">
              {{ item.label }}
            </view>
          </view>
        </view>
        <view
          v-if="isAuthenticated && summaryStatus === 'error'"
          class="app-tertiary app-pressable mt-2 text-center text-22rpx leading-32rpx"
          @click="loadSummary"
        >
          统计加载失败，点击重试
        </view>
      </view>
    </view>

    <view class="app-enter mx-auto box-border max-w-750px w-full pb-[calc(var(--app-current-tabbar-offset,100rpx)+40rpx)]">
      <view class="mt-4">
        <view class="profile-section-title px-4 pb-2">
          工作空间
        </view>
        <view>
          <wd-cell-group custom-class="profile-cell-group" insert>
            <wd-cell
              v-for="(item, index) in workspaceItems"
              :key="item.key"
              :title="item.label"
              :border="index > 0"
              is-link
              @click="openEntry(item)"
            >
              <template #prefix>
                <view class="profile-cell-icon relative top-0.5" :class="item.icon" />
              </template>
            </wd-cell>
          </wd-cell-group>
        </view>
      </view>

      <view class="mt-4">
        <view class="profile-section-title px-4 pb-2">
          账户与设置
        </view>
        <view >
          <wd-cell-group custom-class="profile-cell-group" insert>
            <wd-cell
              v-for="(item, index) in accountItems"
              :key="item.key"
              :title="item.label"
              :value="item.key === 'appearance' ? appearanceLabel : ''"
              :border="index > 0"
              is-link
              @click="openEntry(item)"
            >
              <template #prefix>
                <view class="profile-cell-icon relative top-0.5" :class="item.icon" />
              </template>
            </wd-cell>
          </wd-cell-group>
        </view>
      </view>

      <view class="mt-4">
        <view class="profile-section-title px-4 pb-2">
          服务与说明
        </view>
        <view>
          <wd-cell-group custom-class="profile-cell-group" insert>
            <wd-cell
              v-for="(item, index) in serviceItems"
              :key="item.key"
              :title="item.label"
              :border="index > 0"
              is-link
              @click="openEntry(item)"
            >
              <template #prefix>
                <view class="profile-cell-icon relative top-0.5" :class="item.icon"/>
              </template>
            </wd-cell>
          </wd-cell-group>
        </view>
      </view>

      <view class="app-tertiary mt-6 px-4 text-center text-22rpx leading-32rpx">
        蓝格智配 · 建筑节能 AI 智配
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.profile-page {
  background: var(--app-project-page-gradient);
}

.profile-hero {
  // background: var(--app-profile-account-gradient);
}

.profile-hero__safe {
  height: var(--profile-top-inset);
}

.profile-login {
  min-width: 112rpx;
  margin-left: 24rpx;
  padding: 14rpx 20rpx;
  border-radius: 999rpx;
  color: var(--app-action-primary);
  background: var(--app-bg-surface);
  font-size: 26rpx;
  font-weight: 600;
  line-height: 36rpx;
  text-align: center;
}

.profile-statistics {
  background: var(--app-bg-surface);
  border-radius: var(--app-radius-sm);
  box-shadow: var(--app-shadow-sm);
}

.profile-statistics__item + .profile-statistics__item {
  border-left: 1px solid var(--app-border-default);
}

.profile-section-title {
  color: var(--app-text-primary);
  font-size: 26rpx;
  font-weight: 700;
  line-height: 40rpx;
}

.profile-section-body {
  border-top: 1px solid var(--app-border-default);
  border-bottom: 1px solid var(--app-border-default);
  background: var(--app-bg-surface);
}

.profile-cell-icon {
  width: 40rpx;
  height: 40rpx;
  margin-right: 16rpx;
  color: var(--app-text-secondary);
}

:deep(.profile-cell-group),
:deep(.profile-cell-group .wd-cell) {
  background: transparent;
}

:deep(.profile-cell-group .wd-cell.is-hover) {
  background: var(--app-bg-soft);
}
</style>

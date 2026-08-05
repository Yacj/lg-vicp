<script setup lang="ts">
import { useAuthGate } from '@/composables/useAuthGate'

definePage({
  name: 'profile',
  layout: 'tabbar',
  style: {
    navigationStyle: 'custom',
  },
})

type ProfileEntry = 'conversations' | 'projects' | 'reports' | 'favorites' | 'agreement' | 'privacy' | 'ai-guide' | 'about'

interface ProfileMenuItem {
  key: ProfileEntry
  label: string
  description?: string
  icon: string
  route?: string
  requiresAuth?: boolean
}

const router = useRouter()
const { theme, toggleTheme } = useManualTheme()
const { requireLogin } = useAuthGate()
const globalDialog = useGlobalDialog()
const authStore = useAuthStore()
const isAuthenticated = computed(() => authStore.isAuthenticated)
const user = computed(() => authStore.user)
const profileName = computed(() => user.value?.displayName || '暂无登录')
const avatarText = computed(() => profileName.value.slice(0, 1))
const profileDescription = computed(() => isAuthenticated.value ? maskPhone(user.value?.phone) || '已登录工作空间' : '点击登录后管理项目和个人归档')
const isDark = computed({
  get: () => theme.value === 'dark',
  set: () => toggleTheme(),
})

const workspaceItems: ProfileMenuItem[] = [
  { key: 'conversations', label: 'AI 对话记录', icon: 'chat', route: 'conversation-history', requiresAuth: true },
  { key: 'projects', label: '我的项目', icon: 'folder', route: 'projects', requiresAuth: true },
  { key: 'reports', label: '我的报告', icon: 'document', route: 'reports', requiresAuth: true },
]

const collectionItems: ProfileMenuItem[] = [
  { key: 'favorites', label: '收藏节点图', icon: 'star', route: 'node-favorites', requiresAuth: true },
]

const serviceItems: ProfileMenuItem[] = [
  { key: 'agreement', label: '用户协议', icon: 'file', requiresAuth: false },
  { key: 'privacy', label: '隐私政策', icon: 'lock', requiresAuth: false },
  { key: 'ai-guide', label: 'AI 使用说明', icon: 'info', requiresAuth: false },
  { key: 'about', label: '关于蓝格智配', description: '当前版本 0.1.0', icon: 'info', route: 'about', requiresAuth: false },
]

function maskPhone(phone?: string | null) {
  if (!phone) {
    return ''
  }
  if (phone.length < 7) {
    return phone
  }
  return `${phone.slice(0, 3)} **** ${phone.slice(-4)}`
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

  openLegalContent(item.key)
}

function openLegalContent(key: ProfileEntry) {
  const content: Record<'agreement' | 'privacy' | 'ai-guide', { title: string, message: string }> = {
    'agreement': {
      title: '用户协议',
      message: '用户协议详情将在协议内容接入后展示。',
    },
    'privacy': {
      title: '隐私政策',
      message: '隐私政策详情将在协议内容接入后展示。',
    },
    'ai-guide': {
      title: 'AI 使用说明',
      message: 'AI 生成内容仅供项目分析参考，请结合实际项目资料和现行规范进行复核。',
    },
  }
  const item = content[key as keyof typeof content]
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
  <view class="app-page app-page--immersive">
    <wd-navbar
      custom-class="!bg-[var(--app-bg-canvas)]"
      title="我的"
      safe-area-inset-top
    />
    <view class="app-enter box-border px-4 py-4 pb-6">
      <view class="app-panel mb-5 overflow-hidden p-4" @click="openProfileInfo">
        <view class="flex items-center gap-3">
          <wd-avatar
            v-if="isAuthenticated"
            :text="avatarText"
            size="82rpx"
            shape="round"
            bg-color="var(--app-action-primary)"
            color="var(--app-text-inverse)"
          />
          <wd-avatar
            v-else
            icon="user"
            size="112rpx"
            shape="round"
            bg-color="var(--app-action-primary-soft)"
            color="var(--app-action-primary)"
          />
          <view class="min-w-0 flex-1">
            <view class="truncate text-38rpx font-bold">
              {{ profileName }}
            </view>
            <view class="app-muted mt-1 truncate text-3">
              {{ profileDescription }}
            </view>
          </view>
          <wd-icon name="arrow-right" size="40rpx" color="var(--app-text-tertiary)" />
        </view>
      </view>

      <view class="app-section-title mb-3">
        工作空间
      </view>
      <wd-cell-group insert custom-class="mb-5! overflow-hidden !mx-0">
        <wd-cell
          v-for="item in workspaceItems"
          :key="item.key"
          :title="item.label"
          :label="item.description"
          :prefix-icon="item.icon"
          is-link
          :border="true"
          @click="openEntry(item)"
        />
      </wd-cell-group>

      <view class="app-section-title mb-3">
        我的收藏
      </view>
      <wd-cell-group insert custom-class="mb-5! overflow-hidden !mx-0">
        <wd-cell
          v-for="item in collectionItems"
          :key="item.key"
          :title="item.label"
          :label="item.description"
          :prefix-icon="item.icon"
          is-link
          @click="openEntry(item)"
        />
      </wd-cell-group>

      <view class="app-section-title mb-3">
        设置与服务
      </view>
      <wd-cell-group insert custom-class="mb-5! overflow-hidden !mx-0">
        <wd-cell title="深色模式" prefix-icon="moon">
          <template #default>
            <wd-switch v-model="isDark" size="40rpx" />
          </template>
        </wd-cell>
        <wd-cell
          v-for="item in serviceItems"
          :key="item.key"
          :title="item.label"
          :label="item.description"
          :prefix-icon="item.icon"
          is-link
          @click="openEntry(item)"
        />
      </wd-cell-group>

      <view class="mt-5 text-center">
        <view class="app-tertiary text-2.5">
          蓝格智配 VICP · 建筑节能 AI 智配
        </view>
        <view class="app-tertiary mt-1 text-2.5">
          让每一次选型都有计算依据
        </view>
      </view>
    </view>
  </view>
</template>

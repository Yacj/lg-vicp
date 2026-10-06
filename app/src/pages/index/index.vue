<script setup lang="ts">
import type { ApiEnvelope, ApiPage, ConversationRecord } from '@/api/types'
import type { HomeEntryKey } from '@/components/home/HomeEntryGrid.vue'
import { aiApi } from '@/api/modules/ai'
import HomeEntryGrid from '@/components/home/HomeEntryGrid.vue'
import HomeHero from '@/components/home/HomeHero.vue'
import HomeSectionShell from '@/components/home/HomeSectionShell.vue'
import HomeWelcome from '@/components/home/HomeWelcome.vue'
import { useAsyncSection } from '@/composables/useAsyncSection'
import { getPlatformInfo } from '@/services/platform'
import { useAuthStore } from '@/store/auth'
import { formatRelativeTime } from '@/utils'

definePage({
  name: 'home',
  layout: 'tabbar',
  style: {
    navigationStyle: 'custom',
  },
})

const router = useRouter()
const { requireLogin, isAuthenticated, user } = useAuthGate()
const { openAssistant } = useAssistantNavigation()
const authStore = useAuthStore()
const { warning: showWarning } = useGlobalToast()

// 登录后由 getInfo 下发的能力集：明确无创建权限时隐藏新建入口（capabilities 未加载时保持展示）。
const canCreateProject = computed(() => !isAuthenticated.value || authStore.capabilities?.canCreateProject !== false)

// custom navigationStyle 下由首页避开系统状态栏；微信端继续避开右上角胶囊
const platformInfo = getPlatformInfo()
let homeTopInset = platformInfo.statusBarHeight
  ? `${platformInfo.statusBarHeight}px`
  : 'env(safe-area-inset-top)'

// #ifdef MP-WEIXIN
const menuButtonRect = uni.getMenuButtonBoundingClientRect()
homeTopInset = `${menuButtonRect.bottom + 4}px`
// #endif

const pageStyle = {
  '--home-status-bar-height': homeTopInset,
}

const {
  items: conversations,
  status: conversationStatus,
  load: loadConversations,
  reset: resetConversations,
} = useAsyncSection<ConversationRecord>(async () => {
  const response = await aiApi.listConversations({ clientApp: 'c_app', page: 1, pageSize: 5 }).send() as ApiEnvelope<ApiPage<ConversationRecord>>
  const items = response.data?.items || []
  return [...items]
    .sort((left, right) => Number(right.isPinned) - Number(left.isPinned))
    .slice(0, 3)
})

onShow(() => {
  // 会话接口要求登录，未登录不发起必然失败的请求。
  if (isAuthenticated.value) {
    void loadConversations()
  }
  else {
    resetConversations()
  }
})

function handleEntry(key: HomeEntryKey) {
  if (key === 'projects') {
    if (requireLogin()) {
      router.pushTab({ name: 'projects', params: { scope: 'mine' } })
    }
    return
  }

  if (key === 'create') {
    if (!requireLogin()) {
      return
    }
    if (authStore.capabilities?.canCreateProject === false) {
      showWarning('当前账号暂无创建项目权限')
      return
    }
    router.push({ name: 'project-create' })
    return
  }

  if (key === 'public') {
    if (requireLogin()) {
      router.push({ name: 'public-projects' })
    }
    return
  }

  if (key === 'library') {
    router.push({ name: 'library' })
  }
}

function openConversation(id: string) {
  openAssistant({ conversationId: id })
}

function goConversationHistory() {
  router.push({ name: 'conversation-history' })
}

function handleLoginPrompt() {
  requireLogin({ showToast: false })
}

function handleAskAssistant() {
  openAssistant()
}
</script>

<template>
  <view class="app-page home-page box-border min-h-screen" :style="pageStyle">
    <view class="home-status-safe" />

    <view class="app-enter mx-auto box-border max-w-960px w-full flex flex-col px-4 pb-6">
      <HomeWelcome
        :is-authenticated="isAuthenticated"
        :display-name="user?.displayName"
        @login="handleLoginPrompt"
      />

      <HomeHero class="mt-3" @ask="handleAskAssistant" />
      <HomeEntryGrid class="mt-3" :hide-create="!canCreateProject" @select="handleEntry" />

      <HomeSectionShell
        class="mt-4"
        title="最近会话"
        :status="conversationStatus"
        :empty="!conversations.length"
        @more="goConversationHistory"
        @retry="loadConversations"
      >
        <template #empty>
          <view class="flex flex-col items-center gap-3 px-4 pb-6 pt-2">
            <view class="app-tertiary text-2.5">
              暂无会话，向筑小格提第一个问题吧
            </view>
            <view class="home-empty-action app-pressable" @click="handleAskAssistant">
              去问问筑小格
            </view>
          </view>
        </template>

        <view class="home-rows">
          <view
            v-for="item in conversations"
            :key="item.id"
            class="home-row app-pressable flex items-center gap-3"
            @click="openConversation(item.id)"
          >
            <view class="home-row__icon app-tone is-ai flex shrink-0 items-center justify-center">
              <wd-icon name="message" size="30rpx" />
            </view>
            <view class="min-w-0 flex-1">
              <view class="flex items-center gap-1.5">
                <wd-icon
                  v-if="item.isPinned"
                  name="pushpin"
                  size="20rpx"
                  color="var(--app-action-primary)"
                />
                <view class="truncate text-3 font-medium">
                  {{ item.title || '未命名对话' }}
                </view>
              </view>
              <view class="app-tertiary mt-1 text-2.5">
                {{ formatRelativeTime(item.updatedAt) || '最近更新' }}
              </view>
            </view>
            <wd-icon name="arrow-right" size="28rpx" color="var(--app-text-disabled)" />
          </view>
        </view>
      </HomeSectionShell>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.home-page {
  background: var(--app-home-page-gradient);
}

.home-status-safe {
  height: var(--home-status-bar-height);
}

.home-row {
  min-height: 104rpx;
  padding: 20rpx 28rpx;
}

.home-row + .home-row {
  border-top: 1px solid var(--app-border-default);
}

.home-row__icon {
  width: 56rpx;
  height: 56rpx;
  border-radius: 14rpx;
}

.home-empty-action {
  padding: 12rpx 32rpx;
  border-radius: var(--app-radius-pill);
  color: var(--app-action-primary);
  background: var(--app-action-primary-soft);
  font-size: 24rpx;
  font-weight: 600;
}
</style>

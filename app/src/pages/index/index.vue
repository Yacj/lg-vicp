<script setup lang="ts">
import type { AiScene, ApiEnvelope, ApiPage, ConversationRecord, ProjectRecord } from '@/api/types'
import type { HomeEntryKey } from '@/components/home/HomeEntryGrid.vue'
import { aiApi } from '@/api/modules/ai'
import { projectApi } from '@/api/modules/projects'
import HomeEntryGrid from '@/components/home/HomeEntryGrid.vue'
import HomeHero from '@/components/home/HomeHero.vue'
import HomeSectionShell from '@/components/home/HomeSectionShell.vue'
import HomeWelcome from '@/components/home/HomeWelcome.vue'
import { useAsyncSection } from '@/composables/useAsyncSection'
import { getPlatformInfo } from '@/services/platform'
import { useAuthStore } from '@/store/auth'

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

const {
  items: recommendProjects,
  status: projectStatus,
  load: loadProjects,
  reset: resetProjects,
} = useAsyncSection<ProjectRecord>(async () => {
  const response = await projectApi.getPublic({ page: 1, pageSize: 3 }).send() as ApiEnvelope<ApiPage<ProjectRecord>>
  return response.data?.items || []
})

onShow(() => {
  // 公开项目接口要求登录，未登录不发起必然失败的请求。
  if (isAuthenticated.value) {
    void loadProjects()
    void loadConversations()
  }
  else {
    resetProjects()
    resetConversations()
  }
})

interface SceneMeta {
  label: string
  tone: 'primary' | 'energy' | 'ai' | 'warning' | 'neutral'
}

const sceneMetas: Record<AiScene, SceneMeta> = {
  general_chat: { label: '通用对话', tone: 'neutral' },
  project_design: { label: '项目设计', tone: 'primary' },
  material_compare: { label: '材料对比', tone: 'energy' },
  standard_qa: { label: '规范问答', tone: 'ai' },
  report_generate: { label: '报告生成', tone: 'warning' },
  information_extract: { label: '信息提取', tone: 'neutral' },
}

function sceneMeta(scene: AiScene) {
  return sceneMetas[scene] || { label: 'AI 分析', tone: 'neutral' }
}

function projectMeta(item: ProjectRecord) {
  return item.region || '未填写地区'
}

function projectTag(item: ProjectRecord) {
  return item.buildingType || '公开项目'
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '最近更新'
  }

  return `${date.getMonth() + 1}月${date.getDate()}日 ${date.toTimeString().slice(0, 5)}`
}

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
    router.pushTab({ name: 'projects', params: { scope: 'public' } })
    return
  }

  if (key === 'history' && requireLogin()) {
    goConversationHistory()
  }
}

function openConversation(id: string) {
  openAssistant({ conversationId: id })
}

// 详情页自带登录门控与 redirect 回跳，公开项目浏览不在首页拦截
function openProject(id: string) {
  router.push({ name: 'project-detail', params: { id } })
}

function goConversationHistory() {
  router.push({ name: 'conversation-history' })
}

function goPublicProjects() {
  router.pushTab({ name: 'projects', params: { scope: 'public' } })
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
        empty-icon="no-content"
        empty-tip="暂无会话"
        @more="goConversationHistory"
        @retry="loadConversations"
      >
        <view class="home-rows">
          <view
            v-for="item in conversations"
            :key="item.id"
            class="home-row app-pressable flex items-center gap-3"
            @click="openConversation(item.id)"
          >
            <view class="home-row__icon is-ai flex shrink-0 items-center justify-center">
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
                更新于 {{ formatTime(item.updatedAt) }}
              </view>
            </view>
            <view class="home-row__tag shrink-0" :class="`is-${sceneMeta(item.scene).tone}`">
              {{ sceneMeta(item.scene).label }}
            </view>
          </view>
        </view>
      </HomeSectionShell>
      <HomeSectionShell
        class="mt-4"
        title="推荐项目"
        :status="projectStatus"
        :empty="!recommendProjects.length"
        empty-icon="no-content"
        empty-tip="暂无公开项目"
        @more="goPublicProjects"
        @retry="loadProjects"
      >
        <view class="home-rows" v-if="isAuthenticated">
          <view
            v-for="item in recommendProjects"
            :key="item.id"
            class="home-row app-pressable flex items-center gap-3"
            @click="openProject(item.id)"
          >
            <view class="home-row__icon is-primary flex shrink-0 items-center justify-center">
              <wd-icon name="company" size="30rpx" />
            </view>
            <view class="min-w-0 flex-1">
              <view class="truncate text-3 font-medium">
                {{ item.name }}
              </view>
              <view class="app-tertiary mt-1 truncate text-2.5">
                {{ projectMeta(item) }} · 更新于 {{ formatTime(item.updatedAt) }}
              </view>
            </view>
            <view class="home-row__tag is-energy shrink-0">
              {{ projectTag(item) }}
            </view>
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

// .home-rows {
//   border-top: 1px solid var(--app-border-default);
// }

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

  &.is-primary {
    color: var(--app-action-primary);
    background: var(--app-action-primary-soft);
  }

  &.is-ai {
    color: var(--app-ai);
    background: var(--app-ai-soft);
  }
}

.home-row__tag {
  overflow: hidden;
  max-width: 152rpx;
  padding: 7rpx 12rpx;
  border-radius: 10rpx;
  font-size: 21rpx;
  line-height: 28rpx;
  text-overflow: ellipsis;
  white-space: nowrap;

  &.is-primary {
    color: var(--app-action-primary);
    background: var(--app-action-primary-soft);
  }

  &.is-energy {
    color: var(--app-energy);
    background: var(--app-energy-soft);
  }

  &.is-ai {
    color: var(--app-ai);
    background: var(--app-ai-soft);
  }

  &.is-warning {
    color: var(--app-warning);
    background: var(--app-warning-soft);
  }

  &.is-neutral {
    color: var(--app-text-tertiary);
    background: var(--app-bg-soft);
  }
}
</style>

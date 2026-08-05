<script setup lang="ts">
import type { AiScene, ApiEnvelope, ApiPage, ConversationRecord, ProjectRecord } from '@/api/types'
import { aiApi } from '@/api/modules/ai'
import { projectApi } from '@/api/modules/projects'

definePage({
  name: 'home',
  layout: 'tabbar',
  style: {
    navigationStyle: 'custom',
  },
})

type LoadStatus = 'idle' | 'loading' | 'success' | 'error'

const router = useRouter()
const { requireLogin, isAuthenticated } = useAuthGate()
const { openAssistant } = useAssistantNavigation()

// 最近会话 / 推荐项目：两个区块独立加载、独立失败，互不影响
const conversations = ref<ConversationRecord[]>([])
const conversationStatus = ref<LoadStatus>('idle')
const recommendProjects = ref<ProjectRecord[]>([])
const projectStatus = ref<LoadStatus>('idle')

const sceneLabels: Record<AiScene, string> = {
  general_chat: '通用对话',
  project_design: '项目设计',
  material_compare: '材料对比',
  standard_qa: '规范问答',
  report_generate: '报告生成',
  information_extract: '信息提取',
}

function sceneLabel(scene: AiScene) {
  return sceneLabels[scene] || 'AI 分析'
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '最近更新'
  }

  return `${date.getMonth() + 1}月${date.getDate()}日 ${date.toTimeString().slice(0, 5)}`
}

async function loadRecentConversations() {
  conversationStatus.value = 'loading'
  try {
    const response = await aiApi.listConversations({ clientApp: 'c_app', page: 1, pageSize: 3 }).send() as ApiEnvelope<ApiPage<ConversationRecord>>
    conversations.value = response.data?.items || []
    conversationStatus.value = 'success'
  }
  catch {
    conversationStatus.value = 'error'
  }
}

async function loadRecommendProjects() {
  projectStatus.value = 'loading'
  try {
    const response = await projectApi.getPublic({ page: 1, pageSize: 3 }).send() as ApiEnvelope<ApiPage<ProjectRecord>>
    recommendProjects.value = response.data?.items || []
    projectStatus.value = 'success'
  }
  catch {
    projectStatus.value = 'error'
  }
}

// Tab 页每次显示刷新；未登录不请求，由区块引导登录
onShow(() => {
  if (!isAuthenticated.value) {
    conversations.value = []
    recommendProjects.value = []
    conversationStatus.value = 'idle'
    projectStatus.value = 'idle'
    return
  }

  void loadRecentConversations()
  void loadRecommendProjects()
})

const entries = [
  { key: 'projects', label: '我的项目', description: '查看与跟进项目', icon: 'home' },
  { key: 'public', label: '公开项目', description: '浏览公开案例', icon: 'public' },
  { key: 'assistant', label: 'AI 助手', description: '筑小格帮你整理参数', icon: 'chat' },
  { key: 'create', label: '新建项目', description: '创建节能项目', icon: 'add' },
] as const

function handleEntry(key: (typeof entries)[number]['key']) {
  if (key === 'projects') {
    if (requireLogin()) {
      router.pushTab({ name: 'projects', query: { scope: 'mine' } })
    }
    return
  }

  if (key === 'public') {
    router.pushTab({ name: 'projects', query: { scope: 'public' } })
    return
  }

  if (key === 'assistant') {
    router.pushTab({ name: 'assistant' })
    return
  }

  if (key === 'create') {
    if (requireLogin()) {
      router.push({ name: 'project-create' })
    }
  }
}

function openConversation(id: string) {
  openAssistant({ conversationId: id })
}

function openProject(id: string) {
  if (requireLogin()) {
    router.push({ name: 'project-detail', query: { id } })
  }
}

function goConversationHistory() {
  router.push({ name: 'conversation-history' })
}

function goPublicProjects() {
  router.pushTab({ name: 'projects', query: { scope: 'public' } })
}

function handleLoginPrompt() {
  requireLogin({ showToast: false })
}
</script>

<template>
  <view class="app-page app-page--immersive home-page box-border min-h-screen flex flex-col">
    <wd-navbar custom-class="!bg-transparent" safe-area-inset-top title="首页" />

    <view class="app-enter home-page__body min-h-0 flex-1 px-4">
      <view class="home-hero mt-4">
        <view class="app-eyebrow mb-2">
          蓝格智配
        </view>
        <view class="text-6 font-bold leading-8">
          建筑节能智能助手
        </view>
        <view class="app-muted mt-2 max-w-680rpx text-3.5 leading-6">
          从项目参数整理到方案匹配，一站式推进节能设计。
        </view>
      </view>

      <view class="home-entries mt-6">
        <view
          v-for="entry in entries"
          :key="entry.key"
          class="home-entry app-panel-flat flex items-center gap-3 p-4"
          @click="handleEntry(entry.key)"
        >
          <view class="home-entry__icon flex shrink-0 items-center justify-center rounded-2xl">
            <wd-icon :name="entry.icon" size="44rpx" color="var(--app-action-primary)" />
          </view>
          <view class="min-w-0 flex-1">
            <view class="text-3.5 font-medium">
              {{ entry.label }}
            </view>
            <view class="app-muted mt-0.5 text-2.5">
              {{ entry.description }}
            </view>
          </view>
          <wd-icon name="arrow-right" size="32rpx" color="var(--app-text-tertiary)" />
        </view>
      </view>

      <view class="home-section mt-8">
        <view class="mb-3 flex items-center justify-between">
          <view class="app-section-title">
            最近会话
          </view>
          <view class="app-section-more" @click="goConversationHistory">
            查看全部
          </view>
        </view>

        <view v-if="!isAuthenticated" class="app-panel-flat flex items-center gap-3 p-4" @click="handleLoginPrompt">
          <view class="home-entry__icon flex shrink-0 items-center justify-center rounded-2xl">
            <wd-icon name="chat" size="40rpx" color="var(--app-action-primary)" />
          </view>
          <view class="min-w-0 flex-1">
            <view class="text-3.5 font-medium">
              登录后查看最近会话
            </view>
            <view class="app-muted mt-0.5 text-2.5">
              与筑小格的每一次对话都会记录在这里
            </view>
          </view>
          <wd-icon name="arrow-right" size="32rpx" color="var(--app-text-tertiary)" />
        </view>

        <view v-else-if="conversationStatus === 'loading'" class="app-panel-flat flex items-center justify-center gap-2 py-6">
          <wd-loading size="32rpx" color="var(--app-action-primary)" />
          <view class="app-tertiary text-3">
            加载中
          </view>
        </view>

        <view v-else-if="conversationStatus === 'error'" class="app-panel-flat flex items-center justify-center gap-2 py-6" @click="loadRecentConversations">
          <wd-icon name="refresh" size="32rpx" color="var(--app-text-tertiary)" />
          <view class="app-tertiary text-3">
            加载失败，点击重试
          </view>
        </view>

        <wd-empty v-else-if="!conversations.length" icon="chat" tip="暂无会话，去和筑小格聊聊吧" />

        <wd-cell-group v-else insert custom-class="overflow-hidden">
          <wd-cell
            v-for="item in conversations"
            :key="item.id"
            :title="item.title || '未命名对话'"
            :label="`${sceneLabel(item.scene)} · ${formatTime(item.updatedAt)}`"
            prefix-icon="chat"
            is-link
            @click="openConversation(item.id)"
          />
        </wd-cell-group>
      </view>

      <view class="home-section mt-8">
        <view class="mb-3 flex items-center justify-between">
          <view class="app-section-title">
            推荐项目
          </view>
          <view class="app-section-more" @click="goPublicProjects">
            查看全部
          </view>
        </view>

        <view v-if="!isAuthenticated" class="app-panel-flat flex items-center gap-3 p-4" @click="handleLoginPrompt">
          <view class="home-entry__icon flex shrink-0 items-center justify-center rounded-2xl">
            <wd-icon name="public" size="40rpx" color="var(--app-action-primary)" />
          </view>
          <view class="min-w-0 flex-1">
            <view class="text-3.5 font-medium">
              登录后浏览推荐项目
            </view>
            <view class="app-muted mt-0.5 text-2.5">
              节能设计案例与优秀实践都在这里
            </view>
          </view>
          <wd-icon name="arrow-right" size="32rpx" color="var(--app-text-tertiary)" />
        </view>

        <view v-else-if="projectStatus === 'loading'" class="app-panel-flat flex items-center justify-center gap-2 py-6">
          <wd-loading size="32rpx" color="var(--app-action-primary)" />
          <view class="app-tertiary text-3">
            加载中
          </view>
        </view>

        <view v-else-if="projectStatus === 'error'" class="app-panel-flat flex items-center justify-center gap-2 py-6" @click="loadRecommendProjects">
          <wd-icon name="refresh" size="32rpx" color="var(--app-text-tertiary)" />
          <view class="app-tertiary text-3">
            加载失败，点击重试
          </view>
        </view>

        <wd-empty v-else-if="!recommendProjects.length" icon="public" tip="暂无公开项目" />

        <wd-cell-group v-else insert custom-class="overflow-hidden">
          <wd-cell
            v-for="item in recommendProjects"
            :key="item.id"
            :title="item.name"
            :label="[item.region, item.buildingType].filter(Boolean).join(' · ') || '节能设计项目'"
            prefix-icon="public"
            is-link
            @click="openProject(item.id)"
          />
        </wd-cell-group>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.home-page {
  background: var(--app-bg-surface);
}

.home-page__body {
  padding-bottom: env(safe-area-inset-bottom);
}

.home-entry {
  border-radius: var(--app-radius-lg);
  transition: transform var(--app-transition-fast) ease, background-color var(--app-transition-fast) ease;
}

.home-entry + .home-entry {
  margin-top: 20rpx;
}

.home-entry:active {
  transform: scale(0.985);
}

.home-entry__icon {
  width: 88rpx;
  height: 88rpx;
  background: var(--app-action-primary-soft);
}

.home-section {
  padding-bottom: 40rpx;
}
</style>

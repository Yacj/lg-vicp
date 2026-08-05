<script setup lang="ts">
import type { ApiEnvelope, ApiPage, ConversationRecord } from '@/api/types'
import { aiApi } from '@/api/modules/ai'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'
import { useAssistantStore } from '@/store/assistant'

definePage({
  name: 'conversation-history',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: 'AI 对话记录',
    enablePullDownRefresh: true,
  },
})

type ConversationAction = 'rename' | 'pin' | 'delete'

const PAGE_SIZE = 20

const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const { openAssistant } = useAssistantNavigation()
const { success, error: showError } = useGlobalToast()
const globalDialog = useGlobalDialog()
const assistantStore = useAssistantStore()
const items = ref<ConversationRecord[]>([])
const status = ref<'idle' | 'loading' | 'success' | 'error'>('loading')
const page = ref(1)
const total = ref(0)
const loadingMore = ref(false)
const loadMoreFailed = ref(false)
const actionSheetVisible = ref(false)
const actionConversationId = ref<string>()
const actionProcessing = ref(false)

const canLoadMore = computed(() => items.value.length < total.value)
const actionConversation = computed(() => items.value.find(item => item.id === actionConversationId.value))
const actionItems = computed(() => {
  const conversation = actionConversation.value
  return [
    { key: 'rename', name: '重命名' },
    { key: 'pin', name: conversation?.isPinned ? '取消置顶' : '置顶' },
    { key: 'delete', name: '删除', color: 'var(--app-danger)' },
  ]
})

onMounted(() => {
  if (requireLogin({ showToast: false })) {
    void reloadConversations()
  }
})

onPullDownRefresh(async () => {
  if (requireLogin({ showToast: false })) {
    await reloadConversations()
  }
  uni.stopPullDownRefresh()
})

onReachBottom(() => {
  void loadMoreConversations()
})

function sortConversations(conversations: ConversationRecord[]) {
  return [...conversations].sort((left, right) => {
    if (left.isPinned !== right.isPinned) {
      return Number(right.isPinned) - Number(left.isPinned)
    }
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  })
}

async function requestConversations(targetPage: number) {
  return await aiApi.listConversations({
    clientApp: 'c_app',
    page: targetPage,
    pageSize: PAGE_SIZE,
  }).send() as ApiEnvelope<ApiPage<ConversationRecord>>
}

async function reloadConversations() {
  status.value = 'loading'
  loadMoreFailed.value = false
  try {
    const response = await requestConversations(1)
    const data = response.data
    items.value = sortConversations(data?.items || [])
    total.value = data?.total || 0
    page.value = 1
    status.value = 'success'
  }
  catch {
    status.value = 'error'
  }
}

async function loadMoreConversations() {
  if (status.value !== 'success' || loadingMore.value || !canLoadMore.value) {
    return
  }

  loadingMore.value = true
  loadMoreFailed.value = false
  const nextPage = page.value + 1
  try {
    const response = await requestConversations(nextPage)
    const nextItems = response.data?.items || []
    const indexed = new Map(items.value.map(item => [item.id, item]))
    nextItems.forEach(item => indexed.set(item.id, item))
    items.value = sortConversations([...indexed.values()])
    total.value = response.data?.total || total.value
    page.value = nextPage
  }
  catch {
    loadMoreFailed.value = true
  }
  finally {
    loadingMore.value = false
  }
}

function enterConversation(id: string) {
  openAssistant({ conversationId: id })
}

function openConversation(id: string) {
  if (assistantStore.isStreaming && id !== assistantStore.conversationId) {
    globalDialog.confirm({
      title: '切换对话',
      msg: '当前回答仍在生成，切换会话将停止本次生成。',
      confirmButtonText: '停止并切换',
      cancelButtonText: '留在当前对话',
      success: () => enterConversation(id),
    })
    return
  }
  enterConversation(id)
}

function openActions(id: string) {
  if (actionProcessing.value) {
    return
  }
  actionConversationId.value = id
  actionSheetVisible.value = true
}

function handleActionSelect(event: { item: { key?: ConversationAction } }) {
  actionSheetVisible.value = false
  const action = event.item.key
  const id = actionConversationId.value
  if (!action || !id) {
    return
  }

  if (action === 'rename') {
    renameConversation(id)
  }
  else if (action === 'pin') {
    void togglePinConversation(id)
  }
  else {
    confirmDeleteConversation(id)
  }
}

function renameConversation(id: string) {
  const conversation = items.value.find(item => item.id === id)
  if (!conversation) {
    return
  }

  globalDialog.prompt({
    title: '重命名会话',
    inputValue: conversation.title || '未命名对话',
    inputProps: {
      maxlength: 60,
      clearable: true,
      placeholder: '请输入会话名称',
    },
    inputValidate(value) {
      return Boolean(String(value).trim()) || '名称不能为空'
    },
    confirmButtonText: '保存',
    cancelButtonText: '取消',
    success(result) {
      const title = String(result.value || '').trim()
      if (title) {
        void updateConversationTitle(id, title)
      }
    },
  })
}

async function updateConversationTitle(id: string, title: string) {
  actionProcessing.value = true
  try {
    await aiApi.updateConversation(id, { title }).send()
    const conversation = items.value.find(item => item.id === id)
    if (conversation) {
      conversation.title = title
    }
    success('已重命名')
  }
  catch {
    showError('重命名失败，请重试')
  }
  finally {
    actionProcessing.value = false
  }
}

async function togglePinConversation(id: string) {
  const conversation = items.value.find(item => item.id === id)
  if (!conversation) {
    return
  }

  actionProcessing.value = true
  const nextPinned = !conversation.isPinned
  try {
    await aiApi.pinConversation(id, nextPinned).send()
    conversation.isPinned = nextPinned
    items.value = sortConversations(items.value)
    success(nextPinned ? '已置顶' : '已取消置顶')
  }
  catch {
    showError('置顶操作失败，请重试')
  }
  finally {
    actionProcessing.value = false
  }
}

function confirmDeleteConversation(id: string) {
  const conversation = items.value.find(item => item.id === id)
  if (!conversation) {
    return
  }

  globalDialog.confirm({
    title: '删除会话',
    msg: `删除“${conversation.title || '未命名对话'}”后无法恢复，确定继续吗？`,
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    confirmButtonProps: {
      type: 'danger',
    },
    success: () => {
      void deleteConversation(id)
    },
  })
}

async function deleteConversation(id: string) {
  actionProcessing.value = true
  try {
    await aiApi.removeConversation(id).send()
    items.value = items.value.filter(item => item.id !== id)
    total.value = Math.max(0, total.value - 1)
    if (assistantStore.conversationId === id) {
      assistantStore.newConversation()
    }
    success('会话已删除')
  }
  catch {
    showError('删除失败，请重试')
  }
  finally {
    actionProcessing.value = false
  }
}

function conversationMeta(item: ConversationRecord) {
  const labels = [formatTime(item.updatedAt)]
  if (item.projectId) {
    labels.push('项目会话')
  }
  return labels.join(' · ')
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '最近更新'
  }

  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return `今天 ${date.toTimeString().slice(0, 5)}`
  }
  return `${date.getMonth() + 1}月${date.getDate()}日 ${date.toTimeString().slice(0, 5)}`
}
</script>

<template>
  <view class="app-page app-page--immersive min-h-screen">
    <wd-navbar
      custom-class="app-navbar"
      safe-area-inset-top
      left-arrow
      title="AI 对话记录"
      @click-left="goBack"
    />

    <view class="app-enter conversation-history box-border px-4 py-4 pb-8">
      <view class="conversation-history__intro mb-4">
        <view class="app-eyebrow">
          CONVERSATIONS
        </view>
        <view class="mt-1 text-5 font-bold">
          你的 AI 工作记录
        </view>
        <view class="app-muted mt-1 text-2.5">
          保留重要讨论，继续推进每一次设计判断。
        </view>
      </view>

      <view v-if="status === 'loading'" class="flex flex-col items-center justify-center py-16">
        <wd-loading size="48rpx" color="var(--app-action-primary)" />
        <view class="app-muted mt-3 text-3">
          正在加载对话记录
        </view>
      </view>

      <view v-else-if="status === 'error'" class="py-10">
        <wd-empty icon="no-result" tip="对话记录加载失败，点击重试" @click="reloadConversations" />
      </view>

      <view v-else-if="status === 'success' && !items.length" class="conversation-history__empty app-panel-flat py-12">
        <wd-empty icon="no-message" tip="暂无 AI 对话记录，开始一次新的分析吧" />
      </view>

      <template v-else>
        <view class="conversation-history__list">
          <view
            v-for="item in items"
            :key="item.id"
            class="conversation-card app-panel-flat app-pressable"
            :class="{ 'conversation-card--active': item.id === assistantStore.conversationId }"
            @click="openConversation(item.id)"
          >
            <view class="flex items-start gap-3">
              <view class="conversation-card__icon flex shrink-0 items-center justify-center rounded-2xl">
                <wd-icon name="message" size="38rpx" color="var(--app-action-primary)" />
              </view>
              <view class="min-w-0 flex-1">
                <view class="min-w-0 flex items-center gap-2">
                  <text class="conversation-card__title min-w-0 flex-1 truncate">
                    {{ item.title || '未命名对话' }}
                  </text>
                  <view v-if="item.id === assistantStore.conversationId" class="conversation-card__current flex shrink-0 items-center">
                    <text>
                      当前会话
                    </text>
                  </view>
                  <view v-if="item.isPinned" class="conversation-card__pin flex shrink-0 items-center gap-1">
                    <wd-icon name="pushpin" size="22rpx" />
                    <text>
                      已置顶
                    </text>
                  </view>
                </view>
                <text class="conversation-card__meta app-muted mt-1 block truncate">
                  {{ conversationMeta(item) }}
                </text>
              </view>
              <view class="conversation-card__menu flex shrink-0 items-center justify-center" aria-label="会话操作" @click.stop="openActions(item.id)">
                <wd-icon name="more" size="34rpx" color="var(--app-text-tertiary)" />
              </view>
            </view>
            <view class="conversation-card__footer mt-3 flex items-center justify-between">
              <text class="app-tertiary text-2.5">
                {{ item.id === assistantStore.conversationId ? '当前正在使用' : '点击继续对话' }}
              </text>
              <wd-icon name="arrow-right" size="28rpx" color="var(--app-text-tertiary)" />
            </view>
          </view>
        </view>

        <view class="app-muted flex items-center justify-center py-5 text-2.5">
          <template v-if="loadingMore">
            <wd-loading size="30rpx" color="var(--app-action-primary)" />
            <text class="ml-2">
              加载更多会话
            </text>
          </template>
          <text v-else-if="loadMoreFailed" class="app-danger-text" @click="loadMoreConversations">
            加载失败，点击重试
          </text>
          <text v-else-if="canLoadMore">
            继续上拉加载
          </text>
          <text v-else>
            已显示全部 {{ total }} 条会话
          </text>
        </view>
      </template>
    </view>

    <wd-action-sheet
      v-model="actionSheetVisible"
      root-portal
      title="会话操作"
      cancel-text="取消"
      :actions="actionItems"
      :close-on-click-action="true"
      safe-area-inset-bottom
      @select="handleActionSelect"
    />
  </view>
</template>

<style lang="scss" scoped>
.conversation-history {
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
}

.conversation-history__intro {
  padding: 8rpx 4rpx 4rpx;
}

.conversation-history__empty {
  border-radius: var(--app-radius-lg);
  background: var(--app-bg-surface);
}

.conversation-card {
  padding: 28rpx;
  border-radius: var(--app-radius-md);
  background: var(--app-bg-surface);
  transition: transform var(--app-transition-fast) ease, border-color var(--app-transition-fast) ease, background-color var(--app-transition-fast) ease;
}

.conversation-card + .conversation-card {
  margin-top: 20rpx;
}

.conversation-card--active {
  border-color: var(--app-action-primary);
  background: var(--app-action-primary-soft);
}

.conversation-card__icon {
  width: 80rpx;
  height: 80rpx;
  background: var(--app-action-primary-soft);
}

.conversation-card__title {
  color: var(--app-text-primary);
  font-size: 30rpx;
  font-weight: 650;
  line-height: 42rpx;
}

.conversation-card__meta {
  font-size: 23rpx;
  line-height: 34rpx;
}

.conversation-card__current,
.conversation-card__pin {
  padding: 4rpx 10rpx;
  border-radius: var(--app-radius-pill);
  font-size: 20rpx;
  line-height: 28rpx;
}

.conversation-card__current {
  color: var(--app-action-primary);
  background: var(--app-action-primary-soft);
}

.conversation-card__pin {
  color: var(--app-energy);
  background: var(--app-energy-soft);
}

.conversation-card__menu {
  width: 64rpx;
  height: 64rpx;
  margin: -10rpx -10rpx 0 0;
  color: var(--app-text-tertiary);
}

.conversation-card__menu:active {
  color: var(--app-action-primary);
}

.conversation-card__footer {
  padding-top: 18rpx;
  border-top: 1px solid var(--app-border-default);
}
</style>

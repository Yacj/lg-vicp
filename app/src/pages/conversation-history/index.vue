<script setup lang="ts">
import type { ApiEnvelope, ApiPage, ConversationRecord } from '@/api/types'
import { aiApi } from '@/api/modules/ai'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'

definePage({
  name: 'conversation-history',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: 'AI 对话记录',
  },
})

const router = useRouter()
const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const items = ref<ConversationRecord[]>([])
const status = ref<'idle' | 'loading' | 'success' | 'error'>('idle')

onMounted(() => {
  if (requireLogin({ showToast: false })) {
    void loadConversations()
  }
})

async function loadConversations() {
  status.value = 'loading'
  try {
    const response = await aiApi.listConversations({ clientApp: 'c_app', page: 1, pageSize: 20 }).send() as ApiEnvelope<ApiPage<ConversationRecord>>
    items.value = response.data?.items || []
    status.value = 'success'
  }
  catch {
    status.value = 'error'
  }
}

function openConversation(id: string) {
  router.push({ name: 'assistant', query: { conversationId: id } })
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '最近更新'
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

    <view class="app-enter box-border px-4 py-4 pb-6">
      <view v-if="status === 'loading'" class="flex flex-col items-center justify-center py-16">
        <wd-loading size="48rpx" color="var(--app-action-primary)" />
        <view class="app-muted mt-3 text-3">
          正在加载对话记录
        </view>
      </view>

      <view v-else-if="status === 'error'" class="py-10">
        <wd-empty icon="no-result" tip="对话记录加载失败，点击重试" @click="loadConversations" />
      </view>

      <view v-else-if="status === 'success' && !items.length" class="py-10">
        <wd-empty icon="chat" tip="暂无 AI 对话记录，开始一次新的分析吧" />
      </view>

      <wd-cell-group v-else insert custom-class="overflow-hidden">
        <wd-cell
          v-for="item in items"
          :key="item.id"
          :title="item.title || '未命名对话'"
          :label="`${formatTime(item.updatedAt)} · ${item.isPinned ? '已置顶' : 'AI 分析记录'}`"
          prefix-icon="chat"
          is-link
          @click="openConversation(item.id)"
        />
      </wd-cell-group>
    </view>
  </view>
</template>

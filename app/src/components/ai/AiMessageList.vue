<script setup lang="ts">
import type { AiFeedbackReaction, AiMessageFeedback, AiSourceRef } from '@/api/types'
import type { LocalMessage } from '@/store/assistant'
import AiSourceCard from '@/components/ai/AiSourceCard.vue'
import { markdownStyle, markdownToPlainText, renderMarkdown } from '@/utils/markdown'

const props = defineProps<{
  messages: LocalMessage[]
  isStreaming: boolean
  streamingMessageId: string | null
  progressMessage: string | null
  feedbacks?: Record<string, AiMessageFeedback[]>
  selectionMode?: boolean
  selectedIds?: string[]
}>()

const emit = defineEmits<{
  regenerate: [messageId: string]
  feedback: [messageId: string, reaction: 'LIKE' | 'DISLIKE' | null]
  share: []
  toggleSelect: [messageId: string]
  openSource: [source: AiSourceRef]
}>()

const { info: toastInfo } = useGlobalToast()

/** AI 消息渲染缓存：messageId → html（流式消息除外，完成态只解析一次） */
const htmlCache = reactive<Record<string, string>>({})
/** 流式消息的节流渲染结果 */
const streamingHtml = ref('')
let streamingTimer: ReturnType<typeof setTimeout> | null = null

const streamingContent = computed(() => {
  if (!props.isStreaming) {
    return ''
  }
  const message = props.messages.find(item => item.id === props.streamingMessageId)
  return message?.content ?? ''
})

// 流式期间节流渲染，避免每个 delta 都触发 mp-html 全量解析
watch(streamingContent, (content) => {
  if (streamingTimer) {
    clearTimeout(streamingTimer)
  }
  streamingTimer = setTimeout(() => {
    streamingHtml.value = renderMarkdown(content)
  }, 150)
})

onUnmounted(() => {
  if (streamingTimer) {
    clearTimeout(streamingTimer)
  }
})

function getHtml(message: LocalMessage) {
  if (props.isStreaming && message.id === props.streamingMessageId) {
    return streamingHtml.value
  }
  if (!htmlCache[message.id]) {
    htmlCache[message.id] = renderMarkdown(message.content)
  }
  return htmlCache[message.id]
}

function currentReaction(messageId: string): AiFeedbackReaction | null {
  return props.feedbacks?.[messageId]?.[0]?.reaction ?? null
}

function handleFeedback(messageId: string, reaction: 'LIKE' | 'DISLIKE' | null) {
  emit('feedback', messageId, currentReaction(messageId) === reaction ? null : reaction)
}

function copyMessage(message: LocalMessage) {
  uni.setClipboardData({
    data: markdownToPlainText(message.content),
    success: () => toastInfo('已复制'),
  })
}

function isUser(message: LocalMessage) {
  return message.role === 'USER'
}

function isShareable(message: LocalMessage) {
  return message.status === 'COMPLETED' && (message.role === 'USER' || message.role === 'ASSISTANT')
}

function isSelected(messageId: string) {
  return props.selectedIds?.includes(messageId) ?? false
}

function handleToggleSelect(message: LocalMessage) {
  if (!isShareable(message)) {
    return
  }
  emit('toggleSelect', message.id)
}
</script>

<template>
  <view class="pb-5 pt-4 space-y-5">
    <view
      v-for="message in messages"
      :key="message.id"
      class="flex gap-2.5"
      :class="isUser(message) ? 'items-center justify-end' : 'items-start'"
    >
      <view
        v-if="selectionMode"
        class="ai-select flex shrink-0 items-center justify-center"
        :class="[
          isSelected(message.id) ? 'ai-select--checked' : '',
          isShareable(message) ? '' : 'ai-select--disabled',
        ]"
        @click="handleToggleSelect(message)"
      >
        <wd-icon v-if="isSelected(message.id)" name="check" size="28rpx" color="var(--app-text-inverse)" />
      </view>

      <view v-if="!isUser(message)" class="ai-avatar flex shrink-0 items-center justify-center rounded-full">
        <image class="ai-avatar__logo" src="/static/cover.png" mode="aspectFit" />
      </view>

      <view
        class="min-w-0"
        :class="isUser(message) ? 'max-w-[82%]' : 'ai-message__assistant flex-1'"
      >
        <!-- 用户消息：纯文本气泡 -->
        <view
          v-if="isUser(message)"
          class="ai-message__user inline-block max-w-full rounded-3 px-3.5 py-3 text-3.5 leading-5"
        >
          <text class="whitespace-pre-wrap break-words">
            {{ message.content }}
          </text>
        </view>

        <!-- AI 消息：Markdown 气泡 -->
        <view v-else class="ai-message__answer app-panel-flat px-3.5 py-3">
          <mp-html
            :content="getHtml(message)"
            :extern-style="markdownStyle"
            container-style="font-size: 28rpx; line-height: 1.7; overflow-wrap: break-word;"
          />
        </view>

        <!-- AI 回答的辅助信息区 -->
        <template v-if="!isUser(message)">
          <!-- 流式进度 -->
          <view
            v-if="message.id === streamingMessageId && isStreaming"
            class="app-muted mt-1.5 flex items-center gap-1.5 text-2.5"
          >
            <view class="ai-streaming-dot" />
            <text>
              {{ progressMessage || '正在思考' }}
            </text>
          </view>

          <view v-else-if="message.status === 'STOPPED'" class="app-tertiary mt-1.5 text-2.5">
            已停止生成
          </view>

          <view
            v-else-if="message.status === 'FAILED'"
            class="app-danger-text mt-1.5 flex items-center gap-1 text-2.5"
            @click="emit('regenerate', message.id)"
          >
            <wd-icon name="warning" size="26rpx" />
            <text>
              {{ message.errorMessage || '生成失败' }}，点击重试
            </text>
          </view>

          <!-- 来源引用：只展示用户可理解字段，空来源不渲染 -->
          <AiSourceCard
            v-if="message.status === 'COMPLETED' && message.sources?.length"
            :sources="message.sources"
            @open="emit('openSource', $event)"
          />

          <!-- 操作行：重新生成 / 复制 / 点赞 / 点踩 / 分享 -->
          <view
            v-if="!selectionMode && (message.status === 'COMPLETED' || message.status === 'STOPPED')"
            class="app-muted mt-1 flex items-center"
          >
            <view class="ai-action" @click="emit('regenerate', message.id)">
              <wd-icon name="refresh" size="32rpx" />
            </view>
            <view class="ai-action" @click="copyMessage(message)">
              <wd-icon name="copy" size="32rpx" />
            </view>
            <view
              class="ai-action"
              :class="currentReaction(message.id) === 'LIKE' ? 'app-primary-text' : ''"
              @click="handleFeedback(message.id, 'LIKE')"
            >
              <wd-icon
                :name="currentReaction(message.id) === 'LIKE' ? 'thumb-up-fill' : 'thumb-up'"
                size="32rpx"
              />
            </view>
            <view
              class="ai-action"
              :class="currentReaction(message.id) === 'DISLIKE' ? 'app-danger-text' : ''"
              @click="handleFeedback(message.id, 'DISLIKE')"
            >
              <wd-icon
                :name="currentReaction(message.id) === 'DISLIKE' ? 'thumb-down-fill' : 'thumb-down'"
                size="32rpx"
              />
            </view>
            <view class="ai-action" aria-label="分享" @click="emit('share')">
              <text class="i-my-icons-share text-4" />
            </view>
          </view>
        </template>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-avatar {
  width: 56rpx;
  height: 56rpx;
  margin-top: 4rpx;
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border-default);
}

.ai-avatar__logo {
  width: 55px;
  height: 55rpx;
}

.ai-message__assistant {
  max-width: calc(100% - 72rpx);
}

.ai-message__user {
  color: var(--app-text-inverse);
  background: var(--app-action-primary);
  border-bottom-right-radius: 8rpx;
}

.ai-message__answer {
  width: 100%;
  border-radius: 8rpx 28rpx 28rpx;
  background: var(--app-bg-elevated);
}

.ai-action {
  display: flex;
  align-items: center;
  padding: 12rpx 20rpx 4rpx 0;
  color: var(--app-text-tertiary);
  cursor: pointer;
}

.ai-select {
  width: 40rpx;
  height: 40rpx;
  border-radius: 50%;
  border: 2rpx solid var(--app-border-default);
  background: var(--app-bg-surface);
  transition: border-color var(--app-transition-fast) ease, background var(--app-transition-fast) ease,
    opacity var(--app-transition-fast) ease, transform var(--app-transition-fast) ease;
}

.ai-select--checked {
  border-color: var(--app-action-primary);
  background: var(--app-action-primary);
}

.ai-select--disabled {
  opacity: 0.4;
}

.ai-streaming-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: var(--app-ai);
  animation: ai-streaming-pulse 1.1s ease-in-out infinite;
}

@keyframes ai-streaming-pulse {
  0%, 100% {
    opacity: 0.25;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}
</style>

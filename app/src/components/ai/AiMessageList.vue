<script setup lang="ts">
import type { AiFeedbackReaction, AiMessageFeedback, AiSourceRef, ApiEnvelope, DownloadUrlResult, MessageAttachment } from '@/api/types'
import type { LocalMessage } from '@/store/assistant'
import { fileApi } from '@/api/modules/files'
import AiAgentStatus from '@/components/ai/AiAgentStatus.vue'
import AiComparisonCard from '@/components/ai/AiComparisonCard.vue'
import AiProductCard from '@/components/ai/AiProductCard.vue'
import AiSourceCard from '@/components/ai/AiSourceCard.vue'
import { CHAT_IMAGE_ONLY_CONTENT, VISION_FAILURE_MESSAGE } from '@/constants/chatImage'
import { isSourceInquiry, previousUserText, splitAnswerLayers } from '@/utils/aiAnswerUx'
import { markdownTagStyle, markdownToPlainText, renderMarkdown } from '@/utils/markdown'

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
  resend: [messageId: string]
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

const visibleMessages = computed(() => props.messages.filter(item => item.role !== 'SYSTEM'))
const expandedDetails = reactive<Record<string, boolean>>({})

const streamingContent = computed(() => {
  if (!props.isStreaming) {
    return ''
  }
  const message = visibleMessages.value.find(item => item.id === props.streamingMessageId)
  return message?.content ?? ''
})

watch(
  () => props.isStreaming,
  (streaming) => {
    if (streamingTimer) {
      clearTimeout(streamingTimer)
      streamingTimer = null
    }
    streamingHtml.value = ''
    if (streaming && streamingContent.value) {
      streamingHtml.value = renderMarkdown(streamingContent.value)
    }
  },
)

// 流式期间节流渲染，避免每个 delta 都触发 mp-html 全量解析
watch(streamingContent, (content) => {
  if (streamingTimer) {
    clearTimeout(streamingTimer)
    streamingTimer = null
  }
  if (!content) {
    streamingHtml.value = ''
    return
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

function getHtml(message: LocalMessage, part?: 'summary' | 'details') {
  if (props.isStreaming && message.id === props.streamingMessageId) {
    return streamingHtml.value
  }
  const layers = messageLayers(message)
  const source = part === 'details' ? layers.details : (part === 'summary' ? layers.summary : message.content)
  const cacheKey = `${message.id}:${part || 'full'}:${(source || '').length}`
  if (!htmlCache[cacheKey]) {
    htmlCache[cacheKey] = renderMarkdown(source)
  }
  return htmlCache[cacheKey]
}

function messageLayers(message: LocalMessage) {
  if (props.isStreaming && message.id === props.streamingMessageId) {
    return { summary: message.content, details: '', collapsible: false }
  }
  const index = visibleMessages.value.findIndex(item => item.id === message.id)
  return splitAnswerLayers(message.content || '', {
    forceExpand: isSourceInquiry(previousUserText(visibleMessages.value, index)),
  })
}

function expandDetails(messageId: string) {
  expandedDetails[messageId] = true
}

function hasStructuredContent(message: LocalMessage) {
  return Boolean(message.comparison || message.products?.length)
}

/** 思考中且尚无正文时不渲染空气泡，只保留下方「正在思考」 */
function hasAnswerBubble(message: LocalMessage) {
  if (hasStructuredContent(message)) {
    return true
  }
  if (props.isStreaming && message.id === props.streamingMessageId) {
    return Boolean(streamingHtml.value.trim())
  }
  return Boolean(message.content?.trim())
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
    // success: () => toastInfo('已复制'),
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

function messageAttachments(message: LocalMessage) {
  return message.attachments?.filter(item => item.attachmentType === 'IMAGE' || item.file?.mimeType?.startsWith('image/')) || []
}

function userText(message: LocalMessage) {
  const content = message.content?.trim() || ''
  if (content === CHAT_IMAGE_ONLY_CONTENT && messageAttachments(message).length) {
    return ''
  }
  return message.content
}

function attachmentPreview(item: MessageAttachment) {
  return item.previewUrl || ''
}

async function previewAttachments(message: LocalMessage, current: MessageAttachment) {
  const images = messageAttachments(message)
  await Promise.all(images.filter(item => item.fileId && !item.previewUrl).map(async (item) => {
    try {
      const response = await fileApi.getDownloadUrl(item.fileId).send() as ApiEnvelope<DownloadUrlResult>
      if (response.data?.url) {
        item.previewUrl = response.data.url
      }
    }
    catch {
      // 单张预览失败不阻断其余图片
    }
  }))
  const urls = images.map(item => item.previewUrl).filter((url): url is string => Boolean(url))
  if (!urls.length) {
    toastInfo('图片暂无法预览')
    return
  }
  uni.previewImage({
    urls,
    current: current.previewUrl || urls[0],
  })
}

function isVisionFailure(message: LocalMessage) {
  if (message.status !== 'FAILED') {
    return false
  }
  const text = message.errorMessage || ''
  return text.includes('图片识别') || text.includes('视觉') || text === VISION_FAILURE_MESSAGE
}

function failureText(message: LocalMessage) {
  if (isVisionFailure(message)) {
    return VISION_FAILURE_MESSAGE
  }
  return message.errorMessage || '生成失败'
}

function messageSources(message: LocalMessage) {
  if (!message.comparison) {
    return message.sources || []
  }
  const extra = message.comparison.sources
    .filter(item => !item.source)
    .map(item => ({ title: item.label, sectionTitle: item.typeLabel }))
  const fromComparison = message.comparison.sources
    .map(item => item.source)
    .filter((item): item is AiSourceRef => Boolean(item))
  return [...(message.sources || []), ...fromComparison, ...extra]
}

function expandSources(message: LocalMessage) {
  const index = visibleMessages.value.findIndex(item => item.id === message.id)
  return isSourceInquiry(previousUserText(visibleMessages.value, index))
}
</script>

<template>
  <view class="pb-5 pt-4 space-y-5">
    <view
      v-for="message in visibleMessages"
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
        <!-- 用户消息：图片缩略图 + 文字 -->
        <view
          v-if="isUser(message)"
          class="ai-message__user inline-block max-w-full rounded-3 px-3.5 py-3 text-3.5 leading-5"
        >
          <view v-if="messageAttachments(message).length" class="ai-message__thumbs">
            <image
              v-for="item in messageAttachments(message)"
              :key="item.fileId || item.id"
              class="ai-message__thumb"
              :src="attachmentPreview(item)"
              mode="aspectFill"
              @click.stop="previewAttachments(message, item)"
            />
          </view>
          <text v-if="userText(message)" class="whitespace-pre-wrap break-words" :class="messageAttachments(message).length ? 'mt-2 block' : ''">
            {{ userText(message) }}
          </text>
        </view>

        <!-- AI 消息：思考中无正文时隐藏气泡，避免空对话框 -->
        <view
          v-else-if="hasAnswerBubble(message)"
          class="ai-message__answer app-panel-flat px-3.5 py-3"
        >
          <AiProductCard
            v-if="message.products?.length && !message.comparison"
            :products="message.products"
          />
          <AiComparisonCard
            v-if="message.comparison"
            :comparison="message.comparison"
            :explanation="message.content"
          />
          <template v-else-if="getHtml(message, 'summary')">
            <mp-html
              :content="getHtml(message, 'summary')"
              :tag-style="markdownTagStyle"
              scroll-table
              preview-img
              container-style="font-size: 28rpx; line-height: 1.7; overflow-wrap: break-word; word-break: break-word;"
            />
            <view
              v-if="messageLayers(message).collapsible && !expandedDetails[message.id]"
              class="app-primary-text mt-1.5 text-2.5"
              @click="expandDetails(message.id)"
            >
              查看详细说明
            </view>
            <mp-html
              v-else-if="expandedDetails[message.id] && getHtml(message, 'details')"
              class="mt-2"
              :content="getHtml(message, 'details')"
              :tag-style="markdownTagStyle"
              scroll-table
              preview-img
              container-style="font-size: 28rpx; line-height: 1.7; overflow-wrap: break-word; word-break: break-word;"
            />
          </template>
        </view>

        <!-- AI 回答的辅助信息区 -->
        <template v-if="!isUser(message)">
          <AiAgentStatus
            v-if="message.id === streamingMessageId && isStreaming"
            :current-message="progressMessage || '正在整理结果…'"
            :class="hasAnswerBubble(message) ? 'mt-1.5' : ''"
          />

          <view v-else-if="message.status === 'STOPPED'" class="app-tertiary mt-1.5 text-2.5">
            已停止生成
          </view>

          <view
            v-else-if="message.status === 'FAILED'"
            class="app-danger-text mt-1.5 flex items-center gap-1 text-2.5"
            @click="isVisionFailure(message) ? emit('resend', message.id) : emit('regenerate', message.id)"
          >
            <wd-icon name="warning" size="26rpx" />
            <text>
              {{ failureText(message) }}{{ isVisionFailure(message) ? ' 点击重新发送' : '，点击重试' }}
            </text>
          </view>

          <AiSourceCard
            v-if="message.status === 'COMPLETED' && messageSources(message).length"
            :sources="messageSources(message)"
            :default-expanded="expandSources(message)"
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

.ai-message__thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
}

.ai-message__thumb {
  width: 144rpx;
  height: 144rpx;
  border-radius: 12rpx;
  background: rgb(255 255 255 / 18%);
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

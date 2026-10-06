<script setup lang="ts">
import type {
  AiMessageFeedback,
  AiRetrievalLog,
  ConversationDetail,
  ConversationDetailMessage,
} from '@/types/ai'
import type { AiSourceLocatorQuery } from '@/types/ai-source'
import type { AppStatus } from '@/components/ui/AppStatusTag.vue'
import { computed, onUnmounted, ref, watch } from 'vue'
import { fetchConversationDetail } from '@/api/modules/ai'
import KnowledgeSourceReader from '@/components/business/KnowledgeSourceReader.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppErrorState from '@/components/ui/AppErrorState.vue'
import AppMarkdown from '@/components/ui/AppMarkdown.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { normalizeAiSource, resolveAiSourceLocator } from '@/types/ai-source'
import {
  getAiClientAppLabel,
  getAiFeedbackReactionLabel,
  getAiMessageRoleLabel,
  getAiMessageStatusLabel,
  getAiReasoningModeLabel,
  getAiSceneLabel,
} from '@/utils/ai'
import { formatDate } from '@/utils/day'
import { getReportTypeLabel, reportStateMeta } from '@/utils/report'

const props = defineProps<{
  conversationId: string | null
  title?: string | null
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [visible: boolean]
}>()

const detail = ref<ConversationDetail | null>(null)
const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const error = ref<unknown>(null)
const readerVisible = ref(false)
const readerLocator = ref<AiSourceLocatorQuery | null>(null)

let activeController: AbortController | null = null
let requestSequence = 0

const headerTitle = computed(() => {
  const currentTitle = detail.value?.conversation.title || props.title
  return currentTitle ? `对话详情 · ${currentTitle}` : '对话详情'
})

const errorDescription = computed(() => error.value
  ? normalizeFeedbackError(error.value).message
  : '请检查网络连接后重试')

function abortActive(): void {
  activeController?.abort()
  activeController = null
}

async function load(id: string): Promise<void> {
  abortActive()
  const sequence = ++requestSequence
  const controller = new AbortController()
  activeController = controller
  status.value = 'loading'
  error.value = null
  try {
    const result = await fetchConversationDetail(id, controller.signal)
    if (sequence !== requestSequence || controller.signal.aborted) {
      return
    }
    detail.value = result
    status.value = 'ready'
  }
  catch (cause) {
    if (sequence !== requestSequence || controller.signal.aborted) {
      return
    }
    detail.value = null
    error.value = cause
    status.value = 'error'
  }
}

watch(
  () => ({ visible: props.visible, id: props.conversationId }),
  ({ visible, id }) => {
    readerVisible.value = false
    readerLocator.value = null
    if (!visible || !id) {
      abortActive()
      return
    }
    void load(id)
  },
)

onUnmounted(() => {
  abortActive()
})

function close(): void {
  abortActive()
  emit('update:visible', false)
}

function retry(): void {
  if (props.conversationId) {
    void load(props.conversationId)
  }
}

function messageRoleStatus(role: ConversationDetailMessage['role']): AppStatus {
  if (role === 'USER') {
    return 'warning'
  }
  if (role === 'ASSISTANT') {
    return 'info'
  }
  return 'default'
}

function messageStatus(message: ConversationDetailMessage): AppStatus {
  const statusMap: Record<string, AppStatus> = {
    COMPLETED: 'success',
    FAILED: 'error',
    PENDING: 'default',
    STOPPED: 'warning',
    STREAMING: 'processing',
  }
  return statusMap[message.status] ?? 'default'
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null || durationMs === undefined) {
    return '-'
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`
  }
  return `${(durationMs / 1000).toFixed(1)}s`
}

function retrievalKey(item: AiRetrievalLog): string {
  return `${item.messageId ?? ''}:${item.sourceTitle ?? ''}:${item.sourcePage ?? ''}`
}

function retrievalLocator(item: AiRetrievalLog): AiSourceLocatorQuery | null {
  const source = normalizeAiSource({
    title: item.sourceTitle ?? '未知来源',
    documentId: item.documentId ?? undefined,
    chunkId: item.chunkId ?? undefined,
    sourcePage: item.sourcePage,
    score: item.score,
  })
  return source ? resolveAiSourceLocator(source) : null
}

function retrievalsForMessage(messageId: string): AiRetrievalLog[] {
  return detail.value?.retrievals.filter(item => item.messageId === messageId) ?? []
}

function feedbackForMessage(messageId: string): AiMessageFeedback[] {
  return detail.value?.feedbacks.filter(item => item.messageId === messageId) ?? []
}

function openRetrievalReader(item: AiRetrievalLog): void {
  const locator = retrievalLocator(item)
  if (!locator) {
    return
  }
  readerLocator.value = locator
  readerVisible.value = true
}
</script>

<template>
  <t-drawer
    attach="body"
    :footer="false"
    :header="headerTitle"
    placement="right"
    :prevent-scroll-through="true"
    size="min(720px, 96vw)"
    :visible="visible"
    @close="close"
  >
    <div v-if="status === 'loading'" class="conversation-detail__state">
      <t-loading size="medium" text="正在加载对话详情" />
    </div>

    <AppErrorState
      v-else-if="status === 'error'"
      :description="errorDescription"
      title="对话详情加载失败"
      @action="retry"
    />

    <template v-else-if="detail">
      <section class="conversation-detail__section">
        <t-descriptions bordered :column="2" size="small">
          <t-descriptions-item label="会话标题">
            {{ detail.conversation.title || '未命名会话' }}
          </t-descriptions-item>
          <t-descriptions-item label="场景">
            {{ getAiSceneLabel(detail.conversation.scene) }}
          </t-descriptions-item>
          <t-descriptions-item label="推理模式">
            {{ getAiReasoningModeLabel(detail.conversation.reasoningMode) }}
          </t-descriptions-item>
          <t-descriptions-item label="客户端">
            {{ getAiClientAppLabel(detail.conversation.clientApp) }}
          </t-descriptions-item>
          <t-descriptions-item label="消息数">
            {{ detail.messages.length }}
          </t-descriptions-item>
          <t-descriptions-item label="更新时间">
            {{ formatDate(new Date(detail.conversation.updatedAt)) }}
          </t-descriptions-item>
        </t-descriptions>
      </section>

      <section class="conversation-detail__section">
        <h3 class="conversation-detail__heading">
          消息记录
        </h3>
        <p class="conversation-detail__note">
          {{ detail.processingSummary.note }}
        </p>
        <div v-if="detail.messages.length === 0" class="conversation-detail__empty">
          <AppEmptyState description="该会话尚未产生消息" title="暂无消息" />
        </div>
        <div v-else class="conversation-detail__messages">
          <article
            v-for="message in detail.messages"
            :key="message.id"
            class="conversation-detail__message"
          >
            <header class="conversation-detail__message-head">
              <AppStatusTag
                :label="getAiMessageRoleLabel(message.role)"
                :status="messageRoleStatus(message.role)"
              />
              <AppStatusTag
                :label="getAiMessageStatusLabel(message.status)"
                :status="messageStatus(message)"
              />
              <span v-if="message.model" class="conversation-detail__muted">
                {{ message.model }}
              </span>
              <span class="conversation-detail__muted">
                {{ formatDate(new Date(message.createdAt)) }}
              </span>
            </header>

            <AppMarkdown
              v-if="message.role === 'ASSISTANT'"
              :content="message.content"
            />
            <pre v-else class="conversation-detail__content">{{ message.content || ' ' }}</pre>

            <div v-if="message.attachments.length" class="conversation-detail__attachments">
              <span
                v-for="attachment in message.attachments"
                :key="attachment.id"
                class="conversation-detail__attachment"
              >
                {{ attachment.file.originalName }}
              </span>
            </div>

            <div class="conversation-detail__meta">
              耗时 {{ formatDuration(message.durationMs) }}
              <template v-if="message.stopReason">
                · 停止原因 {{ message.stopReason }}
              </template>
            </div>

            <template v-if="retrievalsForMessage(message.id).length">
              <div class="conversation-detail__sub">
                <h4 class="conversation-detail__sub-title">
                  知识检索
                </h4>
                <div
                  v-for="retrieval in retrievalsForMessage(message.id)"
                  :key="retrievalKey(retrieval)"
                  class="conversation-detail__sub-item"
                >
                  <span>{{ retrieval.sourceTitle ?? '未知来源' }}</span>
                  <span v-if="retrieval.sourcePage !== null" class="conversation-detail__muted">
                    第 {{ retrieval.sourcePage }} 页
                  </span>
                  <span
                    v-if="retrievalLocator(retrieval)"
                    class="conversation-detail__link"
                    role="button"
                    tabindex="0"
                    @click="openRetrievalReader(retrieval)"
                    @keydown.enter="openRetrievalReader(retrieval)"
                  >
                    查看原文
                  </span>
                </div>
              </div>
            </template>

            <template v-if="feedbackForMessage(message.id).length">
              <div class="conversation-detail__sub">
                <h4 class="conversation-detail__sub-title">
                  用户反馈
                </h4>
                <div
                  v-for="feedback in feedbackForMessage(message.id)"
                  :key="feedback.id"
                  class="conversation-detail__sub-item"
                >
                  <AppStatusTag
                    :label="getAiFeedbackReactionLabel(feedback.reaction ?? '')"
                    :status="feedback.reaction === 'LIKE' ? 'success' : 'warning'"
                  />
                  <span>{{ feedback.content || '（无文本反馈）' }}</span>
                </div>
              </div>
            </template>
          </article>
        </div>
      </section>

      <section v-if="detail.reports.length" class="conversation-detail__section">
        <h3 class="conversation-detail__heading">
          关联报告
        </h3>
        <div
          v-for="report in detail.reports"
          :key="report.id"
          class="conversation-detail__sub-item"
        >
          <span>{{ getReportTypeLabel(report.reportType) }}</span>
          <AppStatusTag
            :label="reportStateMeta(report).label"
            :status="reportStateMeta(report).status"
          />
          <span class="conversation-detail__muted">
            {{ formatDate(new Date(report.createdAt)) }}
          </span>
        </div>
      </section>
    </template>
  </t-drawer>

  <t-drawer
    v-model:visible="readerVisible"
    attach="body"
    header="原文阅读"
    placement="right"
    :prevent-scroll-through="true"
    size="min(760px, 96vw)"
    :footer="false"
  >
    <KnowledgeSourceReader v-if="readerLocator && readerVisible" :locator="readerLocator" />
  </t-drawer>
</template>

<style scoped>
.conversation-detail__state,
.conversation-detail__empty {
  display: grid;
  min-height: 240px;
  place-content: center;
}

.conversation-detail__section + .conversation-detail__section {
  margin-top: var(--td-size-5);
}

.conversation-detail__heading {
  margin: 0 0 var(--td-size-3);
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
  font-weight: 600;
}

.conversation-detail__note {
  margin: 0 0 var(--td-size-3);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.conversation-detail__messages {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-4);
}

.conversation-detail__message {
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-m);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
}

.conversation-detail__message-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-2);
  margin-bottom: var(--td-size-3);
}

.conversation-detail__content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: var(--td-font-size-body-medium);
  line-height: var(--td-line-height-body-medium);
}

.conversation-detail__attachments {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-size-2);
  margin-top: var(--td-size-3);
}

.conversation-detail__attachment {
  padding: 0 var(--td-size-2);
  color: var(--td-text-color-secondary);
  background: var(--td-bg-color-secondarycontainer);
  border-radius: var(--td-radius-small);
  font-size: var(--td-font-size-body-small);
}

.conversation-detail__meta,
.conversation-detail__muted {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.conversation-detail__meta {
  margin-top: var(--td-size-3);
}

.conversation-detail__sub {
  margin-top: var(--td-size-3);
  padding-top: var(--td-size-3);
  border-top: 1px dashed var(--td-component-border);
}

.conversation-detail__sub-title {
  margin: 0 0 var(--td-size-2);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  font-weight: 600;
}

.conversation-detail__sub-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-2);
  font-size: var(--td-font-size-body-small);
}

.conversation-detail__sub-item + .conversation-detail__sub-item {
  margin-top: var(--td-size-2);
}

.conversation-detail__link {
  color: var(--td-brand-color);
  cursor: pointer;
  white-space: nowrap;
}
</style>

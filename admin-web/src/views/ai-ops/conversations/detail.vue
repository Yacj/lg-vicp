<script setup lang="ts">
import type {
  AiMessage,
  AiMessageFeedback,
  AiMessageRegeneration,
  AiRetrievalLog,
  AiToolCall,
  ConversationOpsDetail,
} from '@/types/ai'
import type { AiSourceLocatorQuery } from '@/types/ai-source'
import { ArrowLeftIcon } from 'tdesign-icons-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { fetchPlatformConversationDetail } from '@/api/modules/ai'
import KnowledgeSourceReader from '@/components/business/KnowledgeSourceReader.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppMarkdown from '@/components/ui/AppMarkdown.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { normalizeAiSource, resolveAiSourceLocator } from '@/types/ai-source'
import {
  getAiClientAppLabel,
  getAiFeedbackReactionLabel,
  getAiMessageRoleLabel,
  getAiReasoningModeLabel,
  getAiSceneLabel,
} from '@/utils/ai'
import { formatDate } from '@/utils/day'
import {
  messageMetricsText,
  projectConversationThread,
  speechAlign,
} from './conversation-thread'

defineOptions({ name: 'AiOpsConversationDetail' })

const route = useRoute()
const router = useRouter()
const conversationId = String(route.params.id)
const titleFromQuery = String(route.query.title ?? '')

const detail = ref<ConversationOpsDetail | null>(null)
const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const error = ref<unknown>(null)

async function load(): Promise<void> {
  status.value = 'loading'
  error.value = null
  try {
    detail.value = await fetchPlatformConversationDetail(conversationId)
    status.value = 'ready'
  }
  catch (cause) {
    error.value = cause
    status.value = 'error'
  }
}

onMounted(() => {
  void load()
})

const errorDescription = computed(() => error.value
  ? normalizeFeedbackError(error.value).message
  : '请检查网络连接后重试')

const pageTitle = computed(() => detail.value?.conversation.title || titleFromQuery || '会话运营详情')

function goBack(): void {
  console.log(window.history.state?.back)
  // if (window.history.state?.back) {
  //   console.log('goBack back')
  //   router.back()
  // }
  // else {
  //   console.log('goBack')
  //   void router.push('/ai-ops/conversations')
  // }
  void router.push('/ai-ops/conversations')
}

const threadItems = computed(() => {
  if (!detail.value) {
    return []
  }
  return projectConversationThread(detail.value.messages, detail.value.auditLogs)
})

/** 检索记录去重键（消息 + 来源标题 + 页码）。 */
function retrievalKey(item: AiRetrievalLog): string {
  return `${item.messageId ?? ''}:${item.sourceTitle ?? ''}:${item.sourcePage ?? ''}`
}

/** 检索记录 → 统一来源定位入口（chunkId/文档级），无定位信息时返回 null */
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

// ===== 原文阅读（Wiki 阅读器） =====

const readerVisible = ref(false)
const readerLocator = ref<AiSourceLocatorQuery | null>(null)

function openRetrievalReader(item: AiRetrievalLog): void {
  const locator = retrievalLocator(item)
  if (!locator) {
    return
  }
  readerLocator.value = locator
  readerVisible.value = true
}

/** 从全局检索记录中挑出属于指定消息的条目。 */
function retrievalsForMessage(messageId: string): AiRetrievalLog[] {
  return detail.value?.retrievals.filter(item => item.messageId === messageId) ?? []
}

function toolCallsForMessage(messageId: string): AiToolCall[] {
  return detail.value?.toolCalls.filter(item => item.messageId === messageId) ?? []
}

function feedbackForMessage(messageId: string): AiMessageFeedback[] {
  return detail.value?.feedbacks.filter(item => item.messageId === messageId) ?? []
}

function regenerationsForMessage(messageId: string): AiMessageRegeneration[] {
  return detail.value?.regenerations.filter(item => item.originalMessageId === messageId) ?? []
}

function hasOpsRail(message: AiMessage): boolean {
  return Boolean(messageMetricsText(message))
    || retrievalsForMessage(message.id).length > 0
    || toolCallsForMessage(message.id).length > 0
    || feedbackForMessage(message.id).length > 0
    || regenerationsForMessage(message.id).length > 0
}
</script>

<template>
  <AppPage>
    <template #navigation>
      <t-button theme="default" variant="outline" @click="goBack">
        <template #icon>
          <ArrowLeftIcon />
        </template>
        返回会话列表
      </t-button>
    </template>

    <div v-if="status === 'loading'" class="ai-ops-detail__loading">
      <t-loading text="正在加载会话详情..." />
    </div>

    <div v-else-if="status === 'error'" class="ai-ops-detail__error">
      <t-alert theme="error" :title="errorDescription" />
      <t-button class="ai-ops-detail__retry" theme="primary" @click="load">
        重新加载
      </t-button>
    </div>

    <template v-else-if="detail">
      <div class="ai-ops-detail__header">
        <h2 class="ai-ops-detail__title">
          {{ pageTitle }}
        </h2>
        <div class="ai-ops-detail__header-actions">
          <AppStatusTag
            :label="detail.conversation.status === 'active' ? '正常' : '已删除'"
            :status="detail.conversation.status === 'active' ? 'success' : 'disabled'"
          />
        </div>
      </div>

      <t-card class="ai-ops-detail__card" title="会话信息" :bordered="false">
        <t-descriptions bordered :column="4" size="medium">
          <t-descriptions-item label="用户">
            {{ detail.user.displayName }}
            <span class="ai-ops-detail__muted">{{ detail.user.phone ?? '' }}</span>
          </t-descriptions-item>
          <t-descriptions-item label="用户角色">
            {{ detail.user.role }}
          </t-descriptions-item>
          <t-descriptions-item label="渠道">
            {{ detail.user.channelType ?? '-' }}
          </t-descriptions-item>
          <t-descriptions-item label="项目">
            {{ detail.project?.name ?? '-' }}
          </t-descriptions-item>
          <t-descriptions-item label="场景">
            {{ getAiSceneLabel(detail.conversation.scene) }}
          </t-descriptions-item>
          <t-descriptions-item label="客户端">
            {{ getAiClientAppLabel(detail.conversation.clientApp) }}
          </t-descriptions-item>
          <t-descriptions-item label="推理模式">
            {{ getAiReasoningModeLabel(detail.conversation.reasoningMode) }}
          </t-descriptions-item>
          <t-descriptions-item label="创建时间">
            {{ formatDate(new Date(detail.conversation.createdAt)) }}
          </t-descriptions-item>
        </t-descriptions>
      </t-card>

      <t-card class="ai-ops-detail__card" title="消息记录" :bordered="false">
        <div v-if="detail.messages.length === 0" class="ai-ops-detail__empty-block">
          <AppEmptyState description="该会话暂无消息" title="暂无消息" />
        </div>
        <div v-else class="ai-ops-detail__thread">
          <template v-for="item in threadItems" :key="item.id">
            <div
              v-if="item.kind === 'speech'"
              class="ai-ops-detail__row"
              :class="`ai-ops-detail__row--${speechAlign(item.message.role)}`"
            >
              <div class="ai-ops-detail__stack">
                <div
                  class="ai-ops-detail__bubble"
                  :class="`ai-ops-detail__bubble--${speechAlign(item.message.role)}`"
                >
                  <AppMarkdown
                    v-if="item.message.role === 'ASSISTANT' && item.message.content"
                    :content="item.message.content"
                  />
                  <p
                    v-else-if="item.message.role === 'ASSISTANT'"
                    class="ai-ops-detail__placeholder"
                  >
                    （无回复内容）
                  </p>
                  <pre v-else class="ai-ops-detail__content">{{ item.message.content || ' ' }}</pre>
                </div>

                <div class="ai-ops-detail__time">
                  <span v-if="item.message.model">
                    {{ item.message.provider }} / {{ item.message.model }}
                  </span>
                  <span>{{ formatDate(new Date(item.message.createdAt)) }}</span>
                </div>

                <div v-if="item.message.role === 'ASSISTANT' && hasOpsRail(item.message)" class="ai-ops-detail__rail">
                  <div v-if="messageMetricsText(item.message)" class="ai-ops-detail__rail-metrics">
                    {{ messageMetricsText(item.message) }}
                  </div>

                  <div v-if="retrievalsForMessage(item.message.id).length" class="ai-ops-detail__rail-block">
                    <span class="ai-ops-detail__rail-label">知识检索</span>
                    <div
                      v-for="retrieval in retrievalsForMessage(item.message.id)"
                      :key="retrievalKey(retrieval)"
                      class="ai-ops-detail__rail-item"
                    >
                      <span>{{ retrieval.sourceTitle ?? '未知来源' }}</span>
                      <span v-if="retrieval.sourcePage !== null" class="ai-ops-detail__muted">
                        第 {{ retrieval.sourcePage }} 页
                      </span>
                      <span v-if="retrieval.score !== null" class="ai-ops-detail__muted">
                        相似度 {{ retrieval.score.toFixed(2) }}
                      </span>
                      <span
                        v-if="retrievalLocator(retrieval)"
                        class="ai-ops-detail__reader-link"
                        role="button"
                        tabindex="0"
                        @click="openRetrievalReader(retrieval)"
                        @keydown.enter="openRetrievalReader(retrieval)"
                      >
                        查看原文
                      </span>
                    </div>
                  </div>

                  <div v-if="toolCallsForMessage(item.message.id).length" class="ai-ops-detail__rail-block">
                    <span class="ai-ops-detail__rail-label">工具调用</span>
                    <div
                      v-for="tool in toolCallsForMessage(item.message.id)"
                      :key="tool.id"
                      class="ai-ops-detail__rail-item"
                    >
                      <span class="ai-ops-detail__tool-name">{{ tool.toolName }}</span>
                      <AppStatusTag
                        :label="tool.success ? '成功' : '失败'"
                        :status="tool.success ? 'success' : 'error'"
                      />
                      <span v-if="tool.errorMessage" class="ai-ops-detail__muted">
                        {{ tool.errorMessage }}
                      </span>
                    </div>
                  </div>

                  <div v-if="feedbackForMessage(item.message.id).length" class="ai-ops-detail__rail-block">
                    <span class="ai-ops-detail__rail-label">用户反馈</span>
                    <div
                      v-for="feedback in feedbackForMessage(item.message.id)"
                      :key="feedback.id"
                      class="ai-ops-detail__rail-item"
                    >
                      <AppStatusTag
                        :label="getAiFeedbackReactionLabel(feedback.reaction ?? '')"
                        :status="feedback.reaction === 'LIKE' ? 'success' : 'warning'"
                      />
                      <span>{{ feedback.content || '（无文本反馈）' }}</span>
                      <span v-if="feedback.tags.length" class="ai-ops-detail__muted">
                        {{ feedback.tags.join('、') }}
                      </span>
                    </div>
                  </div>

                  <div v-if="regenerationsForMessage(item.message.id).length" class="ai-ops-detail__rail-block">
                    <span class="ai-ops-detail__rail-label">重新生成</span>
                    <div
                      v-for="regeneration in regenerationsForMessage(item.message.id)"
                      :key="regeneration.id"
                      class="ai-ops-detail__rail-item"
                    >
                      <span>{{ formatDate(new Date(regeneration.createdAt)) }}</span>
                      <span v-if="regeneration.reason" class="ai-ops-detail__muted">
                        原因：{{ regeneration.reason }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-else-if="item.kind === 'notice'" class="ai-ops-detail__notice">
              <span class="ai-ops-detail__notice-role">{{ getAiMessageRoleLabel(item.message.role) }}</span>
              <span>{{ item.message.content || ' ' }}</span>
            </div>

            <div
              v-else-if="item.kind === 'event'"
              class="ai-ops-detail__event"
              :class="`ai-ops-detail__event--${item.align}`"
            >
              <AppStatusTag :label="item.label" :status="item.tone" />
              <span v-if="item.detail" class="ai-ops-detail__muted">{{ item.detail }}</span>
              <span class="ai-ops-detail__muted">{{ formatDate(new Date(item.time)) }}</span>
            </div>
          </template>
        </div>
      </t-card>

      <t-card v-if="detail.reports.length" class="ai-ops-detail__card" title="关联报告" :bordered="false">
        <div class="ai-ops-detail__sub-list">
          <div v-for="report in detail.reports" :key="report.id" class="ai-ops-detail__sub-item">
            <span>{{ report.reportType }}</span>
            <AppStatusTag
              :label="report.status"
              :status="report.status === 'READY' ? 'success' : report.status === 'FAILED' ? 'error' : 'warning'"
            />
            <span v-if="report.errorMessage" class="ai-ops-detail__muted">
              {{ report.errorMessage }}
            </span>
            <span class="ai-ops-detail__muted">{{ formatDate(new Date(report.createdAt)) }}</span>
          </div>
        </div>
      </t-card>

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
  </AppPage>
</template>

<style scoped>
.ai-ops-detail__loading,
.ai-ops-detail__error {
  display: flex;
  min-height: 320px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: var(--td-size-4);
}

.ai-ops-detail__retry {
  margin-top: var(--td-size-4);
}

.ai-ops-detail__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-4);
  margin-bottom: var(--td-size-5);
}

.ai-ops-detail__title {
  margin: 0;
  font-size: var(--td-font-size-title-large);
  font-weight: 600;
}

.ai-ops-detail__card {
  margin-bottom: var(--td-size-5);
  border: 1px solid var(--td-component-border);
}

.ai-ops-detail__empty-block {
  display: grid;
  min-height: 200px;
  place-content: center;
}

.ai-ops-detail__thread {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-4);
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
  background: var(--td-bg-color-secondarycontainer);
  border-radius: var(--td-radius-medium);
}

.ai-ops-detail__row {
  display: flex;
}

.ai-ops-detail__row--user {
  justify-content: flex-end;
}

.ai-ops-detail__row--assistant {
  justify-content: flex-start;
}

.ai-ops-detail__stack {
  display: flex;
  max-width: 78%;
  min-width: 0;
  flex-direction: column;
}

.ai-ops-detail__row--assistant .ai-ops-detail__stack {
  max-width: 86%;
}

.ai-ops-detail__bubble {
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-m);
  border-radius: var(--td-radius-medium);
  word-break: break-word;
}

.ai-ops-detail__bubble--user {
  color: var(--td-text-color-primary);
  background: var(--td-brand-color-light);
}

.ai-ops-detail__bubble--assistant {
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
}

.ai-ops-detail__content,
.ai-ops-detail__placeholder {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: var(--td-font-size-body-medium);
  line-height: var(--td-line-height-body-medium);
}

.ai-ops-detail__placeholder {
  color: var(--td-text-color-placeholder);
}

.ai-ops-detail__time {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-size-2);
  margin-top: var(--td-size-1);
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}

.ai-ops-detail__row--user .ai-ops-detail__time {
  justify-content: flex-end;
}

.ai-ops-detail__rail {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-2);
  margin-top: var(--td-size-2);
  padding-top: var(--td-size-2);
  border-top: 1px dashed var(--td-component-border);
}

.ai-ops-detail__rail-metrics,
.ai-ops-detail__rail-label {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-ops-detail__rail-label {
  font-weight: 600;
}

.ai-ops-detail__rail-block {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-1);
}

.ai-ops-detail__rail-item,
.ai-ops-detail__sub-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-2);
  font-size: var(--td-font-size-body-small);
}

.ai-ops-detail__sub-list {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-2);
}

.ai-ops-detail__notice {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--td-size-2);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-ops-detail__notice-role {
  padding: 0 var(--td-size-2);
  color: var(--td-text-color-secondary);
  background: var(--td-bg-color-component);
  border-radius: var(--td-radius-small);
}

.ai-ops-detail__event {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-2);
  max-width: 78%;
  margin-top: calc(var(--td-size-2) * -1);
  font-size: var(--td-font-size-body-small);
}

.ai-ops-detail__event--user {
  margin-left: auto;
  justify-content: flex-end;
}

.ai-ops-detail__event--assistant {
  max-width: 86%;
  margin-right: auto;
  justify-content: flex-start;
}

.ai-ops-detail__tool-name {
  padding: 0 var(--td-size-1);
  font-family: var(--td-font-family-mono);
}

.ai-ops-detail__muted {
  color: var(--td-text-color-secondary);
}

.ai-ops-detail__reader-link {
  color: var(--td-brand-color);
  cursor: pointer;
  font-size: var(--td-font-size-body-small);
  white-space: nowrap;
}
</style>

<script setup lang="ts">
import type {
  AiAuditLog,
  AiMessage,
  AiMessageFeedback,
  AiMessageRegeneration,
  AiRetrievalLog,
  AiToolCall,
  ConversationOpsDetail,
} from '@/types/ai'
import { ArrowLeftIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { fetchPlatformConversationDetail } from '@/api/modules/ai'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import {
  getAiClientAppLabel,
  getAiFeedbackReactionLabel,
  getAiReasoningModeLabel,
  getAiSceneLabel,
} from '@/utils/ai'
import { formatDate } from '@/utils/day'

defineOptions({ name: 'AiOpsConversationDetail' })

const route = useRoute()
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
}

function messageStatusTag(message: AiMessage): ReturnType<typeof h> {
  const statusMap = {
    COMPLETED: { label: '已完成', status: 'success' as const },
    FAILED: { label: '失败', status: 'error' as const },
    PENDING: { label: '等待中', status: 'default' as const },
    STOPPED: { label: '已停止', status: 'warning' as const },
    STREAMING: { label: '生成中', status: 'processing' as const },
  }
  const meta = statusMap[message.status as keyof typeof statusMap] ?? { label: message.status, status: 'default' as const }
  return h(AppStatusTag, { label: meta.label, status: meta.status })
}

function messageRoleTag(message: AiMessage): ReturnType<typeof h> {
  const roleMap = {
    ASSISTANT: { label: '助手', theme: 'primary' as const },
    USER: { label: '用户', theme: 'warning' as const },
    SYSTEM: { label: '系统', theme: 'info' as const },
    TOOL: { label: '工具', theme: 'default' as const },
  }
  const meta = roleMap[message.role as keyof typeof roleMap] ?? { label: message.role, theme: 'default' as const }
  return h('span', { class: `ai-ops-detail__role ai-ops-detail__role--${meta.theme}` }, meta.label)
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

/** 检索记录去重键（消息 + 来源标题 + 页码）。 */
function retrievalKey(item: AiRetrievalLog): string {
  return `${item.messageId ?? ''}:${item.sourceTitle ?? ''}:${item.sourcePage ?? ''}`
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

function auditLogsForMessage(messageId: string): AiAuditLog[] {
  return detail.value?.auditLogs.filter(item => item.targetId === messageId) ?? []
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
        <p class="ai-ops-detail__note">
          {{ detail.processingSummary.note }}
        </p>
        <div v-if="detail.messages.length === 0" class="ai-ops-detail__empty-block">
          <AppEmptyState description="该会话暂无消息" title="暂无消息" />
        </div>
        <div v-else class="ai-ops-detail__messages">
          <div
            v-for="message in detail.messages"
            :key="message.id"
            class="ai-ops-detail__message"
          >
            <div class="ai-ops-detail__message-head">
              {{ messageRoleTag(message) }}
              <span class="ai-ops-detail__message-meta">
                {{ messageStatusTag(message) }}
              </span>
              <span v-if="message.model" class="ai-ops-detail__message-meta">
                {{ message.provider }} / {{ message.model }}
              </span>
              <span class="ai-ops-detail__message-meta">
                {{ formatDate(new Date(message.createdAt)) }}
              </span>
            </div>

            <div class="ai-ops-detail__message-body">
              <pre class="ai-ops-detail__content">{{ message.content || ' ' }}</pre>
            </div>

            <div v-if="message.status === 'FAILED' && message.errorMessage" class="ai-ops-detail__exception">
              <t-alert theme="error" title="生成异常">
                {{ message.errorMessage }}
              </t-alert>
            </div>

            <div v-if="message.stopReason" class="ai-ops-detail__meta-row">
              停止原因：{{ message.stopReason }}
            </div>
            <div class="ai-ops-detail__meta-row">
              耗时 {{ formatDuration(message.durationMs) }}
              <template v-if="message.tokenInput !== null || message.tokenOutput !== null">
                · 输入 {{ message.tokenInput ?? '-' }} / 输出 {{ message.tokenOutput ?? '-' }}
                <template v-if="message.reasoningTokens !== null">
                  / 推理 {{ message.reasoningTokens }}
                </template>
              </template>
              <template v-if="message.promptTemplateVersion !== null">
                · 提示词版本 v{{ message.promptTemplateVersion }}
              </template>
              <template v-if="message.requestId">
                · requestId {{ message.requestId }}
              </template>
            </div>

            <template v-if="retrievalsForMessage(message.id).length">
              <div class="ai-ops-detail__sub-block">
                <h4 class="ai-ops-detail__sub-title">
                  知识检索
                </h4>
                <div class="ai-ops-detail__sub-list">
                  <div
                    v-for="retrieval in retrievalsForMessage(message.id)"
                    :key="retrievalKey(retrieval)"
                    class="ai-ops-detail__sub-item"
                  >
                    <span>{{ retrieval.sourceTitle ?? '未知来源' }}</span>
                    <template v-if="retrieval.sourcePage !== null">
                      <span class="ai-ops-detail__muted">第 {{ retrieval.sourcePage }} 页</span>
                    </template>
                    <template v-if="retrieval.score !== null">
                      <span class="ai-ops-detail__muted">相似度 {{ retrieval.score.toFixed(2) }}</span>
                    </template>
                  </div>
                </div>
              </div>
            </template>

            <template v-if="toolCallsForMessage(message.id).length">
              <div class="ai-ops-detail__sub-block">
                <h4 class="ai-ops-detail__sub-title">
                  工具调用
                </h4>
                <div class="ai-ops-detail__sub-list">
                  <div
                    v-for="tool in toolCallsForMessage(message.id)"
                    :key="tool.id"
                    class="ai-ops-detail__sub-item"
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
              </div>
            </template>

            <template v-if="feedbackForMessage(message.id).length">
              <div class="ai-ops-detail__sub-block">
                <h4 class="ai-ops-detail__sub-title">
                  用户反馈
                </h4>
                <div class="ai-ops-detail__sub-list">
                  <div
                    v-for="feedback in feedbackForMessage(message.id)"
                    :key="feedback.id"
                    class="ai-ops-detail__sub-item"
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
              </div>
            </template>

            <template v-if="regenerationsForMessage(message.id).length">
              <div class="ai-ops-detail__sub-block">
                <h4 class="ai-ops-detail__sub-title">
                  重新生成
                </h4>
                <div class="ai-ops-detail__sub-list">
                  <div
                    v-for="regeneration in regenerationsForMessage(message.id)"
                    :key="regeneration.id"
                    class="ai-ops-detail__sub-item"
                  >
                    <span>{{ formatDate(new Date(regeneration.createdAt)) }}</span>
                    <span v-if="regeneration.reason" class="ai-ops-detail__muted">
                      原因：{{ regeneration.reason }}
                    </span>
                  </div>
                </div>
              </div>
            </template>

            <template v-if="auditLogsForMessage(message.id).length">
              <div class="ai-ops-detail__sub-block">
                <h4 class="ai-ops-detail__sub-title">
                  审计记录
                </h4>
                <div class="ai-ops-detail__sub-list">
                  <div
                    v-for="log in auditLogsForMessage(message.id)"
                    :key="log.id"
                    class="ai-ops-detail__sub-item"
                  >
                    <span class="ai-ops-detail__tool-name">{{ log.action }}</span>
                    <span class="ai-ops-detail__muted">{{ formatDate(new Date(log.createdAt)) }}</span>
                  </div>
                </div>
              </div>
            </template>
          </div>
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

.ai-ops-detail__note {
  margin: 0 0 var(--td-size-4);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-ops-detail__empty-block {
  display: grid;
  min-height: 200px;
  place-content: center;
}

.ai-ops-detail__messages {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-5);
}

.ai-ops-detail__message {
  padding: var(--td-size-4);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
}

.ai-ops-detail__message-head {
  display: flex;
  align-items: center;
  gap: var(--td-size-3);
  margin-bottom: var(--td-size-3);
}

.ai-ops-detail__role {
  padding: 2px var(--td-size-2);
  border-radius: var(--td-radius-small);
  font-size: var(--td-font-size-body-small);
  font-weight: 500;
}

.ai-ops-detail__role--primary {
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
}

.ai-ops-detail__role--warning {
  color: var(--td-warning-color);
  background: var(--td-warning-color-light);
}

.ai-ops-detail__role--info {
  color: var(--td-info-color);
  background: var(--td-info-color-light);
}

.ai-ops-detail__role--default {
  color: var(--td-text-color-secondary);
  background: var(--td-bg-color-component);
}

.ai-ops-detail__message-meta {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-ops-detail__message-body {
  margin-bottom: var(--td-size-3);
}

.ai-ops-detail__content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: var(--td-font-size-body-medium);
  line-height: var(--td-line-height-body-medium);
}

.ai-ops-detail__exception {
  margin-bottom: var(--td-size-3);
}

.ai-ops-detail__meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-size-3);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-ops-detail__sub-block {
  margin-top: var(--td-size-3);
  padding-top: var(--td-size-3);
  border-top: 1px dashed var(--td-component-border);
}

.ai-ops-detail__sub-title {
  margin: 0 0 var(--td-size-2);
  font-size: var(--td-font-size-body-small);
  font-weight: 600;
  color: var(--td-text-color-secondary);
}

.ai-ops-detail__sub-list {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-2);
}

.ai-ops-detail__sub-item {
  display: flex;
  align-items: center;
  gap: var(--td-size-3);
  font-size: var(--td-font-size-body-small);
}

.ai-ops-detail__tool-name {
  padding: 0 var(--td-size-1);
  font-family: var(--td-font-family-mono);
}

.ai-ops-detail__muted {
  color: var(--td-text-color-secondary);
}
</style>

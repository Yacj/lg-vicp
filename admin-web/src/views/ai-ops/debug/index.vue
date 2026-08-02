<script setup lang="ts">
import type { AiDebugMessageRole } from '@/types/ai'
import { useBreakpoints } from '@vueuse/core'
import { DeleteIcon, SendIcon } from 'tdesign-icons-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useAiDebugger } from '@/composables/useAiDebugger'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { AI_SCENE_OPTIONS, getAiSceneLabel, renderMarkdown } from '@/utils/ai'
import { formatDate } from '@/utils/day'

const {
  addMessage,
  canSend,
  clearMessages,
  copyResult,
  draftInput,
  eventLog,
  handleSelectModel,
  handleSelectProvider,
  handleSelectScene,
  hasLastSubmitted,
  loadAll,
  loadError,
  loadStatus,
  messages,
  modelOptions,
  providers,
  promptVersionOptions,
  reasoningMode,
  removeMessage,
  retry,
  run,
  selectedModelId,
  selectedPromptVersionId,
  selectedProviderId,
  selectedScene,
  send,
  stop,
  streamedText,
} = useAiDebugger()

const breakpoints = useBreakpoints({ narrow: 1024, small: 768 })
const isNarrow = breakpoints.smaller('narrow')
const isSmall = breakpoints.smaller('small')

const panelOpen = ref(false)
watch(isSmall, (small) => {
  if (!small) {
    panelOpen.value = false
  }
})

watch(loadStatus, (status) => {
  if (status === 'idle') {
    void loadAll()
  }
}, { immediate: true })

const loadErrorDescription = computed(() => loadError.value
  ? normalizeFeedbackError(loadError.value).message
  : '请检查网络连接后重试')

const hasProviders = computed(() => providers.value.length > 0)
const hasModels = computed(() => modelOptions.value.length > 0)

const displayText = computed(() => streamedText.value)
const answerHtml = computed(() => renderMarkdown(displayText.value))

const firstTokenDelayMs = computed(() => {
  if (!run.value.firstTokenAt || !run.value.startedAt) {
    return null
  }
  return run.value.firstTokenAt - run.value.startedAt
})

const sceneLabel = computed(() => getAiSceneLabel(selectedScene.value))

/** 流式输出时自动滚动到底部。 */
const chatBodyRef = ref<HTMLElement | null>(null)
watch(displayText, async () => {
  await nextTick()
  const el = chatBodyRef.value
  if (el) {
    el.scrollTop = el.scrollHeight
  }
})

function handleAddContext(role: AiDebugMessageRole = 'user'): void {
  addMessage(role, '')
}

async function handleSend(): Promise<void> {
  await send()
}

/** TDesign Textarea keydown 回调签名 (value, { e })，此处只取原生事件判断 Enter。 */
function handleTextareaKeydown(_value: string | number, context: { e: KeyboardEvent }): void {
  const event = context.e
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void handleSend()
  }
}

async function handleStop(): Promise<void> {
  await stop()
}

async function handleRetry(): Promise<void> {
  await retry()
}

async function handleCopy(): Promise<void> {
  await copyResult()
}

function handleClear(): void {
  clearMessages()
}
</script>

<template>
  <AppPage>
    <div class="ai-debug-workspace" :class="{ 'ai-debug-workspace--panel-open': panelOpen }">
      <!-- 中屏顶部配置条（<1024px） -->
      <div v-if="isNarrow" class="ai-debug-workspace__narrow-bar">
        <t-select
          :model-value="selectedScene"
          :options="AI_SCENE_OPTIONS"
          :disabled="run.startedAt !== null"
          @change="(value) => handleSelectScene(value as never)"
        />
        <t-select
          :model-value="selectedProviderId"
          placeholder="选择服务商"
          :disabled="run.startedAt !== null"
          @change="(value) => handleSelectProvider(String(value))"
        >
          <t-option v-for="provider in providers" :key="provider.id" :label="provider.name" :value="provider.id" />
        </t-select>
        <t-select
          :model-value="selectedModelId"
          placeholder="选择模型"
          :disabled="run.startedAt !== null"
          @change="(value) => handleSelectModel(String(value))"
        >
          <t-option v-for="option in modelOptions" :key="option.value" :label="option.label" :value="option.value" />
        </t-select>
        <t-select
          :model-value="selectedPromptVersionId"
          :disabled="run.startedAt !== null"
          @change="(value) => selectedPromptVersionId = String(value)"
        >
          <t-option label="使用当前发布版本" value="" />
          <t-option v-for="option in promptVersionOptions" :key="option.value" :label="option.label" :value="option.value" />
        </t-select>
        <t-radio-group
          :model-value="reasoningMode"
          :disabled="run.startedAt !== null"
          variant="default-filled"
          @change="(value) => reasoningMode = value as never"
        >
          <t-radio value="OFF">
            快速回答
          </t-radio>
          <t-radio value="ON">
            深度分析
          </t-radio>
        </t-radio-group>
        <t-button v-if="isSmall" variant="text" @click="panelOpen = !panelOpen">
          详情
        </t-button>
      </div>

      <!-- 左栏：配置 -->
      <aside v-show="!isNarrow" class="ai-debug-workspace__config">
        <p class="ai-debug-workspace__section-title">
          请求配置
        </p>

        <t-form label-align="top">
          <t-form-item label="场景">
            <t-select
              :model-value="selectedScene"
              :options="AI_SCENE_OPTIONS"
              :disabled="run.startedAt !== null"
              @change="(value) => handleSelectScene(value as never)"
            />
          </t-form-item>
          <t-form-item
            help="按服务商过滤；默认取该场景绑定的默认模型。"
            label="服务商"
          >
            <t-select
              :model-value="selectedProviderId"
              :disabled="run.startedAt !== null"
              placeholder="选择服务商"
              @change="(value) => handleSelectProvider(String(value))"
            >
              <t-option v-for="provider in providers" :key="provider.id" :label="provider.name" :value="provider.id" />
            </t-select>
          </t-form-item>
          <t-form-item label="模型">
            <t-select
              :model-value="selectedModelId"
              :disabled="run.startedAt !== null"
              placeholder="选择模型"
              @change="(value) => handleSelectModel(String(value))"
            >
              <t-option v-for="option in modelOptions" :key="option.value" :label="option.label" :value="option.value" />
            </t-select>
          </t-form-item>
          <t-form-item
            help="指定后忽略场景当前发布版本；留空使用该场景当前发布版本。"
            label="提示词版本"
          >
            <t-select
              :model-value="selectedPromptVersionId"
              :disabled="run.startedAt !== null"
              @change="(value) => selectedPromptVersionId = String(value)"
            >
              <t-option label="使用当前发布版本" value="" />
              <t-option v-for="option in promptVersionOptions" :key="option.value" :label="option.label" :value="option.value" />
            </t-select>
          </t-form-item>
          <t-form-item label="回答模式">
            <t-radio-group
              :model-value="reasoningMode"
              :disabled="run.startedAt !== null"
              variant="default-filled"
              @change="(value) => reasoningMode = value as never"
            >
              <t-radio value="OFF">
                快速回答
              </t-radio>
              <t-radio value="ON">
                深度分析
              </t-radio>
            </t-radio-group>
          </t-form-item>
        </t-form>

        <div class="ai-debug-workspace__context-head">
          <span class="ai-debug-workspace__section-title">上下文（{{ messages.length }}/30）</span>
          <t-button size="small" variant="text" @click="handleAddContext('user')">
            添加上下文
          </t-button>
        </div>
        <div v-if="messages.length" class="ai-debug-workspace__context-list">
          <div v-for="(message, index) in messages" :key="index" class="ai-debug-workspace__context-item">
            <div class="ai-debug-workspace__context-item-head">
              <t-select
                :model-value="message.role"
                :disabled="run.startedAt !== null"
                size="small"
                @change="(value) => message.role = value as never"
              >
                <t-option label="用户" value="user" />
                <t-option label="助手" value="assistant" />
              </t-select>
              <t-button
                size="small"
                theme="danger"
                variant="text"
                @click="removeMessage(index)"
              >
                <template #icon>
                  <DeleteIcon />
                </template>
              </t-button>
            </div>
            <t-textarea
              :model-value="message.content"
              :autosize="{ minRows: 2, maxRows: 6 }"
              :disabled="run.startedAt !== null"
              placeholder="输入该条消息内容"
              @change="(value) => message.content = String(value)"
            />
          </div>
        </div>
        <p v-else class="ai-debug-workspace__muted-text">
          暂无上下文消息；发送时输入内容将作为最后一条用户消息。
        </p>

        <t-alert
          v-if="!hasProviders"
          class="ai-debug-workspace__config-alert"
          theme="warning"
          title="尚未配置 AI 服务商"
        />
        <t-alert
          v-else-if="!hasModels"
          class="ai-debug-workspace__config-alert"
          theme="warning"
          title="当前服务商下暂无可用模型"
        />
      </aside>

      <!-- 中栏：对话 -->
      <main class="ai-debug-workspace__chat">
        <div class="ai-debug-workspace__chat-head">
          <div class="ai-debug-workspace__chat-title">
            <span>{{ sceneLabel }}</span>
            <AppStatusTag
              :label="run.startedAt !== null ? '生成中' : run.error ? '失败' : run.stopped ? '已停止' : run.finishReason ? '已完成' : '待发送'"
              :status="run.startedAt !== null ? 'processing' : run.error ? 'error' : run.stopped ? 'warning' : run.finishReason ? 'success' : 'default'"
            />
          </div>
          <div class="ai-debug-workspace__chat-actions">
            <t-button size="small" variant="text" :disabled="!hasLastSubmitted" @click="handleRetry">
              重新测试
            </t-button>
            <t-button size="small" variant="text" :disabled="messages.length === 0 && !displayText" @click="handleClear">
              清空
            </t-button>
            <t-button size="small" variant="text" :disabled="!displayText" @click="handleCopy">
              复制结果
            </t-button>
          </div>
        </div>

        <div ref="chatBodyRef" class="ai-debug-workspace__chat-body">
          <template v-if="loadStatus === 'error'">
            <AppEmptyState
              class="ai-debug-workspace__chat-empty"
              :description="loadErrorDescription"
              title="配置加载失败"
            >
              <template #action>
                <t-button theme="primary" variant="outline" @click="loadAll">
                  重试
                </t-button>
              </template>
            </AppEmptyState>
          </template>

          <template v-else>
            <div
              v-for="(message, index) in messages"
              :key="index"
              class="ai-debug-workspace__bubble-row"
              :class="`ai-debug-workspace__bubble-row--${message.role}`"
            >
              <div
                class="ai-debug-workspace__bubble"
                :class="`ai-debug-workspace__bubble--${message.role}`"
              >
                <p class="ai-debug-workspace__bubble-text">
                  {{ message.content }}
                </p>
              </div>
            </div>

            <div
              v-if="displayText || run.startedAt !== null"
              class="ai-debug-workspace__bubble-row ai-debug-workspace__bubble-row--assistant"
            >
              <div class="ai-debug-workspace__bubble ai-debug-workspace__bubble--assistant">
                <div
                  v-if="displayText"
                  class="ai-debug-workspace__bubble-markdown"
                  v-html="answerHtml"
                />
                <p v-else-if="run.startedAt !== null" class="ai-debug-workspace__muted-text">
                  {{ run.error ? run.error.message : '正在等待模型响应…' }}
                </p>
              </div>
            </div>

            <AppEmptyState
              v-if="messages.length === 0 && !displayText && run.startedAt === null"
              class="ai-debug-workspace__chat-empty"
              description="配置请求参数后输入问题，回车或点击发送"
              title="AI 调试台"
            />
          </template>
        </div>

        <div class="ai-debug-workspace__chat-input">
          <t-textarea
            v-model="draftInput"
            :autosize="{ minRows: 2, maxRows: 6 }"
            :disabled="run.startedAt !== null"
            placeholder="输入测试问题，Enter 发送，Shift+Enter 换行"
            @keydown="handleTextareaKeydown"
          />
          <t-button
            v-if="run.startedAt !== null"
            theme="danger"
            variant="outline"
            @click="handleStop"
          >
            停止
          </t-button>
          <t-button
            v-else
            :disabled="!canSend"
            theme="primary"
            @click="handleSend"
          >
            <template #icon>
              <SendIcon />
            </template>
            发送
          </t-button>
        </div>
      </main>

      <!-- 右栏：请求详情 -->
      <aside v-show="!isNarrow" class="ai-debug-workspace__detail">
        <p class="ai-debug-workspace__section-title">
          请求详情
        </p>

        <div class="ai-debug-workspace__detail-block">
          <t-descriptions :column="1" size="small">
            <t-descriptions-item label="requestId">
              <span class="ai-debug-workspace__mono">{{ run.requestId ?? '-' }}</span>
            </t-descriptions-item>
            <t-descriptions-item label="实际模型">
              {{ run.modelId ?? '-' }}
            </t-descriptions-item>
            <t-descriptions-item label="场景">
              {{ sceneLabel }}
            </t-descriptions-item>
            <t-descriptions-item label="提示词版本">
              {{ selectedPromptVersionId ? `v${selectedPromptVersionId.slice(0, 8)}` : '当前发布版本' }}
            </t-descriptions-item>
            <t-descriptions-item label="回答模式">
              {{ reasoningMode === 'ON' ? '深度分析' : '快速回答' }}
            </t-descriptions-item>
            <t-descriptions-item label="开始时间">
              {{ run.startedAt ? formatDate(new Date(run.startedAt)) : '-' }}
            </t-descriptions-item>
            <t-descriptions-item label="首字延迟">
              {{ firstTokenDelayMs !== null ? `${firstTokenDelayMs} ms` : '-' }}
            </t-descriptions-item>
            <t-descriptions-item label="总耗时">
              {{ run.latencyMs !== null ? `${run.latencyMs} ms` : '-' }}
            </t-descriptions-item>
            <t-descriptions-item label="finishReason">
              {{ run.finishReason ?? '-' }}
            </t-descriptions-item>
            <t-descriptions-item label="输入 Token">
              {{ run.usage?.inputTokens ?? '-' }}
            </t-descriptions-item>
            <t-descriptions-item label="输出 Token">
              {{ run.usage?.outputTokens ?? '-' }}
            </t-descriptions-item>
            <t-descriptions-item label="推理 Token">
              {{ run.usage?.reasoningTokens ?? '-' }}
            </t-descriptions-item>
          </t-descriptions>
        </div>

        <t-alert
          v-if="run.error"
          class="ai-debug-workspace__detail-block"
          theme="error"
          :title="run.error.message"
        >
          <template #default>
            <p class="ai-debug-workspace__detail-error">
              错误码：{{ run.error.code }}<br>
              requestId：{{ run.error.requestId ?? '-' }}
            </p>
            <t-button
              v-if="run.error.retryable"
              size="small"
              theme="primary"
              variant="outline"
              :disabled="run.startedAt !== null"
              @click="handleRetry"
            >
              重试
            </t-button>
          </template>
        </t-alert>

        <p class="ai-debug-workspace__section-title ai-debug-workspace__section-title--mt">
          SSE 事件日志
        </p>
        <div v-if="eventLog.length" class="ai-debug-workspace__event-log">
          <div v-for="(entry, index) in eventLog" :key="index" class="ai-debug-workspace__event-line">
            <span class="ai-debug-workspace__event-time">
              {{ new Date(entry.time).toLocaleTimeString() }}
            </span>
            <span
              class="ai-debug-workspace__event-type"
              :class="`ai-debug-workspace__event-type--${entry.type}`"
            >
              {{ entry.type }}
            </span>
            <span class="ai-debug-workspace__event-summary">{{ entry.summary }}</span>
          </div>
        </div>
        <p v-else class="ai-debug-workspace__muted-text">
          发送请求后展示事件时间线。
        </p>
      </aside>
    </div>
  </AppPage>
</template>

<style scoped>
.ai-debug-workspace {
  display: grid;
  grid-template-columns: 270px minmax(0, 1fr) 280px;
  gap: var(--td-comp-margin-l);
  height: calc(100vh - 200px);
  min-height: 460px;
}

.ai-debug-workspace__config,
.ai-debug-workspace__detail {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-comp-margin-s);
  overflow-y: auto;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
}

.ai-debug-workspace__chat {
  display: flex;
  min-width: 0;
  flex-direction: column;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  overflow: hidden;
}

.ai-debug-workspace__section-title {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  font-weight: 600;
}

.ai-debug-workspace__section-title--mt {
  margin-top: var(--td-comp-margin-l);
}

.ai-debug-workspace__config-alert {
  margin-top: var(--td-comp-margin-s);
}

.ai-debug-workspace__context-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-s);
}

.ai-debug-workspace__context-list {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-s);
}

.ai-debug-workspace__context-item {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-xs);
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-s);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
}

.ai-debug-workspace__context-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-s);
}

.ai-debug-workspace__context-item-head .t-select {
  width: 96px;
}

.ai-debug-workspace__chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-comp-margin-s);
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
  border-bottom: 1px solid var(--td-component-border);
}

.ai-debug-workspace__chat-title {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-s);
  font-weight: 600;
}

.ai-debug-workspace__chat-actions {
  display: flex;
  align-items: center;
  gap: var(--td-comp-margin-xs);
}

.ai-debug-workspace__chat-body {
  flex: 1;
  min-height: 0;
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
  overflow-y: auto;
}

.ai-debug-workspace__bubble-row {
  display: flex;
  margin-bottom: var(--td-comp-margin-m);
}

.ai-debug-workspace__bubble-row--user {
  justify-content: flex-end;
}

.ai-debug-workspace__bubble-row--assistant {
  justify-content: flex-start;
}

.ai-debug-workspace__bubble {
  max-width: 86%;
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-m);
  border-radius: var(--td-radius-medium);
  word-break: break-word;
}

.ai-debug-workspace__bubble--user {
  color: var(--td-text-color-primary);
  background: var(--td-brand-color-light);
}

.ai-debug-workspace__bubble--assistant {
  background: var(--td-bg-color-component);
  border: 1px solid var(--td-component-border);
}

.ai-debug-workspace__bubble-text {
  margin: 0;
  white-space: pre-wrap;
}

.ai-debug-workspace__bubble-markdown {
  font-size: var(--td-font-size-body-medium);
  line-height: var(--td-line-height-body-medium);
}

.ai-debug-workspace__bubble-markdown :deep(p) {
  margin: 0 0 var(--td-comp-margin-s);
}

.ai-debug-workspace__bubble-markdown :deep(p:last-child) {
  margin-bottom: 0;
}

.ai-debug-workspace__bubble-markdown :deep(pre) {
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-s);
  overflow: auto;
  background: var(--td-bg-color-container);
  border-radius: var(--td-radius-small);
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
}

.ai-debug-workspace__bubble-markdown :deep(code) {
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
}

.ai-debug-workspace__bubble-markdown :deep(ul),
.ai-debug-workspace__bubble-markdown :deep(ol) {
  padding-left: var(--td-comp-paddingLR-l);
}

.ai-debug-workspace__chat-input {
  display: flex;
  align-items: flex-end;
  gap: var(--td-comp-margin-s);
  padding: var(--td-comp-paddingTB-l) var(--td-comp-paddingLR-l);
  border-top: 1px solid var(--td-component-border);
}

.ai-debug-workspace__chat-input .t-textarea {
  flex: 1;
}

.ai-debug-workspace__chat-empty {
  margin-top: var(--td-comp-margin-xxl);
}

.ai-debug-workspace__muted-text {
  margin: 0;
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
}

.ai-debug-workspace__detail-block {
  margin-bottom: var(--td-comp-margin-s);
}

.ai-debug-workspace__mono {
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
  word-break: break-all;
}

.ai-debug-workspace__detail-error {
  margin: 0 0 var(--td-comp-margin-s);
  font-size: var(--td-font-size-body-small);
  line-height: var(--td-line-height-body-small);
}

.ai-debug-workspace__event-log {
  display: flex;
  flex-direction: column;
  gap: var(--td-comp-margin-xs);
}

.ai-debug-workspace__event-line {
  display: grid;
  grid-template-columns: 64px 52px minmax(0, 1fr);
  gap: var(--td-comp-margin-xs);
  align-items: baseline;
  font-size: var(--td-font-size-body-small);
}

.ai-debug-workspace__event-time {
  color: var(--td-text-color-placeholder);
  font-family: var(--td-font-family-mono);
}

.ai-debug-workspace__event-type {
  padding: 0 var(--td-comp-paddingLR-xs);
  border-radius: var(--td-radius-small);
  font-family: var(--td-font-family-mono);
  text-align: center;
}

.ai-debug-workspace__event-type--message {
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
}

.ai-debug-workspace__event-type--progress {
  color: var(--td-warning-color);
  background: var(--td-warning-color-light);
}

.ai-debug-workspace__event-type--delta {
  color: var(--td-success-color);
  background: var(--td-success-color-light);
}

.ai-debug-workspace__event-type--done,
.ai-debug-workspace__event-type--stopped {
  color: var(--td-text-color-secondary);
  background: var(--td-bg-color-component);
}

.ai-debug-workspace__event-type--error {
  color: var(--td-error-color);
  background: var(--td-error-color-light);
}

.ai-debug-workspace__event-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-debug-workspace__narrow-bar {
  display: flex;
  grid-column: 1 / -1;
  flex-wrap: wrap;
  gap: var(--td-comp-margin-s);
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-s);
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
}

.ai-debug-workspace__narrow-bar .t-select {
  min-width: 140px;
  flex: 1;
}

@media (max-width: 1023px) {
  .ai-debug-workspace {
    grid-template-columns: minmax(0, 1fr);
    height: auto;
    min-height: 0;
  }

  .ai-debug-workspace__config {
    display: none;
  }

  .ai-debug-workspace__chat {
    min-height: 480px;
  }
}

@media (max-width: 767px) {
  .ai-debug-workspace__detail {
    position: fixed;
    z-index: 999;
    inset: 0 0 0 auto;
    width: min(340px, 88vw);
    border-radius: var(--td-radius-medium) 0 0 var(--td-radius-medium);
    box-shadow: var(--td-shadow-3);
    transform: translateX(100%);
    transition: transform 0.24s ease;
  }

  .ai-debug-workspace--panel-open .ai-debug-workspace__detail {
    transform: translateX(0);
  }
}
</style>

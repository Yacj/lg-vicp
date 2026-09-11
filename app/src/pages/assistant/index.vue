<script setup lang="ts">
import type { AiSourceRef, ApiEnvelope, CreateShareResult, ProjectRecord } from '@/api/types'
import { projectApi } from '@/api/modules/projects'
import AiComposer from '@/components/ai/AiComposer.vue'
import AiFeedbackPanel from '@/components/ai/AiFeedbackPanel.vue'
import AiMessageList from '@/components/ai/AiMessageList.vue'
import AiQuickPromptRail from '@/components/ai/AiQuickPromptRail.vue'
import AiSharePanel from '@/components/ai/AiSharePanel.vue'
import AiShareSelectBar from '@/components/ai/AiShareSelectBar.vue'
import AiWelcomeHero from '@/components/ai/AiWelcomeHero.vue'
import { useQuickPrompts } from '@/composables/useQuickPrompts'
import { QUICK_PROMPT_POSITION } from '@/constants/aiQuickPrompt'
import { useAssistantStore } from '@/store/assistant'
import { compactQuery, resolveAiSourceLocator } from '@/utils/aiSource'

definePage({
  name: 'assistant',
  layout: 'tabbar',
  style: {
    'navigationStyle': 'custom',
    'app-plus': {
      softinputMode: 'adjustResize',
    },
  },
})

const router = useRouter()
const { requireLogin } = useAuthGate()
const { error: showError } = useGlobalToast()
const globalDialog = useGlobalDialog()
const assistantStore = useAssistantStore()
const { items: quickPrompts, loading: quickPromptsLoading, load: loadQuickPrompts } = useQuickPrompts()

const isComposerActive = ref(false)
const input = ref('')
/** 跨 Tab 传入的项目上下文：发送时创建/复用该项目会话 */
const pendingProjectId = ref<string>()
const pendingProjectName = ref<string>()
let projectNameRevision = 0

const activeProjectId = computed(() => pendingProjectId.value ?? assistantStore.projectId ?? undefined)
const activeProjectName = computed(() => pendingProjectName.value)
const messages = computed(() => assistantStore.messages)
const navbarTitle = computed(() => assistantStore.conversation?.title?.trim() || '筑小格 Ai助手')
const streaming = computed(() => assistantStore.isStreaming)
const loadingConversation = computed(() => assistantStore.loadState === 'loading')
const failedConversationId = ref<string>()
const composerDisabled = computed(() => loadingConversation.value || Boolean(failedConversationId.value) || assistantStore.sendLock)
const followLatest = ref(true)
const messageScrollTarget = ref('')
let lastMessageScrollTop = 0

/** 分享选择模式 */
const isSelecting = ref(false)
const selectedIds = ref<string[]>([])
const sharePanelVisible = ref(false)
const shareToken = ref('')
const shareTitle = ref('')
const SHARE_LIMIT = 20

/** 点踩反馈弹窗 */
const feedbackPanelVisible = ref(false)
const pendingFeedbackMessageId = ref<string>()

const shareableMessages = computed(() =>
  messages.value.filter(
    message => message.status === 'COMPLETED' && (message.role === 'USER' || message.role === 'ASSISTANT'),
  ),
)
const shareableCount = computed(() => shareableMessages.value.length)
const allSelected = computed(
  () => shareableCount.value > 0 && selectedIds.value.length === Math.min(shareableCount.value, SHARE_LIMIT),
)
const shareDefaultTitle = computed(() => assistantStore.conversation?.title?.trim() || '筑小格 AI 对话分享')

const latestMessageFingerprint = computed(() => {
  const latest = messages.value[messages.value.length - 1]
  return latest ? `${latest.id}:${latest.content.length}:${latest.status}` : ''
})

function openConversationHistory() {
  if (requireLogin()) {
    router.push({ name: 'conversation-history' })
  }
}

async function scrollToLatest(force = false) {
  if (!force && !followLatest.value) {
    return
  }
  followLatest.value = true
  await nextTick()
  messageScrollTarget.value = ''
  await nextTick()
  messageScrollTarget.value = 'assistant-message-end'
}

function handleMessageScroll(event: { detail: { scrollTop: number } }) {
  const nextScrollTop = event.detail.scrollTop
  if (nextScrollTop + 12 < lastMessageScrollTop) {
    followLatest.value = false
  }
  lastMessageScrollTop = nextScrollTop
}

function handleMessageScrollToLower() {
  followLatest.value = true
}

function useSuggestion(content: string) {
  if (!assistantStore.canSend) {
    return
  }
  input.value = content
  isComposerActive.value = true
  void sendMessage()
}

function openKnowledgeSource(source: AiSourceRef) {
  if (!requireLogin()) {
    return
  }
  const locator = resolveAiSourceLocator(source)
  if (!locator && !source.originalFileId) {
    showError('当前来源暂不支持查看原文')
    return
  }
  router.push({
    name: 'knowledge-source',
    query: compactQuery({
      documentId: locator?.documentId,
      sectionId: locator?.sectionId,
      pageId: locator?.pageId,
      blockId: locator?.blockId,
      chunkId: locator?.chunkId,
      originalFileId: source.originalFileId,
      physicalPageNumber: source.physicalPageNumber,
      title: source.title,
      pageLabel: source.pageLabel,
    }),
  })
}

watch(latestMessageFingerprint, () => {
  void scrollToLatest()
})

async function loadProjectName(projectId: string) {
  const currentRevision = ++projectNameRevision
  try {
    const response = await projectApi.getDetail(projectId).send() as ApiEnvelope<{ project: ProjectRecord }>
    if (currentRevision === projectNameRevision && activeProjectId.value === projectId) {
      pendingProjectName.value = response.data.project.name
    }
  }
  catch {
    // 项目名只是关联提示的增强信息，不阻断对话加载与发送。
  }
}

async function loadConversationSafely(id: string) {
  failedConversationId.value = undefined
  try {
    await assistantStore.loadConversation(id)
    pendingProjectId.value = undefined
    const linkedProjectId = assistantStore.projectId
    if (linkedProjectId && !pendingProjectName.value) {
      void loadProjectName(linkedProjectId)
    }
    else if (!linkedProjectId) {
      pendingProjectName.value = undefined
    }
  }
  catch {
    failedConversationId.value = id
    // store.error 由下方 watch 统一 Toast
  }
}

// 跨 Tab 一次性导航上下文：会话 / 项目 / 场景 / 预设问题消费
onShow(() => {
  if (!assistantStore.isStreaming) {
    assistantStore.sendLock = false
  }
  const context = assistantStore.consumeNavContext()

  if (context.conversationId && context.conversationId !== assistantStore.conversationId) {
    projectNameRevision += 1
    pendingProjectId.value = undefined
    pendingProjectName.value = context.projectName
    void loadConversationSafely(context.conversationId)
  }
  else if (context.projectId) {
    const shouldStartProjectConversation = context.projectId !== assistantStore.projectId

    if (shouldStartProjectConversation) {
      failedConversationId.value = undefined
      assistantStore.newConversation()
      pendingProjectId.value = context.projectId
    }
    pendingProjectName.value = context.projectName
    if (!context.projectName) {
      void loadProjectName(context.projectId)
    }
  }

  if (context.presetQuestion) {
    input.value = context.presetQuestion
    isComposerActive.value = true
  }

  refreshQuickPrompts()
})

watch(() => assistantStore.error, (message) => {
  if (message) {
    showError(message)
  }
})

function refreshQuickPrompts() {
  void loadQuickPrompts(pendingProjectId.value || assistantStore.projectId ? QUICK_PROMPT_POSITION.project : QUICK_PROMPT_POSITION.home)
}

function resetConversation() {
  projectNameRevision += 1
  assistantStore.newConversation()
  failedConversationId.value = undefined
  pendingProjectId.value = undefined
  pendingProjectName.value = undefined
  input.value = ''
  isComposerActive.value = false
  followLatest.value = true
  refreshQuickPrompts()
}

function startNewConversation() {
  if (streaming.value) {
    globalDialog.confirm({
      title: '新建对话',
      msg: '当前回答仍在生成。新建对话会停止本次生成，已生成的内容仍会保留在历史记录中。',
      confirmButtonText: '停止并新建',
      cancelButtonText: '继续当前对话',
      success: resetConversation,
    })
    return
  }

  if (!messages.value.length && !assistantStore.conversationId && !pendingProjectId.value && !input.value) {
    return
  }
  resetConversation()
}

async function sendMessage() {
  const content = input.value.trim()
  if (!content) {
    return
  }
  if (!requireLogin()) {
    return
  }
  try {
    const accepted = await assistantStore.sendMessage(content, {
      projectId: activeProjectId.value,
    })
    if (accepted) {
      input.value = ''
      followLatest.value = true
      void scrollToLatest(true)
    }
  }
  catch (error) {
    showError(error instanceof Error ? error.message : '发送失败，请重试')
  }
}

async function handleRegenerate(messageId: string) {
  if (!requireLogin()) {
    return
  }
  try {
    await assistantStore.regenerate(messageId)
  }
  catch (error) {
    showError(error instanceof Error ? error.message : '重新生成失败，请重试')
  }
}

function handleFeedback(messageId: string, reaction: 'LIKE' | 'DISLIKE' | null) {
  if (reaction === 'DISLIKE') {
    pendingFeedbackMessageId.value = messageId
    feedbackPanelVisible.value = true
    return
  }
  void assistantStore.feedback(messageId, reaction).catch(() => {
    showError('反馈提交失败，请重试')
  })
}

function handleFeedbackConfirm(payload: { tags: string[], content: string }) {
  const messageId = pendingFeedbackMessageId.value
  if (!messageId) {
    return
  }
  void assistantStore.feedback(messageId, 'DISLIKE', payload).catch(() => {
    showError('反馈提交失败，请重试')
  })
}

function enterSelectMode() {
  if (streaming.value) {
    showError('回答生成中，暂不能分享')
    return
  }
  if (!shareableCount.value) {
    showError('暂无可分享的消息')
    return
  }
  isSelecting.value = true
  selectedIds.value = []
}

function toggleSelect(messageId: string) {
  const index = selectedIds.value.indexOf(messageId)
  if (index >= 0) {
    selectedIds.value.splice(index, 1)
    return
  }
  if (selectedIds.value.length >= SHARE_LIMIT) {
    showError(`一次最多分享 ${SHARE_LIMIT} 条消息`)
    return
  }
  selectedIds.value.push(messageId)
}

function toggleAll() {
  if (allSelected.value) {
    selectedIds.value = []
    return
  }
  selectedIds.value = shareableMessages.value.slice(0, SHARE_LIMIT).map(message => message.id)
  if (shareableCount.value > SHARE_LIMIT) {
    showError(`一次最多分享 ${SHARE_LIMIT} 条，已为你选中前 ${SHARE_LIMIT} 条`)
  }
}

function cancelSelect() {
  isSelecting.value = false
  selectedIds.value = []
}

function confirmShare() {
  if (selectedIds.value.length) {
    sharePanelVisible.value = true
  }
}

function handleShareSuccess(share: CreateShareResult) {
  shareToken.value = share.share.token
  shareTitle.value = share.share.title
}

onShareAppMessage(() => {
  return {
    title: shareTitle.value || 'AI 对话分享',
    path: `/pages/share/index?token=${shareToken.value}`,
  }
})
</script>

<template>
  <view class="app-page app-page--immersive assistant-page box-border flex flex-col">
    <wd-navbar custom-class="!bg-transparent" safe-area-inset-top :title="navbarTitle">
      <template #left>
        <view class="assistant-navbar-actions flex items-center">
          <view class="assistant-navbar-action flex items-center justify-center" aria-label="查看历史会话" @click="openConversationHistory">
            <text class="i-my-icons-history text-4" />
          </view>
          <view class="assistant-navbar-action flex items-center justify-center" aria-label="新建对话" @click="startNewConversation">
            <text class="i-my-icons-new-chat text-4" />
          </view>
        </view>
      </template>
    </wd-navbar>

    <view class="app-enter assistant-page__body relative min-h-0 flex flex-1 flex-col px-4">
      <view v-if="activeProjectId" class="app-panel-flat mb-3 flex items-center gap-2 rounded-3 px-3 py-2">
        <wd-icon name="home" size="30rpx" color="var(--app-action-primary)" />
        <text class="app-muted min-w-0 flex-1 truncate text-2.5">
          {{ activeProjectName ? `当前会话关联项目：${activeProjectName}` : '当前会话已关联项目' }}
        </text>
      </view>

      <scroll-view
        scroll-y
        scroll-with-animation
        :scroll-into-view="messageScrollTarget"
        :lower-threshold="40"
        class="assistant-page__messages min-h-0 flex-1"
        @scroll="handleMessageScroll"
        @scrolltolower="handleMessageScrollToLower"
      >
        <view v-if="loadingConversation" class="assistant-page__loading flex flex-col items-center justify-center">
          <wd-loading size="44rpx" color="var(--app-action-primary)" />
          <text class="app-muted mt-3 text-3">
            正在加载会话
          </text>
        </view>
        <view v-else-if="failedConversationId" class="assistant-page__loading flex flex-col items-center justify-center px-6 text-center">
          <wd-icon name="warning" size="64rpx" color="var(--app-danger)" />
          <text class="mt-3 text-3.5 font-medium">
            会话加载失败
          </text>
          <text class="app-muted mt-1 text-2.5">
            请检查网络后重试，当前不会创建新的空会话。
          </text>
          <wd-button size="small" custom-class="mt-4!" @click="loadConversationSafely(failedConversationId)">
            重新加载
          </wd-button>
        </view>
        <AiWelcomeHero
          v-else-if="!messages.length"
          :visible="true"
        />
        <AiMessageList
          v-else
          :messages="messages"
          :is-streaming="streaming"
          :streaming-message-id="assistantStore.streamingMessageId"
          :progress-message="assistantStore.progressMessage"
          :feedbacks="assistantStore.feedbacks"
          :selection-mode="isSelecting"
          :selected-ids="selectedIds"
          @regenerate="handleRegenerate"
          @feedback="handleFeedback"
          @share="enterSelectMode"
          @toggle-select="toggleSelect"
          @open-source="openKnowledgeSource"
        />
        <view id="assistant-message-end" class="h-1" />
      </scroll-view>

      <view
        v-if="messages.length && !followLatest"
        class="assistant-page__to-bottom app-panel-flat flex items-center gap-1.5 rounded-full px-3 py-2 text-2.5"
        @click="scrollToLatest(true)"
      >
        <wd-icon name="arrow-down" size="26rpx" />
        <text>回到底部</text>
      </view>

      <view class="assistant-page__composer pt-2">
        <AiShareSelectBar
          v-if="isSelecting"
          :selected-count="selectedIds.length"
          :all-selected="allSelected"
          @toggle-all="toggleAll"
          @cancel="cancelSelect"
          @confirm="confirmShare"
        />
        <template v-else>
          <AiQuickPromptRail
            :prompts="quickPrompts"
            :loading="quickPromptsLoading"
            :disabled="!assistantStore.canSend"
            @suggest="useSuggestion"
          />
          <AiComposer
            v-model="input"
            v-model:active="isComposerActive"
            :streaming="streaming"
            :disabled="composerDisabled"
            @send="sendMessage"
            @stop="assistantStore.stopStreaming()"
          />
        </template>
      </view>
    </view>

    <AiSharePanel
      v-model="sharePanelVisible"
      :message-ids="selectedIds"
      :default-title="shareDefaultTitle"
      @success="handleShareSuccess"
    />

    <AiFeedbackPanel
      v-model="feedbackPanelVisible"
      @confirm="handleFeedbackConfirm"
    />
  </view>
</template>

<style lang="scss" scoped>
.assistant-page {
  height: calc(var(--app-viewport-height, 100vh) - var(--app-current-tabbar-offset, 0px));
  min-height: 0;
  overflow: hidden;
  background: var(--app-bg-surface);
}

.assistant-navbar-actions {
  min-width: 176rpx;
}

.assistant-navbar-action {
  width: 68rpx;
  height: 68rpx;
  color: var(--app-text-primary);
  background: transparent;
  transition: color var(--app-transition-fast) ease, opacity var(--app-transition-fast) ease, transform var(--app-transition-fast) ease;
}

.assistant-navbar-action:active {
  color: var(--app-action-primary);
  opacity: 0.72;
  transform: scale(0.92);
}

.assistant-page__body {
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  overflow: hidden;
}

.assistant-page__messages {
  height: 0;
  overscroll-behavior: contain;
}

.assistant-page__loading {
  min-height: 480rpx;
}

.assistant-page__to-bottom {
  position: absolute;
  right: 32rpx;
  bottom: 248rpx;
  z-index: 3;
  color: var(--app-text-secondary);
  background: var(--app-bg-elevated);
  box-shadow: var(--app-shadow-card);
}

.assistant-page__composer {
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  padding-bottom: 24rpx;
  background: linear-gradient(180deg, transparent 0%, var(--app-bg-surface) 20%);
}
</style>

import type {
  AiFeedbackReaction,
  AiMessageFeedback,
  AiScene,
  AiSourceRef,
  AiStreamEventPayload,
  ApiEnvelope,
  ConversationDetail,
  ConversationMessage,
  ConversationRecord,
} from '@/api/types'
import type { AiStreamEvent } from '@/services/platform'
import { defineStore } from 'pinia'
import { getApiErrorCode } from '@/api/core/handlers'
import { aiApi } from '@/api/modules/ai'
import { FALLBACK_SCENE, markSceneUnavailable, resolveScene } from '@/constants/aiScene'
import { createAiStreamRequest } from '@/services/platform'
import { useAuthStore } from '@/store/auth'
import { normalizeAiSources, sourceFromRetrieval } from '@/utils/aiSource'

/**
 * 跨 Tab 一次性导航上下文。
 * Tab 切换不可靠传递 query 的平台（小程序/App），
 * 由 useAssistantNavigation 写入、筑小格页面消费后清理。
 */
export interface AssistantNavContext {
  conversationId?: string
  scene?: AiScene
  projectId?: string
  projectName?: string
  presetQuestion?: string
}

/** 会话消息的本地扩展字段（来自 SSE 事件，不落库） */
export interface LocalMessage extends ConversationMessage {
  sources?: AiSourceRef[]
  errorMessage?: string | null
}

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

interface AssistantState {
  nav: AssistantNavContext
  conversation: ConversationRecord | null
  messages: LocalMessage[]
  feedbacks: Record<string, AiMessageFeedback[]>
  loadState: LoadState
  loadError: string
  isStreaming: boolean
  streamMode: 'stream' | 'buffered'
  streamingMessageId: string | null
  progressStage: string | null
  progressMessage: string | null
  creatingConversation: Promise<ConversationRecord> | null
  creatingConversationRevision: number
  activeAbort: (() => void) | null
  streamRevision: number
  loadRevision: number
  /** 进入 ensureConversation 前即锁定，避免连点打出并发 POST */
  sendLock: boolean
}

function parseStreamEvent(event: string, data: Record<string, unknown>): AiStreamEventPayload | null {
  switch (event) {
    case 'message': {
      if (typeof data.messageId !== 'string' || typeof data.conversationId !== 'string') {
        return null
      }
      return {
        event: 'message',
        data: {
          messageId: data.messageId,
          conversationId: data.conversationId,
          userMessageId: typeof data.userMessageId === 'string' ? data.userMessageId : undefined,
          originalMessageId: typeof data.originalMessageId === 'string' ? data.originalMessageId : undefined,
          requestId: typeof data.requestId === 'string' ? data.requestId : '',
        },
      }
    }
    case 'progress': {
      if (typeof data.message !== 'string') {
        return null
      }
      const stage = data.stage === 'analyzing' || data.stage === 'checking' || data.stage === 'composing' || data.stage === 'completed'
        ? data.stage
        : 'analyzing'
      return { event: 'progress', data: { stage, message: data.message } }
    }
    case 'delta': {
      if (typeof data.text !== 'string') {
        return null
      }
      return { event: 'delta', data: { text: data.text } }
    }
    case 'done': {
      if (typeof data.messageId !== 'string' || typeof data.conversationId !== 'string') {
        return null
      }
      return {
        event: 'done',
        data: {
          messageId: data.messageId,
          conversationId: data.conversationId,
          finishReason: typeof data.finishReason === 'string' ? data.finishReason : 'COMPLETED',
          sources: normalizeAiSources(data.sources),
          model: data.model && typeof data.model === 'object' ? (data.model as { id: string }) : null,
          regeneratedMessageId: typeof data.regeneratedMessageId === 'string' ? data.regeneratedMessageId : undefined,
        },
      }
    }
    case 'stopped': {
      if (typeof data.messageId !== 'string') {
        return null
      }
      const content = typeof data.content === 'string'
        ? data.content
        : (typeof data.partialContent === 'string' ? data.partialContent : '')
      return { event: 'stopped', data: { messageId: data.messageId, content } }
    }
    case 'error': {
      return {
        event: 'error',
        data: {
          code: typeof data.code === 'string' ? data.code : 'UNKNOWN',
          message: typeof data.message === 'string' ? data.message : 'AI 回答生成失败',
          requestId: typeof data.requestId === 'string' ? data.requestId : '',
          retryable: typeof data.retryable === 'boolean' ? data.retryable : undefined,
        },
      }
    }
    default:
      return null
  }
}

function createPlaceholderMessage(conversationId: string, id: string, content = ''): LocalMessage {
  return {
    id,
    conversationId,
    userId: null,
    role: 'ASSISTANT',
    content,
    status: 'STREAMING',
    reasoningMode: 'OFF',
    createdAt: new Date().toISOString(),
  }
}

function indexFeedbacks(feedbacks: AiMessageFeedback[]) {
  const map: Record<string, AiMessageFeedback[]> = {}
  for (const feedback of feedbacks) {
    map[feedback.messageId] = [feedback]
  }
  return map
}

function attachSourcesFromRetrievals(messages: ConversationMessage[], retrievals: ConversationDetail['retrievals']): LocalMessage[] {
  const sourcesByMessage = new Map<string, AiSourceRef[]>()
  for (const retrieval of retrievals) {
    if (!retrieval.messageId) {
      continue
    }
    const source = sourceFromRetrieval(retrieval)
    if (!source) {
      continue
    }
    const list = sourcesByMessage.get(retrieval.messageId) ?? []
    list.push(source)
    sourcesByMessage.set(retrieval.messageId, list)
  }
  return messages.map((message) => {
    const sources = sourcesByMessage.get(message.id)
    return sources?.length ? { ...message, sources } : message
  })
}

export const useAssistantStore = defineStore('assistant', {
  state: (): AssistantState => ({
    nav: {},
    conversation: null,
    messages: [],
    feedbacks: {},
    loadState: 'idle',
    loadError: '',
    isStreaming: false,
    streamMode: 'stream',
    streamingMessageId: null,
    progressStage: null,
    progressMessage: null,
    creatingConversation: null,
    creatingConversationRevision: -1,
    activeAbort: null,
    streamRevision: 0,
    loadRevision: 0,
    sendLock: false,
  }),

  getters: {
    /** 会话是否可发送：已加载（含新建空会话）且不在流式 */
    canSend: state => state.loadState !== 'loading' && !state.isStreaming && !state.sendLock,
    /** 最近一条流式消息（UI 光标与进度展示） */
    streamingMessage: (state) => {
      const id = state.streamingMessageId
      return id ? state.messages.find(message => message.id === id) ?? null : null
    },
    conversationId: state => state.conversation?.id ?? null,
    projectId: state => state.conversation?.projectId ?? null,
    /** 最近一次加载/发送错误（页面监听并 Toast） */
    error: state => state.loadError || null,
  },

  actions: {
    setNavContext(context: AssistantNavContext) {
      this.nav = { ...context }
    },

    consumeNavContext() {
      const context = { ...this.nav }
      this.nav = {}
      return context
    },

    /**
     * 获取可用会话：已有会话且项目一致则复用（含历史专业场景会话）。
     * C 端新建一律 general_chat，不要求用户选择 Scene。
     */
    async ensureConversation(options: { projectId?: string, scene?: AiScene } = {}): Promise<ConversationRecord> {
      const { projectId } = options
      const authStore = useAuthStore()
      const currentUserId = authStore.user?.id ?? null
      const current = this.conversation
      const ownedByCurrentUser = Boolean(current && currentUserId && current.userId === currentUserId)
      if (current && !ownedByCurrentUser) {
        this.conversation = null
        this.messages = []
        this.feedbacks = {}
      }
      else if (ownedByCurrentUser && current) {
        const currentProject = current.projectId ?? null
        const requestedProject = projectId === undefined ? currentProject : (projectId ?? null)
        if (currentProject === requestedProject) {
          return current
        }
      }
      const targetScene = resolveScene(options.scene)
      if (this.creatingConversation && this.creatingConversationRevision === this.loadRevision) {
        return this.creatingConversation
      }

      const creationRevision = this.loadRevision
      const requestConversation = async (scene: AiScene) => {
        const response = await aiApi.createConversation({ clientApp: 'c_app', scene, projectId }).send() as ApiEnvelope<{ conversation: ConversationRecord }>
        return response.data.conversation
      }
      const creation = (async () => {
        let conversation: ConversationRecord
        try {
          conversation = await requestConversation(targetScene)
        }
        catch (error) {
          if (targetScene === FALLBACK_SCENE || getApiErrorCode(error) !== 'AI_CONFIG_INVALID') {
            throw error
          }
          markSceneUnavailable(targetScene)
          conversation = await requestConversation(FALLBACK_SCENE)
        }

        if (creationRevision === this.loadRevision) {
          this.conversation = conversation
        }
        return conversation
      })()
      this.creatingConversation = creation
      this.creatingConversationRevision = creationRevision

      try {
        return await creation
      }
      finally {
        if (this.creatingConversation === creation) {
          this.creatingConversation = null
          this.creatingConversationRevision = -1
        }
      }
    },

    /** 加载会话详情（历史记录入口） */
    async loadConversation(id: string) {
      if (this.conversation?.id === id && this.loadState === 'ready') {
        return
      }

      this.cancelActiveStream(true)
      const loadRevision = ++this.loadRevision
      this.conversation = null
      this.messages = []
      this.feedbacks = {}
      this.loadState = 'loading'
      this.loadError = ''
      this.sendLock = false

      try {
        const response = await aiApi.getConversation(id).send() as ApiEnvelope<ConversationDetail>
        if (loadRevision !== this.loadRevision) {
          return
        }
        this.conversation = response.data.conversation
        this.messages = attachSourcesFromRetrievals(response.data.messages, response.data.retrievals || [])
        this.feedbacks = indexFeedbacks(response.data.feedbacks)
        this.loadState = 'ready'
      }
      catch (error) {
        if (loadRevision !== this.loadRevision) {
          return
        }
        this.loadState = 'error'
        this.loadError = error instanceof Error ? error.message : '会话加载失败'
        throw error
      }
    },

    /** 终止当前流并使迟到事件失效。 */
    cancelActiveStream(notifyBackend = false) {
      const messageId = this.streamingMessageId
      const abort = this.activeAbort

      this.streamRevision += 1
      this.isStreaming = false
      this.streamMode = 'stream'
      this.streamingMessageId = null
      this.progressStage = null
      this.progressMessage = null
      this.activeAbort = null
      abort?.()
      this.sendLock = false

      if (notifyBackend && messageId && !messageId.startsWith('local-')) {
        void aiApi.stopMessage(messageId).send().catch(() => undefined)
      }
    },

    /** 退出登录或切换账号：丢弃当前会话，避免下一个账号复用 conversationId。 */
    resetForAccountChange() {
      this.cancelActiveStream(false)
      this.$reset()
    },

    /** 开始新对话：仅重置本地状态，首次发送时再创建后端会话。 */
    newConversation() {
      this.cancelActiveStream(true)
      this.loadRevision += 1
      this.conversation = null
      this.messages = []
      this.feedbacks = {}
      this.loadState = 'ready'
      this.loadError = ''
      this.sendLock = false
    },

    async sendMessage(content: string, options: { projectId?: string, scene?: AiScene } = {}) {
      const authStore = useAuthStore()
      if (!authStore.accessToken) {
        throw new Error('请先登录')
      }
      if (this.isStreaming || this.sendLock || this.loadState === 'loading') {
        return false
      }

      this.sendLock = true
      const loadRevision = this.loadRevision
      this.loadError = ''
      console.log('[assistant] 步骤1 发送前检查通过，准备会话')
      try {
      const conversation = await this.ensureConversation(options)
      console.log('[assistant] 步骤2 会话就绪', { conversationId: conversation.id })
      if (loadRevision !== this.loadRevision || this.conversation?.id !== conversation.id) {
        return false
      }

      const userMessage: LocalMessage = {
        id: `local-user-${Date.now()}`,
        conversationId: conversation.id,
        userId: null,
        role: 'USER',
        content,
        status: 'COMPLETED',
        reasoningMode: 'OFF',
        createdAt: new Date().toISOString(),
      }
      const assistantMessage = createPlaceholderMessage(conversation.id, `local-assistant-${Date.now()}`)
      this.messages.push(userMessage, assistantMessage)
      const streamRevision = this.startStreaming(assistantMessage.id)
      console.log('[assistant] 步骤3 已插入乐观消息并开始流式', { streamRevision })

      const stream = createAiStreamRequest({
        kind: 'send',
        conversationId: conversation.id,
        content,
        accessToken: authStore.accessToken,
        onEvent: raw => this.handleStreamEvent(raw, streamRevision, conversation.id),
      })
      this.streamMode = stream.mode
      if (stream.mode === 'buffered') {
        this.progressMessage = '正在生成，完成后显示回答'
      }
      this.activeAbort = stream.abort
      console.log('[assistant] 步骤4 流请求已发起', { mode: stream.mode })

      void stream.promise.then(
        () => console.log('[assistant] 步骤5 流正常结束'),
        (error) => {
          if (streamRevision !== this.streamRevision) {
            console.warn('[assistant] 流错误已过期，忽略', { streamRevision, current: this.streamRevision })
            return
          }
          console.error('[assistant] 步骤5 流失败，捕捉到错误', error)
          const message = error instanceof Error ? error.message : 'AI 回答生成失败'
          this.loadError = message
          this.markStreamFailure(streamRevision, message)
        },
      )

      // 等待受理：被拒绝（内容受限等）时回滚乐观消息，错误抛给页面 Toast，不进入对话
      try {
        await stream.accepted
      }
      catch (error) {
        if (streamRevision !== this.streamRevision) {
          return false
        }
        console.error('[assistant] 请求被拒绝，回滚对话', error)
        this.messages = this.messages.filter(
          message => message.id !== userMessage.id && message.id !== assistantMessage.id,
        )
        this.finishStreaming(streamRevision)
        throw error instanceof Error ? error : new Error('发送失败，请重试')
      }
      return true
      }
      finally {
        this.sendLock = false
      }
    },

    /** 停止当前生成：立即停止本地展示，并尽力通知后端。 */
    async stopStreaming() {
      const messageId = this.streamingMessageId
      if (!this.isStreaming || !messageId) {
        return
      }

      const message = this.messages.find(item => item.id === messageId)
      if (message) {
        message.status = 'STOPPED'
        message.finishedAt = new Date().toISOString()
      }
      this.cancelActiveStream(true)
    },

    /** 重新生成指定 AI 回答：原位替换为流式占位。 */
    async regenerate(messageId: string) {
      const authStore = useAuthStore()
      if (!authStore.accessToken) {
        throw new Error('请先登录')
      }
      if (this.isStreaming || this.sendLock || this.loadState === 'loading') {
        return false
      }

      this.sendLock = true
      try {
      const index = this.messages.findIndex(message => message.id === messageId && message.role === 'ASSISTANT')
      if (index === -1 || !this.conversation) {
        return false
      }

      const conversationId = this.conversation.id
      const original = this.messages[index]
      const placeholder = createPlaceholderMessage(conversationId, `local-regen-${Date.now()}`)
      this.messages.splice(index, 1, placeholder)
      const streamRevision = this.startStreaming(placeholder.id)
      console.log('[assistant] 重新生成：占位替换并开始流式', { streamRevision })

      const stream = createAiStreamRequest({
        kind: 'regenerate',
        messageId,
        accessToken: authStore.accessToken,
        onEvent: raw => this.handleStreamEvent(raw, streamRevision, conversationId),
      })
      this.streamMode = stream.mode
      if (stream.mode === 'buffered') {
        this.progressMessage = '正在生成，完成后显示回答'
      }
      this.activeAbort = stream.abort

      void stream.promise.catch((error) => {
        if (streamRevision !== this.streamRevision) {
          return
        }
        console.error('[assistant] 重新生成流失败', error)
        const message = error instanceof Error ? error.message : '重新生成失败'
        this.loadError = message
        this.markStreamFailure(streamRevision, message)
      })

      // 等待受理：被拒绝时恢复原回答，错误抛给页面 Toast
      try {
        await stream.accepted
      }
      catch (error) {
        if (streamRevision !== this.streamRevision) {
          return false
        }
        console.error('[assistant] 重新生成被拒绝，恢复原回答', error)
        const placeholderIndex = this.messages.findIndex(message => message.id === placeholder.id)
        if (placeholderIndex !== -1) {
          this.messages.splice(placeholderIndex, 1, original)
        }
        this.finishStreaming(streamRevision)
        throw error instanceof Error ? error : new Error('重新生成失败，请重试')
      }
      return true
      }
      finally {
        this.sendLock = false
      }
    },

    async feedback(messageId: string, reaction: AiFeedbackReaction | null, options: { tags?: string[], content?: string } = {}) {
      const response = await aiApi.feedbackMessage(messageId, {
        reaction,
        tags: options.tags,
        content: options.content,
        clientApp: 'c_app',
      }).send() as ApiEnvelope<{ feedback: AiMessageFeedback }>
      const feedback = response.data.feedback
      this.feedbacks[feedback.messageId] = [feedback]
      return feedback
    },

    /** SSE 事件统一入口（send / regenerate 共用）。 */
    handleStreamEvent(raw: AiStreamEvent, streamRevision: number, conversationId: string) {
      if (streamRevision !== this.streamRevision || this.conversation?.id !== conversationId) {
        return
      }

      const payload = parseStreamEvent(raw.event, raw.data)
      if (!payload) {
        return
      }

      switch (payload.event) {
        case 'message': {
          const { messageId, userMessageId } = payload.data
          const placeholder = this.messages.find(message => message.id === this.streamingMessageId)
          if (placeholder && placeholder.id.startsWith('local-')) {
            placeholder.id = messageId
          }
          else if (!this.messages.some(message => message.id === messageId)) {
            this.messages.push(createPlaceholderMessage(payload.data.conversationId, messageId))
          }
          if (userMessageId) {
            const userPlaceholder = this.messages.find(
              message => message.role === 'USER' && message.id.startsWith('local-user-'),
            )
            if (userPlaceholder) {
              userPlaceholder.id = userMessageId
            }
          }
          this.streamingMessageId = messageId
          break
        }
        case 'progress': {
          this.progressStage = payload.data.stage
          this.progressMessage = payload.data.message
          break
        }
        case 'delta': {
          const message = this.messages.find(item => item.id === this.streamingMessageId)
          if (message) {
            message.content += payload.data.text
          }
          break
        }
        case 'done': {
          const message = this.messages.find(item => item.id === payload.data.messageId)
          if (message) {
            message.status = 'COMPLETED'
            message.finishedAt = new Date().toISOString()
            message.sources = normalizeAiSources(payload.data.sources)
            message.model = payload.data.model?.id ?? null
          }
          this.finishStreaming(streamRevision)
          break
        }
        case 'stopped': {
          const message = this.messages.find(item => item.id === payload.data.messageId)
          if (message) {
            message.status = 'STOPPED'
            message.content = payload.data.content || message.content
            message.finishedAt = new Date().toISOString()
          }
          this.finishStreaming(streamRevision)
          break
        }
        case 'error': {
          const message = this.messages.find(item => item.id === this.streamingMessageId)
          if (message) {
            message.status = 'FAILED'
            message.errorMessage = payload.data.message
            message.finishedAt = new Date().toISOString()
          }
          this.finishStreaming(streamRevision)
          break
        }
      }
    },

    startStreaming(messageId: string) {
      const streamRevision = ++this.streamRevision
      this.isStreaming = true
      this.streamingMessageId = messageId
      this.progressStage = null
      this.progressMessage = null
      return streamRevision
    },

    finishStreaming(streamRevision: number) {
      if (streamRevision !== this.streamRevision) {
        return
      }
      this.isStreaming = false
      this.streamMode = 'stream'
      this.streamingMessageId = null
      this.progressStage = null
      this.progressMessage = null
      this.activeAbort = null
      this.streamRevision += 1
      this.sendLock = false
    },

    /** 网络层失败且未收到完成事件时，把当前流式消息标记失败。 */
    markStreamFailure(streamRevision: number, errorMessage?: string) {
      if (streamRevision !== this.streamRevision) {
        return
      }
      const messageId = this.streamingMessageId
      if (messageId) {
        const message = this.messages.find(item => item.id === messageId)
        if (message) {
          message.status = 'FAILED'
          message.errorMessage = errorMessage || message.errorMessage || '网络异常，请重试'
          message.finishedAt = new Date().toISOString()
        }
      }
      this.finishStreaming(streamRevision)
    },
  },
})

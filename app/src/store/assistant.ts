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
import { aiApi } from '@/api/modules/ai'
import { createAiStreamRequest } from '@/services/platform'
import { useAuthStore } from '@/store/auth'

/**
 * 跨 Tab 一次性导航上下文。
 * Tab 切换不可靠传递 query 的平台（小程序/App），
 * 由 useAssistantNavigation 写入、筑小格页面消费后清理。
 */
export interface AssistantNavContext {
  conversationId?: string
  scene?: string
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
          sources: Array.isArray(data.sources) ? data.sources as AiSourceRef[] : [],
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
  }),

  getters: {
    /** 会话是否可发送：已加载（含新建空会话）且不在流式 */
    canSend: state => state.loadState !== 'loading' && !state.isStreaming,
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
     * 获取可用会话：当前会话匹配则复用，否则创建。
     * projectId 用于项目关联会话；同一项目内复用，切换项目自动开新会话。
     */
    async ensureConversation(options: { projectId?: string, scene?: AiScene } = {}): Promise<ConversationRecord> {
      const { projectId, scene = 'general_chat' } = options
      const current = this.conversation
      if (current && current.projectId === (projectId ?? null)) {
        return current
      }
      if (this.creatingConversation && this.creatingConversationRevision === this.loadRevision) {
        return this.creatingConversation
      }

      const creationRevision = this.loadRevision
      const creation = (async () => {
        const response = await aiApi.createConversation({ clientApp: 'c_app', scene, projectId }).send() as ApiEnvelope<{ conversation: ConversationRecord }>
        const conversation = response.data.conversation
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

      try {
        const response = await aiApi.getConversation(id).send() as ApiEnvelope<ConversationDetail>
        if (loadRevision !== this.loadRevision) {
          return
        }
        this.conversation = response.data.conversation
        this.messages = response.data.messages
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

      if (notifyBackend && messageId && !messageId.startsWith('local-')) {
        void aiApi.stopMessage(messageId).send().catch(() => undefined)
      }
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
    },

    async sendMessage(content: string, options: { projectId?: string, scene?: AiScene } = {}) {
      const authStore = useAuthStore()
      if (!authStore.accessToken) {
        throw new Error('请先登录')
      }
      if (this.isStreaming || this.loadState === 'loading') {
        return false
      }

      const loadRevision = this.loadRevision
      this.loadError = ''
      const conversation = await this.ensureConversation(options)
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

      void stream.promise.catch((error) => {
        if (streamRevision !== this.streamRevision) {
          return
        }
        this.loadError = error instanceof Error ? error.message : 'AI 回答生成失败'
        this.markStreamFailure(streamRevision)
      })
      return true
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
      if (this.isStreaming || this.loadState === 'loading') {
        return false
      }

      const index = this.messages.findIndex(message => message.id === messageId && message.role === 'ASSISTANT')
      if (index === -1 || !this.conversation) {
        return false
      }

      const conversationId = this.conversation.id
      const placeholder = createPlaceholderMessage(conversationId, `local-regen-${Date.now()}`)
      this.messages.splice(index, 1, placeholder)
      const streamRevision = this.startStreaming(placeholder.id)

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
        this.loadError = error instanceof Error ? error.message : '重新生成失败'
        this.markStreamFailure(streamRevision)
      })
      return true
    },

    async feedback(messageId: string, reaction: AiFeedbackReaction | null) {
      const response = await aiApi.feedbackMessage(messageId, { reaction, clientApp: 'c_app' }).send() as ApiEnvelope<{ feedback: AiMessageFeedback }>
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
          const { messageId } = payload.data
          const placeholder = this.messages.find(message => message.id === this.streamingMessageId)
          if (placeholder && placeholder.id.startsWith('local-')) {
            placeholder.id = messageId
          }
          else if (!this.messages.some(message => message.id === messageId)) {
            this.messages.push(createPlaceholderMessage(payload.data.conversationId, messageId))
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
            message.sources = payload.data.sources
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
    },

    /** 网络层失败且未收到完成事件时，把当前流式消息标记失败。 */
    markStreamFailure(streamRevision: number) {
      if (streamRevision !== this.streamRevision) {
        return
      }
      const messageId = this.streamingMessageId
      if (messageId) {
        const message = this.messages.find(item => item.id === messageId)
        if (message) {
          message.status = 'FAILED'
          message.errorMessage = message.errorMessage || '网络异常，请重试'
          message.finishedAt = new Date().toISOString()
        }
      }
      this.finishStreaming(streamRevision)
    },
  },
})

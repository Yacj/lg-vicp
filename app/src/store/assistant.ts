import type {
  AgentRunDto,
  AiFeedbackReaction,
  AiMessageFeedback,
  AiScene,
  AiSourceRef,
  ApiEnvelope,
  ApiPage,
  ConversationDetail,
  ConversationListItem,
  ConversationMessage,
  ConversationRecord,
  DownloadUrlResult,
  MessageAttachment,
  ReportDetail,
  ReportItem,
} from '@/api/types'
import type { AiStreamEvent } from '@/services/platform'
import type { AgentToolStep, ParsedNeedInput, SessionReport } from '@/utils/aiAgentUi'
import type { ProductCardItem, ProductComparisonView } from '@/utils/aiComparison'
import { defineStore } from 'pinia'
import { getApiErrorCode } from '@/api/core/handlers'
import { aiApi } from '@/api/modules/ai'
import { fileApi } from '@/api/modules/files'
import { reportApi } from '@/api/modules/reports'
import { FALLBACK_SCENE, markSceneUnavailable, resolveScene } from '@/constants/aiScene'
import { VISION_FAILURE_MESSAGE } from '@/constants/chatImage'
import { createAiStreamRequest } from '@/services/platform'
import { useAuthStore } from '@/store/auth'
import {
  agentActiveLabel,
  applyToolResult,
  applyToolStart,
  isProductSelection,
  isReportTool,
  parseNeedUserInput,
  reportTitleFromUnknown,
} from '@/utils/aiAgentUi'
import {
  appendAssistantDelta,
  DEFAULT_STATUS_COPY,
  REPORT_STATUS_COPY,
  resolveComparisonAttachAction,
  restoreAssistantContent,
  shouldAttachProductCards,
} from '@/utils/aiAnswerUx'
import {
  parseProductCards,
  parseProductComparison,
  selectedProductNames,
} from '@/utils/aiComparison'
import {
  isInProgressReportStatus,
  isTerminalReportStatus,
  mapReportTaskStatus,
  REPORT_COMPLETED_MESSAGE,
  reportTaskTitle,
  shouldPollReportStatus,
} from '@/utils/aiReportTask'
import { normalizeAiSources, sourceFromRetrieval } from '@/utils/aiSource'
import { parseStreamEvent } from '@/utils/aiStream'
import {
  canConfirmSelection,
  fromParsedWaiting,
  nextSelectedIds,
  selectionResumeAction,
} from '@/utils/aiUserSelection'
import { isVisionFailure, visionFailureMessage } from '@/utils/aiVision'

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
  startNew?: boolean
}

/** 会话消息的本地扩展字段（来源、过程状态不落库） */
export interface LocalMessage extends ConversationMessage {
  sources?: AiSourceRef[]
  products?: ProductCardItem[]
  comparison?: ProductComparisonView
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
  sendLock: boolean
  pendingProjectId: string | null
  pendingProjectName: string | null
  showMemoryHint: boolean
  activeAgentRun: AgentRunDto | null
  pendingUserInput: ParsedNeedInput | null
  toolSteps: AgentToolStep[]
  sessionReport: SessionReport | null
  reconnecting: boolean
  pendingCancel: boolean
  comparisonView: ProductComparisonView | null
  productCards: ProductCardItem[]
  selectionSelectedIds: string[]
  reportPageVisible: boolean
  retryingReport: boolean
}

let recoverTimer: ReturnType<typeof setTimeout> | null = null
let recoverGeneration = 0
let reportPollTimer: ReturnType<typeof setTimeout> | null = null
let reportPollGeneration = 0

function clearRecoverTimer() {
  recoverGeneration += 1
  if (recoverTimer) {
    clearTimeout(recoverTimer)
    recoverTimer = null
  }
}

function clearReportPoll() {
  reportPollGeneration += 1
  if (reportPollTimer) {
    clearTimeout(reportPollTimer)
    reportPollTimer = null
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
  return messages
    .filter(message => message.role !== 'SYSTEM')
    .map((message) => {
      const sources = sourcesByMessage.get(message.id)
      const content = message.role === 'ASSISTANT'
        ? restoreAssistantContent(message.content)
        : message.content
      return {
        ...message,
        content,
        ...(sources?.length ? { sources: normalizeAiSources(sources) } : {}),
      }
    })
}

function toSessionReport(report: ReportItem | undefined | null): SessionReport | null {
  if (!report) {
    return null
  }
  const status = mapReportTaskStatus(report.status)
  return {
    id: report.id,
    projectId: report.projectId,
    title: reportTitleFromUnknown(report, reportTaskTitle(status)),
    status,
  }
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
    pendingProjectId: null,
    pendingProjectName: null,
    showMemoryHint: false,
    activeAgentRun: null,
    pendingUserInput: null,
    toolSteps: [],
    sessionReport: null,
    reconnecting: false,
    pendingCancel: false,
    comparisonView: null,
    productCards: [],
    selectionSelectedIds: [],
    reportPageVisible: true,
    retryingReport: false,
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
    projectId: state => state.conversation?.projectId ?? state.pendingProjectId,
    hasLiveStream: state => Boolean(state.activeAbort),
    waitingForUser: state => Boolean(state.pendingUserInput && !state.pendingUserInput.hidden),
    comparisonSelectedIds: state => state.selectionSelectedIds,
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
      const projectId = options.projectId ?? this.pendingProjectId ?? undefined
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
          this.pendingProjectId = conversation.projectId
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

    /** 加载会话详情（历史记录入口 / 断线恢复） */
    async loadConversation(id: string, options: { force?: boolean } = {}) {
      if (this.conversation?.id === id && this.loadState === 'ready' && !options.force) {
        await this.recoverActiveRun()
        return
      }

      if (this.conversation?.id !== id) {
        this.cancelActiveStream(true)
        this.selectionSelectedIds = []
        this.comparisonView = null
        this.productCards = []
      }
      else {
        this.stopReconnect()
      }
      const loadRevision = ++this.loadRevision
      if (!options.force) {
        this.conversation = null
        this.messages = []
        this.feedbacks = {}
      }
      this.loadState = options.force && this.messages.length ? this.loadState : 'loading'
      this.loadError = ''
      this.sendLock = false
      this.pendingCancel = false
      this.sessionReport = null

      try {
        const response = await aiApi.getConversation(id).send() as ApiEnvelope<ConversationDetail>
        if (loadRevision !== this.loadRevision) {
          return
        }
        this.conversation = response.data.conversation
        this.messages = attachSourcesFromRetrievals(response.data.messages, response.data.retrievals || [])
        this.feedbacks = indexFeedbacks(response.data.feedbacks)
        this.pendingProjectId = response.data.conversation.projectId
        this.loadState = 'ready'
        this.applyAgentRun(response.data.activeAgentRun ?? null, { fromHistory: true })
        this.restoreSessionReport(response.data.reports)
        void this.hydrateAttachmentPreviews(this.messages)
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

    applyAgentRun(run: AgentRunDto | null, options: { fromHistory?: boolean } = {}) {
      this.activeAgentRun = run
      if (!run) {
        if (options.fromHistory) {
          this.pendingUserInput = null
          this.reconnecting = false
        }
        return
      }

      if (run.status === 'WAITING_USER_INPUT') {
        this.stopReconnect()
        this.isStreaming = false
        this.reconnecting = false
        this.applyWaitingPayload({
          runId: run.id,
          prompt: run.waiting?.prompt || run.waitingPrompt || '请确认后继续',
          title: run.waiting?.title,
          description: run.waiting?.description,
          type: run.waiting?.type,
          selectionKind: run.waiting?.selectionKind,
          options: run.waiting?.options || run.waitingOptions || [],
          multiple: run.waiting?.multiple,
          minSelections: run.waiting?.minSelections,
          maxSelections: run.waiting?.maxSelections,
          autoSelectWhenSingle: run.waiting?.autoSelectWhenSingle,
          confirmAction: run.waiting?.confirmAction,
          comparisonResult: run.waiting?.comparisonResult,
          request: run.waiting?.request,
        })
        return
      }

      if (run.status === 'RUNNING') {
        this.pendingUserInput = null
        this.startReconnect(run.id)
        return
      }

      this.pendingUserInput = null
      this.reconnecting = false
      if (run.status === 'FAILED') {
        this.loadError = run.errorMessage || '任务失败，请重试'
        const last = [...this.messages].reverse().find(item => item.role === 'ASSISTANT')
        if (last && last.status !== 'COMPLETED') {
          last.status = 'FAILED'
          last.errorMessage = run.errorMessage || '任务失败，请重试'
        }
      }
    },

    applyWaitingPayload(payload: {
      runId: string
      prompt?: string
      title?: string
      description?: string
      type?: string
      selectionKind?: string
      options?: unknown
      multiple?: boolean
      minSelections?: number
      maxSelections?: number
      autoSelectWhenSingle?: boolean
      confirmAction?: unknown
      comparisonResult?: unknown
      request?: unknown
    }) {
      this.pendingUserInput = parseNeedUserInput(payload)
      const waiting = this.pendingUserInput
      if (!waiting) {
        return
      }
      this.progressMessage = waiting.mode === 'selection'
        ? waiting.title || waiting.prompt
        : waiting.prompt || '需要你确认后继续'

      const validIds = new Set(waiting.options.map(item => item.id))
      this.selectionSelectedIds = this.selectionSelectedIds.filter(id => validIds.has(id))

      if (isProductSelection(waiting)) {
        const view = parseProductComparison(waiting.comparisonResult) || this.comparisonView
        if (view) {
          this.comparisonView = view
          this.attachArtifactsToLatestAssistant({ comparison: view })
        }
        if (!this.productCards.length && view) {
          this.productCards = view.products
        }
      }

      if (waiting.hidden && waiting.options[0]?.id) {
        this.selectionSelectedIds = [waiting.options[0].id]
        void this.confirmSelection({ silent: true })
      }
    },

    attachArtifactsToLatestAssistant(payload: { products?: ProductCardItem[], comparison?: ProductComparisonView }) {
      const target = this.messages.find(item => item.id === this.streamingMessageId)
        || [...this.messages].reverse().find(item => item.role === 'ASSISTANT')
      if (!target) {
        return
      }
      if (payload.products?.length && shouldAttachProductCards(payload.products, this.messages)) {
        target.products = payload.products
        this.productCards = payload.products
      }
      if (payload.comparison) {
        this.applyComparisonArtifact(payload.comparison, target)
      }
    },

    applyComparisonArtifact(view: ProductComparisonView, target?: LocalMessage) {
      const latest = target
        || this.messages.find(item => item.id === this.streamingMessageId)
        || [...this.messages].reverse().find(item => item.role === 'ASSISTANT')
      const action = resolveComparisonAttachAction(view, this.messages, latest?.id)
      if (action === 'skip') {
        this.comparisonView = this.messages.find(item => item.comparison?.comparisonId === view.comparisonId)?.comparison || view
        return
      }
      if (action === 'replace') {
        for (const message of this.messages) {
          if (message.comparison?.comparisonId === view.comparisonId && message.id !== latest?.id) {
            message.comparison = undefined
          }
        }
      }
      if (!latest) {
        this.comparisonView = view
        return
      }
      latest.comparison = view
      latest.sources = normalizeAiSources([
        ...(latest.sources || []),
        ...view.sources.map(item => item.source || { title: item.label, sectionTitle: item.typeLabel }),
      ])
      this.comparisonView = view
      this.productCards = view.products
    },

    toggleSelection(optionId: string) {
      const waiting = this.pendingUserInput
      if (!waiting || waiting.hidden || this.sendLock || this.isStreaming) {
        return
      }
      if (waiting.mode !== 'selection' && waiting.mode !== 'choice') {
        return
      }
      const exists = waiting.options.some(item => item.id === optionId && !item.disabled)
      if (!exists) {
        return
      }
      this.selectionSelectedIds = nextSelectedIds(this.selectionSelectedIds, optionId, fromParsedWaiting(waiting))
    },

    toggleComparisonSelection(optionId: string) {
      this.toggleSelection(optionId)
    },

    stopReconnect() {
      clearRecoverTimer()
      this.reconnecting = false
    },

    startReconnect(runId: string) {
      this.stopReconnect()
      this.reconnecting = true
      this.isStreaming = true
      this.progressMessage = this.progressMessage || '正在继续生成…'
      const last = [...this.messages].reverse().find(item => item.role === 'ASSISTANT')
      if (last) {
        this.streamingMessageId = last.id
        if (last.status !== 'FAILED' && last.status !== 'STOPPED') {
          last.status = 'STREAMING'
        }
      }
      const generation = recoverGeneration
      const poll = async () => {
        if (generation !== recoverGeneration || this.hasLiveStream) {
          return
        }
        try {
          const response = await aiApi.getAgentRun(runId).send() as ApiEnvelope<{ run: AgentRunDto | null }>
          const run = response.data.run
          if (!run || run.status === 'RUNNING') {
            this.progressMessage = '正在继续生成…'
            recoverTimer = setTimeout(() => {
              void poll()
            }, 2000)
            return
          }
          const conversationId = this.conversation?.id
          if (conversationId) {
            await this.loadConversation(conversationId, { force: true })
          }
          if (run.status === 'FAILED') {
            this.loadError = run.errorMessage || '任务失败，请重试'
          }
        }
        catch {
          recoverTimer = setTimeout(() => {
            void poll()
          }, 3000)
        }
      }
      recoverTimer = setTimeout(() => {
        void poll()
      }, 400)
    },

    /** 重新进入会话：查 active run，按状态恢复，不新建 Conversation。 */
    async recoverActiveRun() {
      const conversationId = this.conversation?.id
      if (!conversationId || this.hasLiveStream) {
        return
      }
      try {
        const response = await aiApi.getActiveAgentRun(conversationId).send() as ApiEnvelope<{ run: AgentRunDto | null }>
        const run = response.data.run
        if (run) {
          this.applyAgentRun(run, { fromHistory: true })
        }
        else {
          const last = this.messages[this.messages.length - 1]
          this.pendingUserInput = null
          this.activeAgentRun = null
          this.reconnecting = false
          if (last?.role === 'ASSISTANT' && (last.status === 'STREAMING' || last.status === 'PENDING')) {
            await this.loadConversation(conversationId, { force: true })
          }
        }
        void this.hydrateAttachmentPreviews(this.messages)
      }
      catch {
        // 恢复失败不打断已展示的历史消息
      }
    },

    async continueProjectConversation(projectId: string, projectName?: string) {
      this.pendingProjectName = projectName || this.pendingProjectName
      if (this.conversation?.id && (this.conversation.projectId ?? null) === projectId) {
        this.pendingProjectId = projectId
        await this.recoverActiveRun()
        return
      }
      const response = await aiApi.listConversations({
        projectId,
        clientApp: 'c_app',
        page: 1,
        pageSize: 1,
      }).send() as ApiEnvelope<ApiPage<ConversationListItem>>
      const latest = response.data?.items?.[0]
      if (latest) {
        await this.loadConversation(latest.id)
        return
      }
      this.newConversation({ projectId, projectName, memoryHint: true })
    },

    /** 终止当前流并使迟到事件失效。notifyBackend 时同时取消 Agent Run。 */
    cancelActiveStream(notifyBackend = false) {
      const messageId = this.streamingMessageId
      const abort = this.activeAbort
      this.stopReconnect()

      this.streamRevision += 1
      this.isStreaming = false
      this.streamMode = 'stream'
      this.streamingMessageId = null
      this.progressStage = null
      this.progressMessage = null
      this.activeAbort = null
      this.toolSteps = []
      abort?.()
      this.sendLock = false

      if (notifyBackend && messageId && !messageId.startsWith('local-')) {
        void aiApi.stopMessage(messageId).send().catch(() => undefined)
      }
    },

    /** 退出登录或切换账号：丢弃当前会话，避免下一个账号复用 conversationId。 */
    resetForAccountChange() {
      this.stopReportPolling()
      this.cancelActiveStream(false)
      this.$reset()
    },

    /** 开始新对话：仅重置本地状态，首次发送时再创建后端会话。 */
    newConversation(options: { projectId?: string, projectName?: string, memoryHint?: boolean } = {}) {
      this.cancelActiveStream(true)
      this.loadRevision += 1
      this.conversation = null
      this.messages = []
      this.feedbacks = {}
      this.loadState = 'ready'
      this.loadError = ''
      this.sendLock = false
      this.pendingCancel = false
      this.pendingUserInput = null
      this.activeAgentRun = null
      this.toolSteps = []
      this.sessionReport = null
      this.comparisonView = null
      this.productCards = []
      this.selectionSelectedIds = []
      this.retryingReport = false
      this.stopReportPolling()
      this.pendingProjectId = options.projectId ?? null
      this.pendingProjectName = options.projectName ?? null
      this.showMemoryHint = Boolean(options.memoryHint && options.projectId)
    },

    async sendMessage(content: string, options: { projectId?: string, scene?: AiScene, attachmentFileIds?: string[], localAttachments?: MessageAttachment[] } = {}) {
      if (this.pendingUserInput && !options.attachmentFileIds?.length) {
        return this.resumeAgent(content)
      }

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
      try {
        const conversation = await this.ensureConversation({
          ...options,
          projectId: options.projectId ?? this.pendingProjectId ?? undefined,
        })
        if (loadRevision !== this.loadRevision || this.conversation?.id !== conversation.id) {
          return false
        }

        const attachmentFileIds = options.attachmentFileIds?.filter(Boolean) || []
        const userMessage: LocalMessage = {
          id: `local-user-${Date.now()}`,
          conversationId: conversation.id,
          userId: null,
          role: 'USER',
          content,
          status: 'COMPLETED',
          reasoningMode: 'OFF',
          createdAt: new Date().toISOString(),
          attachments: options.localAttachments?.length
            ? options.localAttachments
            : attachmentFileIds.map((fileId, index) => ({
                id: `local-att-${fileId}`,
                fileId,
                attachmentType: 'IMAGE',
                sortOrder: index,
              })),
        }
        const assistantMessage = createPlaceholderMessage(conversation.id, `local-assistant-${Date.now()}`)
        this.messages.push(userMessage, assistantMessage)
        this.showMemoryHint = false
        const streamRevision = this.startStreaming(assistantMessage.id)

        const stream = createAiStreamRequest({
          kind: 'send',
          conversationId: conversation.id,
          content,
          attachmentFileIds: attachmentFileIds.length ? attachmentFileIds : undefined,
          accessToken: authStore.accessToken,
          onEvent: raw => this.handleStreamEvent(raw, streamRevision, conversation.id),
        })
        this.streamMode = stream.mode
        if (stream.mode === 'buffered') {
          this.progressMessage = '正在生成，完成后显示回答'
        }
        this.activeAbort = stream.abort

        void stream.promise.then(
          () => undefined,
          (error) => {
            if (streamRevision !== this.streamRevision) {
              return
            }
            const message = isVisionFailure(error) ? VISION_FAILURE_MESSAGE : (error instanceof Error ? error.message : 'AI 回答生成失败')
            this.loadError = isVisionFailure(error) ? '' : message
            this.markStreamFailure(streamRevision, message)
          },
        )

        try {
          await stream.accepted
        }
        catch (error) {
          if (streamRevision !== this.streamRevision) {
            return false
          }
          if (isVisionFailure(error)) {
            const failed = this.messages.find(message => message.id === assistantMessage.id)
            if (failed) {
              failed.status = 'FAILED'
              failed.errorMessage = visionFailureMessage(error)
              failed.finishedAt = new Date().toISOString()
            }
            this.finishStreaming(streamRevision)
            return true
          }
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

    /** 恢复 WAITING_USER_INPUT：关联原 Agent Run，不新建无关任务。 */
    async resumeAgent(content: string) {
      const waiting = this.pendingUserInput
      const authStore = useAuthStore()
      if (!waiting || !authStore.accessToken) {
        return false
      }
      if (this.isStreaming || this.sendLock || this.loadState === 'loading') {
        return false
      }
      if (!this.conversation) {
        return false
      }

      this.sendLock = true
      this.loadError = ''
      const conversationId = this.conversation.id
      const agentRunId = waiting.runId
      try {
        const userMessage: LocalMessage = {
          id: `local-user-${Date.now()}`,
          conversationId,
          userId: null,
          role: 'USER',
          content,
          status: 'COMPLETED',
          reasoningMode: 'OFF',
          createdAt: new Date().toISOString(),
        }
        const assistantMessage = createPlaceholderMessage(conversationId, `local-assistant-${Date.now()}`)
        this.messages.push(userMessage, assistantMessage)
        this.pendingUserInput = null
        this.showMemoryHint = false
        const streamRevision = this.startStreaming(assistantMessage.id)

        const stream = createAiStreamRequest({
          kind: 'resume',
          agentRunId,
          conversationId,
          content,
          accessToken: authStore.accessToken,
          onEvent: raw => this.handleStreamEvent(raw, streamRevision, conversationId),
        })
        this.streamMode = stream.mode
        if (stream.mode === 'buffered') {
          this.progressMessage = '正在根据你的选择继续'
        }
        this.activeAbort = stream.abort

        void stream.promise.catch((error) => {
          if (streamRevision !== this.streamRevision) {
            return
          }
          const message = error instanceof Error ? error.message : '继续任务失败'
          this.loadError = message
          this.markStreamFailure(streamRevision, message)
        })

        try {
          await stream.accepted
        }
        catch (error) {
          if (streamRevision !== this.streamRevision) {
            return false
          }
          this.messages = this.messages.filter(
            message => message.id !== userMessage.id && message.id !== assistantMessage.id,
          )
          this.pendingUserInput = waiting
          this.finishStreaming(streamRevision)
          throw error instanceof Error ? error : new Error('继续任务失败，请重试')
        }
        return true
      }
      finally {
        this.sendLock = false
      }
    },

    /** 统一 USER_SELECTION 确认。silent 用于单选项自动确认，不插入系统味文本。 */
    async confirmSelection(options: { silent?: boolean } = {}) {
      const waiting = this.pendingUserInput
      const authStore = useAuthStore()
      if (!waiting || (waiting.mode !== 'selection' && waiting.mode !== 'choice') || !authStore.accessToken || !this.conversation) {
        return false
      }
      const request = fromParsedWaiting(waiting)
      const selectedIds = waiting.hidden && waiting.options[0]?.id
        ? [waiting.options[0].id]
        : [...this.selectionSelectedIds]
      if (!canConfirmSelection(selectedIds.length, request) || this.isStreaming || this.sendLock || this.loadState === 'loading') {
        return false
      }

      this.sendLock = true
      this.loadError = ''
      const conversationId = this.conversation.id
      const agentRunId = waiting.runId
      const confirmLabel = request.confirmAction.label
      const silent = Boolean(options.silent) || waiting.hidden
      const generateReport = request.confirmAction.type === 'GENERATE_REPORT' || request.selectionKind === 'PRODUCT'
      const basedOn = waiting.options.filter(item => selectedIds.includes(item.id)).map(item => item.label)
      try {
        let userMessage: LocalMessage | null = null
        if (!silent && request.selectionKind !== 'KNOWLEDGE_SOURCE') {
          userMessage = {
            id: `local-user-${Date.now()}`,
            conversationId,
            userId: null,
            role: 'USER',
            content: confirmLabel,
            status: 'COMPLETED',
            reasoningMode: 'OFF',
            createdAt: new Date().toISOString(),
          }
        }
        const assistantMessage = createPlaceholderMessage(conversationId, `local-assistant-${Date.now()}`)
        if (userMessage) {
          this.messages.push(userMessage, assistantMessage)
        }
        else {
          this.messages.push(assistantMessage)
        }
        this.pendingUserInput = null
        this.showMemoryHint = false
        const streamRevision = this.startStreaming(assistantMessage.id)
        if (generateReport) {
          this.applyReportTask({
            id: '',
            projectId: this.conversation.projectId,
            status: 'QUEUED',
            basedOn,
          })
        }

        const stream = createAiStreamRequest({
          kind: 'resume',
          agentRunId,
          conversationId,
          content: silent ? '' : confirmLabel,
          selectedIds,
          optionIds: selectedIds,
          selectedProductIds: request.selectionKind === 'PRODUCT' ? selectedIds : undefined,
          selectionKind: request.selectionKind,
          action: selectionResumeAction(request),
          confirmAction: request.confirmAction.type,
          accessToken: authStore.accessToken,
          onEvent: raw => this.handleStreamEvent(raw, streamRevision, conversationId),
        })
        this.streamMode = stream.mode
        this.activeAbort = stream.abort

        void stream.promise.catch((error) => {
          if (streamRevision !== this.streamRevision) {
            return
          }
          const message = error instanceof Error ? error.message : '继续任务失败'
          this.loadError = message
          this.markStreamFailure(streamRevision, message)
        })

        try {
          await stream.accepted
        }
        catch (error) {
          if (streamRevision !== this.streamRevision) {
            return false
          }
          this.messages = this.messages.filter(
            message => message.id !== assistantMessage.id && message.id !== userMessage?.id,
          )
          this.pendingUserInput = waiting
          if (generateReport) {
            this.sessionReport = null
          }
          this.finishStreaming(streamRevision)
          throw error instanceof Error ? error : new Error('继续任务失败，请重试')
        }
        return true
      }
      finally {
        this.sendLock = false
      }
    },

    async confirmComparisonReport() {
      return this.confirmSelection()
    },

    /** 停止当前生成：取消本地流，并调用 Backend 停止（同时取消 Agent Run）。 */
    async stopStreaming() {
      const messageId = this.streamingMessageId
      if (!this.isStreaming && !this.reconnecting) {
        return
      }

      const message = this.messages.find(item => item.id === messageId)
      if (message) {
        message.status = 'STOPPED'
        message.finishedAt = new Date().toISOString()
      }

      const liveMessageId = messageId && !messageId.startsWith('local-')
        ? messageId
        : [...this.messages].reverse().find(item => item.role === 'ASSISTANT' && !item.id.startsWith('local-'))?.id
      const abort = this.activeAbort
      abort?.()
      this.pendingCancel = !liveMessageId
      this.cancelActiveStream(false)
      if (liveMessageId) {
        await aiApi.stopMessage(liveMessageId).send().catch(() => undefined)
      }
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

        const stream = createAiStreamRequest({
          kind: 'regenerate',
          messageId,
          reason: '重新生成',
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
          const message = error instanceof Error ? error.message : '重新生成失败'
          this.loadError = message
          this.markStreamFailure(streamRevision, message)
        })

        try {
          await stream.accepted
        }
        catch (error) {
          if (streamRevision !== this.streamRevision) {
            return false
          }
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

    /** SSE 事件统一入口（send / regenerate / resume 共用）。 */
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
          if (this.pendingCancel) {
            this.pendingCancel = false
            void aiApi.stopMessage(messageId).send().catch(() => undefined)
          }
          break
        }
        case 'progress': {
          this.progressStage = payload.data.stage
          this.progressMessage = agentActiveLabel(null, payload.data.message)
          break
        }
        case 'agent_status': {
          if (payload.data.runId) {
            this.activeAgentRun = {
              ...(this.activeAgentRun || { id: payload.data.runId, conversationId, status: 'RUNNING' }),
              id: payload.data.runId,
              conversationId,
              status: 'RUNNING',
            }
          }
          this.progressMessage = agentActiveLabel(payload.data.toolName, payload.data.message)
          this.toolSteps = applyToolStart(this.toolSteps, payload.data.toolName, payload.data.message)
          break
        }
        case 'tool_start': {
          this.progressMessage = agentActiveLabel(payload.data.toolName, payload.data.message || this.progressMessage)
          this.toolSteps = applyToolStart(this.toolSteps, payload.data.toolName, payload.data.message)
          break
        }
        case 'tool_result': {
          this.toolSteps = applyToolResult(this.toolSteps, payload.data.toolName, payload.data.success)
          if (payload.data.success && isReportTool(payload.data.toolName) && !this.sessionReport?.id) {
            this.progressMessage = REPORT_STATUS_COPY
          }
          else if (payload.data.success && !isInProgressReportStatus(this.sessionReport?.status)) {
            this.progressMessage = DEFAULT_STATUS_COPY
          }
          break
        }
        case 'comparison_ready': {
          const view = parseProductComparison(payload.data.comparisonResult)
          if (view) {
            this.applyComparisonArtifact(view)
          }
          break
        }
        case 'product_cards': {
          const products = parseProductCards(payload.data.products)
          if (products.length) {
            this.attachArtifactsToLatestAssistant({ products })
          }
          break
        }
        case 'need_user_input': {
          this.isStreaming = false
          this.applyWaitingPayload(payload.data)
          this.activeAgentRun = {
            id: payload.data.runId,
            conversationId,
            status: 'WAITING_USER_INPUT',
            waitingPrompt: payload.data.prompt,
            waitingOptions: payload.data.options,
            waiting: {
              type: payload.data.type,
              selectionKind: payload.data.selectionKind,
              title: payload.data.title,
              description: payload.data.description,
              prompt: payload.data.prompt,
              options: payload.data.options,
              multiple: payload.data.multiple,
              minSelections: payload.data.minSelections,
              maxSelections: payload.data.maxSelections,
              autoSelectWhenSingle: payload.data.autoSelectWhenSingle,
              confirmAction: payload.data.confirmAction,
              comparisonResult: payload.data.comparisonResult,
              request: payload.data.request,
            },
          }
          this.isStreaming = false
          break
        }
        case 'report_started': {
          const basedOn = this.sessionReport?.basedOn
            || selectedProductNames(this.comparisonView?.products || [], this.selectionSelectedIds)
          this.applyReportTask({
            id: this.sessionReport?.id || '',
            projectId: this.conversation?.projectId ?? null,
            status: this.sessionReport?.id ? (this.sessionReport.status || 'GENERATING') : 'QUEUED',
            basedOn,
          })
          this.pendingUserInput = null
          break
        }
        case 'report_queued': {
          const basedOn = payload.data.selectedProductIds?.length
            ? selectedProductNames(this.comparisonView?.products || this.productCards, payload.data.selectedProductIds)
            : (this.sessionReport?.basedOn || [])
          this.applyReportTask({
            id: payload.data.reportId,
            projectId: this.conversation?.projectId ?? null,
            status: mapReportTaskStatus(payload.data.status || 'QUEUED'),
            basedOn,
          })
          this.pendingUserInput = null
          this.selectionSelectedIds = []
          this.completeAssistantForQueuedReport(streamRevision)
          this.startReportPolling(payload.data.reportId)
          break
        }
        case 'report_completed': {
          const basedOn = payload.data.selectedProductIds?.length
            ? selectedProductNames(this.comparisonView?.products || this.productCards, payload.data.selectedProductIds)
            : (this.sessionReport?.basedOn || [])
          this.applyReportTask({
            id: payload.data.reportId,
            projectId: this.conversation?.projectId ?? null,
            status: 'READY',
            basedOn,
          })
          this.markReportReadyMessage()
          this.pendingUserInput = null
          this.selectionSelectedIds = []
          this.stopReportPolling()
          break
        }
        case 'sources': {
          const message = this.messages.find(item => item.id === this.streamingMessageId)
          if (message) {
            message.sources = normalizeAiSources([...(message.sources || []), ...payload.data.sources])
          }
          break
        }
        case 'delta': {
          if (this.sessionReport && (this.sessionReport.status === 'READY' || isInProgressReportStatus(this.sessionReport.status))) {
            break
          }
          const message = this.messages.find(item => item.id === this.streamingMessageId)
          if (message) {
            message.content = appendAssistantDelta(message.content, payload.data.text)
          }
          break
        }
        case 'done': {
          const message = this.messages.find(item => item.id === payload.data.messageId)
          if (message) {
            if (this.sessionReport?.status === 'READY') {
              message.content = REPORT_COMPLETED_MESSAGE
            }
            message.status = 'COMPLETED'
            message.finishedAt = new Date().toISOString()
            message.sources = normalizeAiSources([...(message.sources || []), ...payload.data.sources])
            message.model = payload.data.model?.id ?? null
          }
          if (payload.data.finishReason !== 'WAITING_USER_INPUT') {
            this.pendingUserInput = null
            this.activeAgentRun = this.activeAgentRun
              ? { ...this.activeAgentRun, status: 'COMPLETED' }
              : null
            if (this.sessionReport?.id && shouldPollReportStatus(this.sessionReport.status)) {
              this.startReportPolling(this.sessionReport.id)
            }
          }
          else if (!this.pendingUserInput && this.activeAgentRun?.id) {
            this.applyWaitingPayload({
              runId: this.activeAgentRun.id,
              prompt: this.progressMessage || '请确认后继续',
              options: this.activeAgentRun.waitingOptions || [],
              type: this.activeAgentRun.waiting?.type,
              selectionKind: this.activeAgentRun.waiting?.selectionKind,
              title: this.activeAgentRun.waiting?.title,
              request: this.activeAgentRun.waiting?.request,
            })
          }
          this.finishStreaming(streamRevision)
          break
        }
        case 'stopped': {
          const message = this.messages.find(item => item.id === payload.data.messageId)
          if (message) {
            message.status = 'STOPPED'
            message.content = restoreAssistantContent(payload.data.content || message.content)
            message.finishedAt = new Date().toISOString()
          }
          this.pendingUserInput = null
          this.finishStreaming(streamRevision)
          break
        }
        case 'error': {
          const message = this.messages.find(item => item.id === this.streamingMessageId)
          if (message) {
            message.status = 'FAILED'
            message.errorMessage = isVisionFailure({ message: payload.data.message, name: payload.data.code })
              ? VISION_FAILURE_MESSAGE
              : payload.data.message
            message.finishedAt = new Date().toISOString()
          }
          this.pendingUserInput = null
          this.finishStreaming(streamRevision)
          break
        }
      }
    },

    startStreaming(messageId: string) {
      this.stopReconnect()
      const streamRevision = ++this.streamRevision
      this.isStreaming = true
      this.streamingMessageId = messageId
      this.progressStage = null
      this.progressMessage = this.progressMessage && isInProgressReportStatus(this.sessionReport?.status)
        ? this.progressMessage
        : null
      this.toolSteps = []
      this.pendingCancel = false
      if (!isInProgressReportStatus(this.sessionReport?.status)) {
        this.sessionReport = null
      }
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
      if (!this.pendingUserInput) {
        this.progressMessage = null
      }
      this.activeAbort = null
      this.reconnecting = false
      this.streamRevision += 1
      this.sendLock = false
    },

    applyReportTask(payload: {
      id: string
      projectId: string | null
      status: ReportTaskStatus
      basedOn?: string[]
    }) {
      this.sessionReport = {
        id: payload.id,
        projectId: payload.projectId,
        title: reportTaskTitle(payload.status),
        status: payload.status,
        basedOn: payload.basedOn || this.sessionReport?.basedOn,
      }
    },

    markReportReadyMessage() {
      const reportMessage = this.messages.find(item => item.id === this.streamingMessageId)
        || [...this.messages].reverse().find(item => item.role === 'ASSISTANT')
      if (!reportMessage) {
        return
      }
      reportMessage.content = REPORT_COMPLETED_MESSAGE
      reportMessage.status = 'COMPLETED'
      reportMessage.comparison = undefined
      reportMessage.products = undefined
    },

    completeAssistantForQueuedReport(streamRevision: number) {
      const message = this.messages.find(item => item.id === this.streamingMessageId)
        || [...this.messages].reverse().find(item => item.role === 'ASSISTANT')
      if (message && (message.status === 'STREAMING' || message.status === 'PENDING')) {
        if (!message.content.trim()) {
          message.content = ''
        }
        message.status = 'COMPLETED'
        message.finishedAt = new Date().toISOString()
      }
      this.progressMessage = null
      this.finishStreaming(streamRevision)
    },

    restoreSessionReport(reports: ReportItem[] | undefined) {
      const latest = reports?.[0]
      const report = toSessionReport(latest)
      if (!report || !latest) {
        return
      }
      if (isInProgressReportStatus(report.status)) {
        this.sessionReport = report
        this.startReportPolling(report.id)
        return
      }
      const createdAt = new Date(latest.createdAt).getTime()
      if (report.status === 'READY' && Number.isFinite(createdAt) && Date.now() - createdAt <= 10 * 60 * 1000) {
        this.sessionReport = report
      }
    },

    setReportPageVisible(visible: boolean) {
      this.reportPageVisible = visible
      if (visible) {
        this.resumeReportPolling()
        return
      }
      this.pauseReportPolling()
    },

    pauseReportPolling() {
      clearReportPoll()
    },

    stopReportPolling() {
      clearReportPoll()
    },

    resumeReportPolling() {
      const id = this.sessionReport?.id
      if (!id || !this.reportPageVisible || !shouldPollReportStatus(this.sessionReport?.status)) {
        return
      }
      this.startReportPolling(id)
    },

    startReportPolling(reportId: string) {
      if (!reportId || !this.reportPageVisible) {
        return
      }
      clearReportPoll()
      const generation = reportPollGeneration
      const poll = async () => {
        if (generation !== reportPollGeneration || !this.reportPageVisible || this.sessionReport?.id !== reportId) {
          return
        }
        try {
          const response = await reportApi.getDetail(reportId).send() as ApiEnvelope<ReportDetail>
          if (generation !== reportPollGeneration || this.sessionReport?.id !== reportId) {
            return
          }
          const mapped = mapReportTaskStatus(response.data.report.status)
          this.applyReportTask({
            id: reportId,
            projectId: response.data.report.projectId,
            status: mapped,
            basedOn: this.sessionReport?.basedOn,
          })
          if (mapped === 'READY') {
            this.markReportReadyMessage()
            return
          }
          if (isTerminalReportStatus(mapped)) {
            return
          }
        }
        catch {
          // 轮询失败稍后重试，不把内部错误展示成失败
        }
        reportPollTimer = setTimeout(() => {
          void poll()
        }, 2000)
      }
      reportPollTimer = setTimeout(() => {
        void poll()
      }, 400)
    },

    async retrySessionReport() {
      const report = this.sessionReport
      if (!report?.id || report.status !== 'FAILED' || this.retryingReport) {
        return false
      }
      this.retryingReport = true
      try {
        await reportApi.retry(report.id).send()
        this.applyReportTask({
          id: report.id,
          projectId: report.projectId,
          status: 'QUEUED',
          basedOn: report.basedOn,
        })
        this.startReportPolling(report.id)
        return true
      }
      catch (error) {
        this.loadError = error instanceof Error ? error.message : '重新生成失败'
        return false
      }
      finally {
        this.retryingReport = false
      }
    },

    async refreshSessionReport() {
      const conversationId = this.conversation?.id
      if (!conversationId) {
        return
      }
      try {
        const response = await aiApi.getConversation(conversationId).send() as ApiEnvelope<ConversationDetail>
        if (this.conversation?.id !== conversationId) {
          return
        }
        this.restoreSessionReport(response.data.reports)
      }
      catch {
        // 报告卡片失败不阻断对话
      }
    },

    async hydrateAttachmentPreviews(messages: LocalMessage[]) {
      const pending = messages.flatMap(message => (message.attachments || [])
        .filter(item => item.fileId && !item.previewUrl)
        .map(item => ({ message, item })))
      await Promise.all(pending.map(async ({ item }) => {
        try {
          const response = await fileApi.getDownloadUrl(item.fileId).send() as ApiEnvelope<DownloadUrlResult>
          if (response.data?.url) {
            item.previewUrl = response.data.url
          }
        }
        catch {
          // 预览地址失败不阻断会话，点击时再试
        }
      }))
    },

    /** 图片识别失败后重新发送上一条用户消息（含原附件 ID）。 */
    async resendFromAssistant(messageId: string) {
      const index = this.messages.findIndex(message => message.id === messageId && message.role === 'ASSISTANT')
      if (index <= 0) {
        return false
      }
      const userMessage = this.messages[index - 1]
      if (!userMessage || userMessage.role !== 'USER') {
        return false
      }
      const attachmentFileIds = (userMessage.attachments || []).map(item => item.fileId).filter(Boolean)
      return this.sendMessage(userMessage.content, {
        projectId: this.conversation?.projectId ?? undefined,
        attachmentFileIds,
        localAttachments: userMessage.attachments,
      })
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

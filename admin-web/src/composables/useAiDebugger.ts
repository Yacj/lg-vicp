import type {
  AiDebugMessage,
  AiDebugSseEvent,
  AiModel,
  AiPromptVersion,
  AiProvider,
  AiReasoningMode,
  AiScene,
  AiSceneBinding,
} from '@/types/ai'
import { postAiDebugChat } from '@/api/ai-sse'
import { stopAiDebugChat } from '@/api/modules/ai'
import {
  fetchAiModels,
  fetchAiProviders,
  fetchAiPromptVersions,
  fetchAiSceneBindings,
} from '@/api/modules/ai'
import { computed, ref } from 'vue'
import { confirmAndRun } from './useAppConfirm'
import { useAppFeedback } from './useAppFeedback'

export type DebugLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** 调试请求结果（由 done/stopped/error 事件汇聚）。 */
export interface DebugRunState {
  requestId: string | null
  messageId: string | null
  startedAt: number | null
  firstTokenAt: number | null
  latencyMs: number | null
  finishReason: string | null
  modelId: string | null
  usage: { inputTokens: number | null, outputTokens: number | null, reasoningTokens: number | null } | null
  error: { code: string, message: string, requestId: string | null, retryable: boolean } | null
  stopped: boolean
}

/** SSE 事件日志行（实时时间线）。 */
export interface DebugEventLogEntry {
  time: number
  type: AiDebugSseEvent['type']
  summary: string
}

const MAX_MESSAGES = 30
const MAX_MESSAGE_LENGTH = 60000

function createInitialRunState(): DebugRunState {
  return {
    requestId: null,
    messageId: null,
    startedAt: null,
    firstTokenAt: null,
    latencyMs: null,
    finishReason: null,
    modelId: null,
    usage: null,
    error: null,
    stopped: false,
  }
}

/** AI 调试台：配置加载（服务商→模型→场景→提示词版本）+ SSE 流式对话。 */
export function useAiDebugger() {
  const feedback = useAppFeedback()

  // —— 配置数据 ——
  const providers = ref<AiProvider[]>([])
  const models = ref<AiModel[]>([])
  const bindings = ref<AiSceneBinding[]>([])
  const promptVersions = ref<AiPromptVersion[]>([])
  const loadStatus = ref<DebugLoadStatus>('idle')
  const loadError = ref<unknown>(null)

  // —— 配置选择 ——
  const selectedScene = ref<AiScene>('general_chat')
  const selectedProviderId = ref('')
  const selectedModelId = ref('')
  /** 空串表示使用该场景当前发布版本（后端默认）。 */
  const selectedPromptVersionId = ref('')
  const reasoningMode = ref<AiReasoningMode>('OFF')

  // —— 对话 ——
  const messages = ref<AiDebugMessage[]>([])
  const draftInput = ref('')

  // —— 运行态 ——
  const running = ref(false)
  const run = ref<DebugRunState>(createInitialRunState())
  const streamedText = ref('')
  const eventLog = ref<DebugEventLogEntry[]>([])
  const abortController = ref<AbortController | null>(null)
  /** 最近一次提交的消息快照（供重试）。 */
  const lastSubmitted = ref<{ messages: AiDebugMessage[], scene: AiScene, modelId: string, promptVersionId: string, reasoningMode: AiReasoningMode } | null>(null)
  const hasLastSubmitted = computed(() => lastSubmitted.value !== null)

  /** 可复制的回答文本：优先取已固化的最后一条助手消息，流式期间回退当前累积文本。 */
  const copyableText = computed(() => {
    for (let i = messages.value.length - 1; i >= 0; i -= 1) {
      const message = messages.value[i]
      if (message.role === 'assistant' && message.content.trim()) {
        return message.content
      }
    }
    return streamedText.value
  })

  const sceneBinding = computed<AiSceneBinding | null>(() => bindings.value
    .find(binding => binding.scene === selectedScene.value) ?? null)

  /** 当前场景可选的模型（按服务商过滤后）。 */
  const modelOptions = computed(() => models.value
    .filter(model => !selectedProviderId.value || model.providerId === selectedProviderId.value)
    .map(model => ({
      label: `${model.displayName}（${model.modelId}）`,
      value: model.id,
    })))

  const promptVersionOptions = computed(() => promptVersions.value.map(version => ({
    label: `v${version.version}（${version.status}）`,
    value: version.id,
  })))

  /** 发送是否可用：无运行中请求，且存在至少一个可用模型，且输入非空。 */
  const canSend = computed(() => !running.value
    && modelOptions.value.length > 0
    && draftInput.value.trim().length > 0)

  async function loadAll(): Promise<void> {
    loadStatus.value = 'loading'
    loadError.value = null
    try {
      const [providerResult, modelResult, bindingResult] = await Promise.all([
        fetchAiProviders(),
        fetchAiModels(),
        fetchAiSceneBindings(),
      ])
      providers.value = providerResult.items
      models.value = modelResult.items
      bindings.value = bindingResult.items
      loadStatus.value = 'ready'
      applyDefaultConfig()
    }
    catch (cause) {
      loadError.value = cause
      loadStatus.value = 'error'
    }
  }

  /** 依据场景绑定推导默认模型与提示词版本。 */
  async function applyDefaultConfig(): Promise<void> {
    const binding = sceneBinding.value
    if (binding?.primaryModelId && models.value.some(model => model.id === binding.primaryModelId)) {
      selectedModelId.value = binding.primaryModelId
    }
    else if (modelOptions.value[0]) {
      selectedModelId.value = modelOptions.value[0].value
    }
    else {
      selectedModelId.value = ''
    }
    const provider = models.value.find(model => model.id === selectedModelId.value)
    selectedProviderId.value = provider?.providerId ?? ''
    selectedPromptVersionId.value = ''
    await loadPromptVersions(binding?.promptTemplateId ?? null)
  }

  async function loadPromptVersions(promptTemplateId: string | null): Promise<void> {
    if (!promptTemplateId) {
      promptVersions.value = []
      return
    }
    try {
      const result = await fetchAiPromptVersions(promptTemplateId)
      promptVersions.value = result.items
    }
    catch {
      // 版本加载失败不阻塞调试：仍可用"当前发布版本"
      promptVersions.value = []
    }
  }

  /** 切换调试场景：场景决定系统提示词体系，历史对话与请求详情随之清空，避免上下文污染。 */
  async function handleSelectScene(scene: AiScene): Promise<void> {
    if (scene === selectedScene.value || running.value) {
      return
    }
    const applyScene = async (): Promise<void> => {
      selectedScene.value = scene
      clearMessages()
      lastSubmitted.value = null
      await applyDefaultConfig()
    }
    if (messages.value.length === 0) {
      await applyScene()
      return
    }
    await confirmAndRun(
      {
        title: '切换调试场景',
        content: '切换场景将清空当前对话记录与请求详情，是否继续？',
        confirmText: '切换并清空',
      },
      applyScene,
    )
  }

  function handleSelectProvider(providerId: string): void {
    selectedProviderId.value = providerId
    const first = models.value.find(model => model.providerId === providerId)
    selectedModelId.value = first?.id ?? ''
  }

  function handleSelectModel(modelId: string): void {
    selectedModelId.value = modelId
    const model = models.value.find(item => item.id === modelId)
    if (model) {
      selectedProviderId.value = model.providerId
    }
  }

  /** 追加/删除上下文消息（前 30 条；允许空内容占位，发送时过滤）。 */
  function addMessage(role: AiDebugMessage['role'], content: string): void {
    messages.value.push({ role, content: content.slice(0, MAX_MESSAGE_LENGTH) })
    while (messages.value.length > MAX_MESSAGES) {
      messages.value.shift()
    }
  }

  function removeMessage(index: number): void {
    messages.value.splice(index, 1)
  }

  function clearMessages(): void {
    messages.value = []
    resetRunState()
  }

  function resetRunState(): void {
    run.value = createInitialRunState()
    streamedText.value = ''
    eventLog.value = []
  }

  /** 将本轮流式回答固化为助手消息（空回答不追加），保证多轮上下文与历史展示。 */
  function commitStreamedAnswer(): void {
    const text = streamedText.value.trim()
    if (!text) {
      return
    }
    messages.value.push({ role: 'assistant', content: streamedText.value })
    if (messages.value.length > MAX_MESSAGES) {
      messages.value.splice(0, messages.value.length - MAX_MESSAGES)
    }
    streamedText.value = ''
  }

  /** 发送消息（SSE 流式）；返回最终回答文本。 */
  async function send(): Promise<string> {
    if (running.value || !draftInput.value.trim()) {
      return ''
    }
    const nextMessages = [
      ...messages.value.filter(message => message.content.trim()),
      { role: 'user' as const, content: draftInput.value.trim().slice(0, MAX_MESSAGE_LENGTH) },
    ]
    const body = {
      scene: selectedScene.value,
      modelId: selectedModelId.value || undefined,
      promptVersionId: selectedPromptVersionId.value || undefined,
      reasoningMode: reasoningMode.value,
      messages: nextMessages,
    }
    lastSubmitted.value = {
      messages: nextMessages,
      scene: selectedScene.value,
      modelId: selectedModelId.value,
      promptVersionId: selectedPromptVersionId.value,
      reasoningMode: reasoningMode.value,
    }
    messages.value = nextMessages
    draftInput.value = ''
    resetRunState()
    running.value = true
    run.value.startedAt = Date.now()

    const controller = new AbortController()
    abortController.value = controller

    let answer = ''
    try {
      await postAiDebugChat(body, {
        signal: controller.signal,
        onEvent: event => handleSseEvent(event),
      })
    }
    catch (error) {
      // 用户主动停止：abort 会抛 AbortError，界面已按 stopped 处理
      if (!controller.signal.aborted) {
        run.value.error = {
          code: 'REQUEST_FAILED',
          message: error instanceof Error ? error.message : '调试请求失败',
          requestId: null,
          retryable: true,
        }
        await feedback.messageError(error)
      }
    }
    finally {
      running.value = false
      abortController.value = null
      answer = streamedText.value
      commitStreamedAnswer()
    }
    return answer
  }

  function handleSseEvent(event: AiDebugSseEvent): void {
    switch (event.type) {
      case 'message':
        run.value.requestId = event.data.requestId
        run.value.messageId = event.data.messageId
        pushEventLog('message', `requestId: ${event.data.requestId}`)
        break
      case 'progress':
        pushEventLog('progress', `${event.data.stage}：${event.data.message}`)
        break
      case 'delta':
        if (run.value.firstTokenAt === null) {
          run.value.firstTokenAt = Date.now()
        }
        streamedText.value += event.data.text
        break
      case 'done':
        run.value.finishReason = event.data.finishReason
        run.value.latencyMs = event.data.latencyMs
        run.value.modelId = event.data.model.id
        run.value.usage = {
          inputTokens: event.data.usage.inputTokens,
          outputTokens: event.data.usage.outputTokens,
          reasoningTokens: event.data.usage.reasoningTokens,
        }
        pushEventLog('done', `finishReason: ${event.data.finishReason}，耗时 ${event.data.latencyMs}ms`)
        break
      case 'stopped':
        run.value.stopped = true
        if (event.data.partialContent) {
          streamedText.value = event.data.partialContent
        }
        run.value.usage = event.data.usage ?? null
        pushEventLog('stopped', '已停止生成')
        break
      case 'error':
        run.value.error = {
          code: event.data.code,
          message: event.data.message,
          requestId: event.data.requestId,
          retryable: event.data.retryable,
        }
        pushEventLog('error', `${event.data.code}：${event.data.message}`)
        break
    }
  }

  function pushEventLog(type: AiDebugSseEvent['type'], summary: string): void {
    eventLog.value.push({ time: Date.now(), type, summary })
  }

  /** 停止：先本地 abort 流，再通知后端停止（尽力而为）。 */
  async function stop(): Promise<void> {
    if (!running.value) {
      return
    }
    const controller = abortController.value
    const requestId = run.value.requestId
    controller?.abort()
    if (requestId) {
      try {
        await stopAiDebugChat(requestId)
      }
      catch {
        // 后端停止失败不影响本地界面状态
      }
    }
  }

  /** 重试上一次请求（不追加新消息）。 */
  async function retry(): Promise<string> {
    const snapshot = lastSubmitted.value
    if (!snapshot || running.value) {
      return ''
    }
    messages.value = snapshot.messages
    resetRunState()
    running.value = true
    run.value.startedAt = Date.now()
    const controller = new AbortController()
    abortController.value = controller
    let answer = ''
    try {
      await postAiDebugChat({
        scene: snapshot.scene,
        modelId: snapshot.modelId || undefined,
        promptVersionId: snapshot.promptVersionId || undefined,
        reasoningMode: snapshot.reasoningMode,
        messages: snapshot.messages,
      }, {
        signal: controller.signal,
        onEvent: event => handleSseEvent(event),
      })
    }
    catch (error) {
      if (!controller.signal.aborted) {
        run.value.error = {
          code: 'REQUEST_FAILED',
          message: error instanceof Error ? error.message : '调试请求失败',
          requestId: null,
          retryable: true,
        }
        await feedback.messageError(error)
      }
    }
    finally {
      running.value = false
      abortController.value = null
      answer = streamedText.value
      commitStreamedAnswer()
    }
    return answer
  }

  async function copyResult(): Promise<boolean> {
    const text = copyableText.value
    if (!text) {
      return false
    }
    try {
      await navigator.clipboard.writeText(text)
      return true
    }
    catch {
      return false
    }
  }

  return {
    addMessage,
    bindings,
    canSend,
    clearMessages,
    copyResult,
    copyableText,
    draftInput,
    eventLog,
    handleSelectModel,
    handleSelectProvider,
    handleSelectScene,
    hasLastSubmitted,
    loadAll,
    loadError,
    loadPromptVersions,
    loadStatus,
    messages,
    modelOptions,
    models,
    promptVersionOptions,
    promptVersions,
    providers,
    reasoningMode,
    removeMessage,
    resetRunState,
    retry,
    run,
    running,
    sceneBinding,
    selectedModelId,
    selectedPromptVersionId,
    selectedProviderId,
    selectedScene,
    send,
    stop,
    streamedText,
  }
}
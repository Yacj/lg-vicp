import type { DialogInstance, DialogOptions } from 'tdesign-vue-next'
import type { AiModel, AiProvider, AiSceneBinding } from '@/types/ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dialogMocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  messageError: vi.fn().mockResolvedValue({ close: vi.fn() }),
  options: undefined as DialogOptions | undefined,
  instance: {
    destroy: vi.fn(),
    hide: vi.fn(),
    setConfirmLoading: vi.fn(),
    show: vi.fn(),
    update: vi.fn(),
  } as DialogInstance,
}))

const apiMocks = vi.hoisted(() => ({
  fetchAiProviders: vi.fn(),
  fetchAiModels: vi.fn(),
  fetchAiSceneBindings: vi.fn(),
  fetchAiPromptVersions: vi.fn(),
  stopAiDebugChat: vi.fn(),
  postAiDebugChat: vi.fn(),
}))

vi.mock('tdesign-vue-next', () => ({
  DialogPlugin: { confirm: dialogMocks.confirm },
  MessagePlugin: { error: dialogMocks.messageError },
  NotifyPlugin: {},
}))

vi.mock('@/api/modules/ai', () => apiMocks)
vi.mock('@/api/ai-sse', () => ({ postAiDebugChat: apiMocks.postAiDebugChat }))

const { useAiDebugger } = await import('./useAiDebugger')

// —— 通用协议夹具（仅结构，不冒充业务数据） ——
const providerFixture: AiProvider = {
  id: 'p1',
  code: null,
  name: '测试服务商',
  description: null,
  type: 'OPENAI_COMPATIBLE',
  baseUrl: 'https://example.test/v1',
  timeoutMs: 30,
  priority: 1,
  lastTestStatus: null,
  lastTestMessage: null,
  lastTestAt: null,
  hasApiKey: true,
  apiKeyMasked: 'sk-***',
  enabled: true,
  createdById: null,
  updatedById: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const modelFixture: AiModel = {
  id: 'm1',
  providerId: 'p1',
  code: null,
  displayName: '测试模型',
  modelId: 'test-model',
  description: null,
  capabilities: { text: true, streaming: true },
  contextWindow: 8192,
  maxOutputTokens: 2048,
  defaultTemperature: 0.7,
  timeoutMs: 30,
  priority: 1,
  enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

function bindingFixture(scene: AiSceneBinding['scene'], primaryModelId: string | null): AiSceneBinding {
  return {
    id: `b-${scene}`,
    scene,
    name: `场景 ${scene}`,
    description: null,
    primaryModelId,
    defaultModelId: primaryModelId,
    defaultModelName: primaryModelId ? '测试模型' : null,
    reasoningModelId: null,
    reasoningModelName: null,
    fallbackModelId: null,
    fallbackModelName: null,
    promptTemplateId: null,
    promptId: null,
    allowReasoning: false,
    requireProject: false,
    allowFileUpload: false,
    allowKnowledgeSearch: false,
    allowTools: false,
    temperature: null,
    maxOutputTokens: null,
    enabled: true,
    sort: 1,
    settings: {},
    activePromptVersionId: null,
    activePromptVersion: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

describe('ai debugger scene switching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dialogMocks.options = undefined
    dialogMocks.confirm.mockImplementation((options: DialogOptions) => {
      dialogMocks.options = options
      return dialogMocks.instance
    })
    apiMocks.fetchAiProviders.mockResolvedValue({ items: [providerFixture] })
    apiMocks.fetchAiModels.mockResolvedValue({ items: [modelFixture] })
    apiMocks.fetchAiSceneBindings.mockResolvedValue({
      items: [bindingFixture('general_chat', 'm1'), bindingFixture('project_design', null)],
    })
    apiMocks.fetchAiPromptVersions.mockResolvedValue({ items: [] })
    apiMocks.postAiDebugChat.mockResolvedValue(undefined)
  })

  it('switches scene directly without confirmation when there are no messages', async () => {
    const debuggerApi = useAiDebugger()
    await debuggerApi.loadAll()

    await debuggerApi.handleSelectScene('project_design')

    expect(debuggerApi.selectedScene.value).toBe('project_design')
    expect(dialogMocks.confirm).not.toHaveBeenCalled()
  })

  it('keeps scene and messages when the confirmed switch is cancelled', async () => {
    const debuggerApi = useAiDebugger()
    await debuggerApi.loadAll()
    debuggerApi.addMessage('user', '你好')

    const pending = debuggerApi.handleSelectScene('project_design')
    expect(dialogMocks.confirm).toHaveBeenCalledOnce()

    dialogMocks.options?.onClose?.({ trigger: 'cancel', e: new MouseEvent('click') })
    await pending

    expect(debuggerApi.selectedScene.value).toBe('general_chat')
    expect(debuggerApi.messages.value).toHaveLength(1)
  })

  it('clears messages, request detail and retry snapshot after confirmed switch', async () => {
    const debuggerApi = useAiDebugger()
    await debuggerApi.loadAll()
    debuggerApi.addMessage('user', '你好')
    debuggerApi.draftInput.value = '建筑节能相关设计'
    await debuggerApi.send()
    expect(debuggerApi.hasLastSubmitted.value).toBe(true)
    debuggerApi.eventLog.value.push({ time: 1, type: 'progress', summary: '测试日志' })

    const pending = debuggerApi.handleSelectScene('project_design')
    dialogMocks.options?.onConfirm?.({ e: new MouseEvent('click') })
    await pending

    expect(debuggerApi.selectedScene.value).toBe('project_design')
    expect(debuggerApi.messages.value).toHaveLength(0)
    expect(debuggerApi.eventLog.value).toHaveLength(0)
    expect(debuggerApi.hasLastSubmitted.value).toBe(false)
  })

  it('ignores re-selecting the current scene', async () => {
    const debuggerApi = useAiDebugger()
    await debuggerApi.loadAll()
    debuggerApi.addMessage('user', '你好')

    await debuggerApi.handleSelectScene('general_chat')

    expect(dialogMocks.confirm).not.toHaveBeenCalled()
    expect(debuggerApi.messages.value).toHaveLength(1)
  })
})
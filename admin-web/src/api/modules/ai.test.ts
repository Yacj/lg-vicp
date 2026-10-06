import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/http/client'
import {
  createAiModel,
  testAiModel,
  createAiPrompt,
  createAiProvider,
  createAiQuickPrompt,
  deleteAiModel,
  deleteAiPrompt,
  deleteAiPromptVersion,
  deleteAiProvider,
  deleteAiQuickPrompt,
  disableAiPrompt,
  disableAiQuickPrompt,
  enableAiQuickPrompt,
  fetchAiModels,
  fetchAiPrompts,
  fetchAiPromptVersions,
  fetchAiProviders,
  fetchAiQuickPrompts,
  fetchAgentRun,
  fetchProjectAiMemories,
  fetchAiSceneBindings,
  fetchBusinessPrompts,
  fetchConversationDetail,
  fetchPlatformConversationDetail,
  fetchPlatformConversations,
  fetchPlatformFeedbacks,
  fetchProjectConversations,
  handleAiFeedback,
  publishAiPrompt,
  rejectProjectAiMemory,
  resetBusinessPrompt,
  rollbackAiPromptVersion,
  stopAiDebugChat,
  testAiModelConnection,
  testAiProviderConnection,
  updateAiModel,
  updateAiModelStatus,
  updateAiPromptDraft,
  updateAiProvider,
  updateAiProviderStatus,
  updateAiQuickPrompt,
  updateBusinessPrompt,
  updateProjectAiMemory,
  upsertAiSceneBinding,
} from './ai'

vi.mock('@/api/http/client', () => ({
  api: {
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ai conversation api contracts', () => {
  it('fetches conversations scoped to a project with backend pagination', async () => {
    const signal = new AbortController().signal
    await fetchProjectConversations('project-1', { page: 1, pageSize: 20 }, signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/ai/conversations', {
      params: { page: 1, pageSize: 20, projectId: 'project-1' },
      signal,
    })
  })

  it('fetches conversation detail by id', async () => {
    const signal = new AbortController().signal
    await fetchConversationDetail('conversation-1', signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/ai/conversations/conversation-1', { signal })
  })
})

describe('ai provider api contracts', () => {
  it('lists providers without pagination', async () => {
    const signal = new AbortController().signal
    await fetchAiProviders(signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/ai/providers', { signal })
  })

  it('creates a provider with apiKey', async () => {
    await createAiProvider({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      enabled: true,
    })

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/ai/providers', {
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      enabled: true,
    })
  })

  it('updates provider fields and status', async () => {
    await updateAiProvider('provider-1', { name: 'OpenAI 更新' })
    expect(mockedApi.patch).toHaveBeenCalledWith('/api/v1/platform/ai/providers/provider-1', {
      name: 'OpenAI 更新',
    })

    await updateAiProviderStatus('provider-1', false)
    expect(mockedApi.patch).toHaveBeenCalledWith('/api/v1/platform/ai/providers/provider-1', {
      enabled: false,
    })
  })

  it('deletes a provider', async () => {
    await deleteAiProvider('provider-1')

    expect(mockedApi.delete).toHaveBeenCalledWith('/api/v1/platform/ai/providers/provider-1')
  })

  it('tests provider connection without body', async () => {
    await testAiProviderConnection('provider-1')

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/ai/providers/provider-1/test-connection')
  })
})

describe('ai model api contracts', () => {
  it('lists models without pagination', async () => {
    const signal = new AbortController().signal
    await fetchAiModels(signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/ai/models', { signal })
  })

  it('creates a model with the simplified B-end payload', async () => {
    await createAiModel({
      providerId: 'provider-1',
      displayName: 'DeepSeek Chat',
      modelId: 'deepseek-chat',
      supportsVision: false,
      reasoningLevel: 'HIGH',
      enabled: false,
      isDefault: false,
    })

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/ai/models', {
      providerId: 'provider-1',
      displayName: 'DeepSeek Chat',
      modelId: 'deepseek-chat',
      supportsVision: false,
      reasoningLevel: 'HIGH',
      enabled: false,
      isDefault: false,
    })
    expect(mockedApi.post.mock.calls[0]?.[1]).not.toHaveProperty('temperature')
    expect(mockedApi.post.mock.calls[0]?.[1]).not.toHaveProperty('answerStyle')
    expect(mockedApi.post.mock.calls[0]?.[1]).not.toHaveProperty('responseStyle')
    expect(mockedApi.post.mock.calls[0]?.[1]).not.toHaveProperty('capabilities')
  })

  it('updates model and status', async () => {
    await updateAiModel('model-1', { supportsVision: true, reasoningLevel: 'MAX' })
    expect(mockedApi.patch).toHaveBeenCalledWith('/api/v1/platform/ai/models/model-1', {
      supportsVision: true,
      reasoningLevel: 'MAX',
    })

    await updateAiModelStatus('model-1', false)
    expect(mockedApi.patch).toHaveBeenCalledWith('/api/v1/platform/ai/models/model-1', {
      enabled: false,
    })
  })

  it('deletes a model', async () => {
    await deleteAiModel('model-1')

    expect(mockedApi.delete).toHaveBeenCalledWith('/api/v1/platform/ai/models/model-1')
  })

  it('tests a model via the admission endpoint', async () => {
    await testAiModel('model-1')
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/ai/models/model-1/test')

    await testAiModelConnection('model-1')
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/ai/models/model-1/test')
  })
})

describe('ai quick prompt api contracts', () => {
  it('lists quick prompts with pagination and filters', async () => {
    const signal = new AbortController().signal
    await fetchAiQuickPrompts({
      page: 1,
      pageSize: 20,
      keyword: '图集',
      position: 'AI_HOME',
      enabled: true,
    }, signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/ai/quick-prompts', {
      params: {
        page: 1,
        pageSize: 20,
        keyword: '图集',
        position: 'AI_HOME',
        enabled: true,
      },
      signal,
    })
  })

  it('creates, updates, enables, disables and deletes a quick prompt', async () => {
    await createAiQuickPrompt({
      title: '查询图集',
      description: '查询图集章节',
      content: '请查询相关图集',
      position: 'AI_HOME',
      icon: 'book',
      sortOrder: 10,
      enabled: true,
      actionType: 'AUTO',
    })
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/ai/quick-prompts', {
      title: '查询图集',
      description: '查询图集章节',
      content: '请查询相关图集',
      position: 'AI_HOME',
      icon: 'book',
      sortOrder: 10,
      enabled: true,
      actionType: 'AUTO',
    })

    await updateAiQuickPrompt('qp-1', { enabled: false, sortOrder: 20 })
    expect(mockedApi.put).toHaveBeenCalledWith('/api/v1/platform/ai/quick-prompts/qp-1', {
      enabled: false,
      sortOrder: 20,
    })

    await enableAiQuickPrompt('qp-1')
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/ai/quick-prompts/qp-1/enable')

    await disableAiQuickPrompt('qp-1')
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/ai/quick-prompts/qp-1/disable')

    await deleteAiQuickPrompt('qp-1')
    expect(mockedApi.delete).toHaveBeenCalledWith('/api/v1/platform/ai/quick-prompts/qp-1')
  })
})

describe('ai scene binding api contracts', () => {
  it('lists scene bindings without pagination', async () => {
    const signal = new AbortController().signal
    await fetchAiSceneBindings(signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/ai/scene-bindings', { signal })
  })

  it('upserts a scene binding', async () => {
    await upsertAiSceneBinding({
      scene: 'general_chat',
      primaryModelId: 'model-1',
      fallbackModelId: 'model-2',
      promptTemplateId: null,
      enabled: true,
    })

    expect(mockedApi.put).toHaveBeenCalledWith('/api/v1/platform/ai/scene-bindings', {
      scene: 'general_chat',
      primaryModelId: 'model-1',
      fallbackModelId: 'model-2',
      promptTemplateId: null,
      enabled: true,
    })
  })
})

describe('ai prompt api contracts', () => {
  it('lists prompts without pagination', async () => {
    const signal = new AbortController().signal
    await fetchAiPrompts(signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/ai/prompts', { signal })
  })

  it('creates a prompt draft with changeNote', async () => {
    await createAiPrompt({
      scene: 'general_chat',
      name: '通用对话草稿',
      description: '通用对话系统提示词',
      systemPrompt: '你是一名建筑节能顾问。',
      changeNote: '初版草稿',
    })

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/ai/prompts', {
      scene: 'general_chat',
      name: '通用对话草稿',
      description: '通用对话系统提示词',
      systemPrompt: '你是一名建筑节能顾问。',
      changeNote: '初版草稿',
    })
  })

  it('updates a prompt draft', async () => {
    await updateAiPromptDraft('prompt-1', {
      systemPrompt: '你是一名建筑节能顾问，回答需引用规范。',
      changeNote: '补充规范引用要求',
    })

    expect(mockedApi.patch).toHaveBeenCalledWith('/api/v1/platform/ai/prompts/prompt-1/draft', {
      systemPrompt: '你是一名建筑节能顾问，回答需引用规范。',
      changeNote: '补充规范引用要求',
    })
  })

  it('publishes a prompt draft version', async () => {
    await publishAiPrompt('prompt-1', 'version-9')

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/ai/prompts/prompt-1/publish', {
      versionId: 'version-9',
    })
  })

  it('disables the active prompt', async () => {
    await disableAiPrompt('prompt-1')

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/ai/prompts/prompt-1/disable')
  })

  it('rolls back a historical version into a new draft', async () => {
    await rollbackAiPromptVersion('prompt-1', 'version-3')

    expect(mockedApi.post).toHaveBeenCalledWith(
      '/api/v1/platform/ai/prompts/prompt-1/versions/version-3/rollback',
    )
  })

  it('lists prompt versions and deletes a draft version', async () => {
    const signal = new AbortController().signal
    await fetchAiPromptVersions('prompt-1', signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/ai/prompts/prompt-1/versions', { signal })

    await deleteAiPromptVersion('prompt-1', 'version-5')
    expect(mockedApi.delete).toHaveBeenCalledWith('/api/v1/platform/ai/prompts/prompt-1/versions/version-5')
  })

  it('deletes an unpublished prompt', async () => {
    await deleteAiPrompt('prompt-1')

    expect(mockedApi.delete).toHaveBeenCalledWith('/api/v1/platform/ai/prompts/prompt-1')
  })
})

describe('platform conversation api contracts', () => {
  it('fetches ops conversation list with filters and pagination', async () => {
    const signal = new AbortController().signal
    await fetchPlatformConversations({
      page: 2,
      pageSize: 10,
      keyword: '节能',
      clientApp: 'pc_ai',
      scene: 'project_design',
      status: 'active',
      userId: 'user-1',
      projectId: 'project-1',
    }, signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/ai/conversations', {
      params: {
        page: 2,
        pageSize: 10,
        keyword: '节能',
        clientApp: 'pc_ai',
        scene: 'project_design',
        status: 'active',
        userId: 'user-1',
        projectId: 'project-1',
      },
      signal,
    })
  })

  it('fetches conversation ops detail', async () => {
    const signal = new AbortController().signal
    await fetchPlatformConversationDetail('conversation-1', signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/ai/conversations/conversation-1', { signal })
  })
})

describe('platform feedback api contracts', () => {
  it('fetches feedback list with filters', async () => {
    const signal = new AbortController().signal
    await fetchPlatformFeedbacks({
      page: 1,
      pageSize: 20,
      reaction: 'DISLIKE',
      scene: 'standard_qa',
    }, signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/ai/feedbacks', {
      params: {
        page: 1,
        pageSize: 20,
        reaction: 'DISLIKE',
        scene: 'standard_qa',
      },
      signal,
    })
  })

  it('handles a feedback with a note', async () => {
    await handleAiFeedback('feedback-1', { handlingNote: '已联系用户说明' })

    expect(mockedApi.put).toHaveBeenCalledWith('/api/v1/platform/ai/feedbacks/feedback-1/handle', {
      handlingNote: '已联系用户说明',
    })
  })
})

describe('ai business prompt api contracts', () => {
  it('lists, updates and restores business prompts including GLOBAL_RESPONSE_POLICY', async () => {
    const signal = new AbortController().signal
    await fetchBusinessPrompts(signal)
    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/ai/business-prompts', { signal })

    await updateBusinessPrompt('GLOBAL_RESPONSE_POLICY', { content: '直接回答用户当前问题，结论优先。不重复上一轮内容。' })
    expect(mockedApi.put).toHaveBeenCalledWith(
      '/api/v1/platform/ai/business-prompts/GLOBAL_RESPONSE_POLICY',
      { content: '直接回答用户当前问题，结论优先。不重复上一轮内容。' },
    )
    expect(mockedApi.put.mock.calls[0]?.[1]).not.toHaveProperty('answerStyle')
    expect(mockedApi.put.mock.calls[0]?.[1]).not.toHaveProperty('responseStyle')

    await resetBusinessPrompt('GLOBAL_RESPONSE_POLICY')
    expect(mockedApi.post).toHaveBeenCalledWith(
      '/api/v1/platform/ai/business-prompts/GLOBAL_RESPONSE_POLICY/reset-default',
    )

    await updateBusinessPrompt('PRODUCT_COMPARE', { content: '只解释 ComparisonResult 中的差异。' })
    expect(mockedApi.put).toHaveBeenCalledWith(
      '/api/v1/platform/ai/business-prompts/PRODUCT_COMPARE',
      { content: '只解释 ComparisonResult 中的差异。' },
    )
  })
})

describe('ai debug api contracts', () => {
  it('stops a debug generation', async () => {
    await stopAiDebugChat('debug-1')

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/ai/debug/debug-1/stop')
  })
})

describe('agent run and project memory api contracts', () => {
  it('fetches an agent run by id', async () => {
    const signal = new AbortController().signal
    await fetchAgentRun('run-1', signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/ai/agent-runs/run-1', { signal })
  })

  it('lists project memories by view and can reject or update them', async () => {
    const signal = new AbortController().signal
    await fetchProjectAiMemories('project-1', 'pending', signal)
    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/projects/project-1/ai-memories', {
      params: { view: 'pending' },
      signal,
    })

    await rejectProjectAiMemory('project-1', 'memory-1')
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/projects/project-1/ai-memories/memory-1/reject')

    await updateProjectAiMemory('project-1', 'memory-1', { content: '目标 K 改为 0.30' })
    expect(mockedApi.put).toHaveBeenCalledWith('/api/v1/projects/project-1/ai-memories/memory-1', {
      content: '目标 K 改为 0.30',
    })
  })
})

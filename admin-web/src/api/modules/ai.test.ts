import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/http/client'
import {
  createAiModel,
  createAiPrompt,
  createAiProvider,
  deleteAiModel,
  deleteAiPrompt,
  deleteAiPromptVersion,
  deleteAiProvider,
  disableAiPrompt,
  fetchAiModels,
  fetchAiPrompts,
  fetchAiPromptVersions,
  fetchAiProviders,
  fetchAiSceneBindings,
  fetchPlatformConversationDetail,
  fetchPlatformConversations,
  fetchPlatformFeedbacks,
  fetchProjectConversations,
  handleAiFeedback,
  publishAiPrompt,
  rollbackAiPromptVersion,
  stopAiDebugChat,
  testAiModelConnection,
  testAiProviderConnection,
  updateAiModel,
  updateAiModelStatus,
  updateAiPromptDraft,
  updateAiProvider,
  updateAiProviderStatus,
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

  it('creates a model with capabilities', async () => {
    await createAiModel({
      providerId: 'provider-1',
      displayName: 'DeepSeek R1',
      modelId: 'deepseek-reasoner',
      capabilities: { text: true, streaming: true, reasoning: true },
      timeoutMs: 60000,
      enabled: true,
    })

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/ai/models', {
      providerId: 'provider-1',
      displayName: 'DeepSeek R1',
      modelId: 'deepseek-reasoner',
      capabilities: { text: true, streaming: true, reasoning: true },
      timeoutMs: 60000,
      enabled: true,
    })
  })

  it('updates model and status', async () => {
    await updateAiModel('model-1', { contextWindow: 65536 })
    expect(mockedApi.patch).toHaveBeenCalledWith('/api/v1/platform/ai/models/model-1', {
      contextWindow: 65536,
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

  it('tests model connection', async () => {
    await testAiModelConnection('model-1')

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/ai/models/model-1/test-connection')
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
    }, signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/ai/conversations', {
      params: {
        page: 2,
        pageSize: 10,
        keyword: '节能',
        clientApp: 'pc_ai',
        scene: 'project_design',
        status: 'active',
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

describe('ai debug api contracts', () => {
  it('stops a debug generation', async () => {
    await stopAiDebugChat('debug-1')

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/ai/debug/debug-1/stop')
  })
})

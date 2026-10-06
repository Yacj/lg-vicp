import type { AiModel, AiProvider } from '@/types/ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMocks = vi.hoisted(() => ({
  createAiModel: vi.fn(),
  deleteAiModel: vi.fn(),
  fetchAiModels: vi.fn(),
  fetchAiProviders: vi.fn(),
  testAiModel: vi.fn(),
  updateAiModel: vi.fn(),
  updateAiModelStatus: vi.fn(),
}))

const feedbackMocks = vi.hoisted(() => ({
  message: vi.fn(),
  messageError: vi.fn(),
}))

vi.mock('tdesign-vue-next', () => ({
  DialogPlugin: { confirm: vi.fn() },
  MessagePlugin: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  NotifyPlugin: {},
}))

vi.mock('@/api/modules/ai', () => apiMocks)
vi.mock('./useAppFeedback', () => ({
  useAppFeedback: () => feedbackMocks,
}))

const { useAiModelManagement } = await import('./useAiModelManagement')

const providerFixture: AiProvider = {
  apiKeyMasked: 'sk-****',
  baseUrl: 'https://api.deepseek.com/v1',
  code: 'deepseek',
  createdAt: '2026-01-01T00:00:00.000Z',
  createdById: null,
  description: null,
  enabled: true,
  hasApiKey: true,
  id: 'provider-1',
  lastTestAt: null,
  lastTestMessage: null,
  lastTestStatus: null,
  name: 'DeepSeek',
  priority: 1,
  timeoutMs: 60000,
  type: 'OPENAI_COMPATIBLE',
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedById: null,
}

const modelFixture: AiModel = {
  baseUrl: 'https://api.deepseek.com/v1',
  capabilities: { text: true, tools: true, temperature: true } as Record<string, boolean>,
  code: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  credentialId: 'provider-1',
  defaultTemperature: 0.7,
  description: null,
  displayName: 'DeepSeek Chat',
  enabled: true,
  id: 'model-1',
  isDefault: true,
  lastTestAt: '2026-01-02T00:00:00.000Z',
  lastTestError: null,
  lastTestStatus: 'PASSED',
  maxOutputTokens: 8192,
  modelId: 'deepseek-chat',
  name: 'DeepSeek Chat',
  provider: 'deepseek',
  providerId: 'provider-1',
  providerName: 'DeepSeek',
  reasoningLevel: 'HIGH',
  supportsVision: false,
  updatedAt: '2026-01-02T00:00:00.000Z',
}

describe('useAiModelManagement submit contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.fetchAiModels.mockResolvedValue({ items: [modelFixture] })
    apiMocks.fetchAiProviders.mockResolvedValue({ items: [providerFixture] })
    apiMocks.createAiModel.mockResolvedValue({ message: 'created', model: modelFixture })
    apiMocks.updateAiModel.mockResolvedValue({ message: 'updated', model: modelFixture })
    apiMocks.testAiModel.mockResolvedValue({
      checks: {
        connection: { message: 'ok', ok: true },
        reasoning: { message: 'ok', ok: true },
        text: { message: 'ok', ok: true },
        toolCalling: { message: 'ok', ok: true },
      },
      message: 'passed',
      ok: true,
    })
  })

  it('does not submit legacy temperature, answer style or capability switches', async () => {
    const api = useAiModelManagement()
    api.modelDrawer.openEdit(modelFixture)
    await api.modelDrawer.submit()

    expect(apiMocks.updateAiModel).toHaveBeenCalledWith('model-1', {
      displayName: 'DeepSeek Chat',
      enabled: true,
      isDefault: true,
      modelId: 'deepseek-chat',
      providerId: 'provider-1',
      reasoningLevel: 'HIGH',
      supportsVision: false,
    })
    const payload = apiMocks.updateAiModel.mock.calls[0]?.[1] as Record<string, unknown>
    expect(payload).not.toHaveProperty('temperature')
    expect(payload).not.toHaveProperty('defaultTemperature')
    expect(payload).not.toHaveProperty('answerStyle')
    expect(payload).not.toHaveProperty('responseStyle')
    expect(payload).not.toHaveProperty('capabilities')
    expect(payload).not.toHaveProperty('supportsTools')
    expect(payload).not.toHaveProperty('supportsAgent')
    expect(payload).not.toHaveProperty('maxOutputTokens')
    expect(payload).not.toHaveProperty('topP')
  })

  it('creates models as untested and disabled even if the form switch was turned on', async () => {
    const api = useAiModelManagement()
    api.modelDrawer.openCreate()
    api.modelDrawer.formData.providerId = 'provider-1'
    api.modelDrawer.formData.displayName = 'New Model'
    api.modelDrawer.formData.modelId = 'new-model'
    api.modelDrawer.formData.enabled = true
    api.modelDrawer.formData.isDefault = true
    await api.modelDrawer.submit()

    expect(apiMocks.createAiModel).toHaveBeenCalledWith({
      displayName: 'New Model',
      enabled: false,
      isDefault: false,
      modelId: 'new-model',
      providerId: 'provider-1',
      reasoningLevel: 'HIGH',
      supportsVision: false,
    })
  })

  it('invalidates enable/default in the payload after Model ID changes', async () => {
    const api = useAiModelManagement()
    api.modelDrawer.openEdit(modelFixture)
    api.modelDrawer.formData.modelId = 'deepseek-reasoner'
    await api.modelDrawer.submit()

    expect(apiMocks.updateAiModel).toHaveBeenCalledWith('model-1', expect.objectContaining({
      enabled: false,
      isDefault: false,
      modelId: 'deepseek-reasoner',
    }))
  })

  it('tests models through the admission endpoint', async () => {
    const api = useAiModelManagement()
    await api.testModel(modelFixture)
    expect(apiMocks.testAiModel).toHaveBeenCalledWith('model-1')
  })
})

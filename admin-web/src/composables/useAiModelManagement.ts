import type { TableRowData } from 'tdesign-vue-next'
import type {
  AiConnectionTestResult,
  AiModel,
  AiModelInput,
  AiModelMutationResult,
  AiProvider,
} from '@/types/ai'
import { computed, ref } from 'vue'
import {
  createAiModel,
  deleteAiModel,
  fetchAiModels,
  fetchAiProviders,
  testAiModelConnection,
  updateAiModel,
  updateAiModelStatus,
} from '@/api/modules/ai'
import { useAppFeedback } from './useAppFeedback'
import { useConfirmedCrudAction } from './useCrudActions'
import { useCrudDrawer } from './useCrudDrawer'
import { useCrudList } from './useCrudList'

export type AiModelTableRow = AiModel & TableRowData

export interface AiModelSearchQuery extends Record<string, unknown> {
  keyword: string
  status: 'all' | 'enabled' | 'disabled'
}

/** 表单中的能力开关，与 capabilities jsonb 一一对应（text 恒真，不提供开关）。 */
export interface AiModelForm extends Record<string, unknown> {
  providerId: string
  displayName: string
  modelId: string
  description: string
  /** 空串表示未填写（t-input-number 不接受 null）。 */
  contextWindow: number | ''
  maxOutputTokens: number | ''
  defaultTemperature: number | ''
  timeoutMs: number
  priority: number | ''
  enabled: boolean
  capabilityStreaming: boolean
  capabilityReasoning: boolean
  capabilityReasoningAlwaysOn: boolean
  capabilityReasoningEffort: boolean
  capabilityStructuredOutput: boolean
  capabilityTools: boolean
  capabilityVision: boolean
  capabilityFiles: boolean
}

export const AI_MODEL_CAPABILITY_META = [
  { key: 'capabilityStreaming', label: '支持流式输出', name: 'streaming' },
  { key: 'capabilityReasoning', label: '支持推理', name: 'reasoning' },
  { key: 'capabilityReasoningAlwaysOn', label: '推理常开', name: 'reasoningAlwaysOn' },
  { key: 'capabilityReasoningEffort', label: '推理强度（high）', name: 'reasoningEffort' },
  { key: 'capabilityStructuredOutput', label: '结构化输出', name: 'structuredOutput' },
  { key: 'capabilityTools', label: '工具调用', name: 'tools' },
  { key: 'capabilityVision', label: '视觉输入', name: 'vision' },
  { key: 'capabilityFiles', label: '文件输入', name: 'files' },
] as const

function createModelForm(): AiModelForm {
  return {
    providerId: '',
    displayName: '',
    modelId: '',
    description: '',
    contextWindow: '',
    maxOutputTokens: '',
    defaultTemperature: '',
    timeoutMs: 60000,
    priority: '',
    enabled: true,
    capabilityStreaming: true,
    capabilityReasoning: false,
    capabilityReasoningAlwaysOn: false,
    capabilityReasoningEffort: false,
    capabilityStructuredOutput: false,
    capabilityTools: false,
    capabilityVision: false,
    capabilityFiles: false,
  }
}

function editModelForm(model: AiModel): AiModelForm {
  const capabilities = model.capabilities ?? {}
  return {
    providerId: model.providerId,
    displayName: model.displayName,
    modelId: model.modelId,
    description: model.description ?? '',
    contextWindow: model.contextWindow ?? '',
    maxOutputTokens: model.maxOutputTokens ?? '',
    defaultTemperature: model.defaultTemperature ?? '',
    timeoutMs: model.timeoutMs ?? 60000,
    priority: model.priority ?? '',
    enabled: model.enabled,
    capabilityStreaming: capabilities.streaming !== false,
    capabilityReasoning: capabilities.reasoning === true,
    capabilityReasoningAlwaysOn: capabilities.reasoningAlwaysOn === true,
    capabilityReasoningEffort: capabilities.reasoningEffort === true,
    capabilityStructuredOutput: capabilities.structuredOutput === true,
    capabilityTools: capabilities.tools === true,
    capabilityVision: capabilities.vision === true,
    capabilityFiles: capabilities.files === true,
  }
}

function toCapabilities(form: AiModelForm): Record<string, boolean> {
  return {
    text: true,
    streaming: form.capabilityStreaming,
    reasoning: form.capabilityReasoning,
    reasoningAlwaysOn: form.capabilityReasoningAlwaysOn,
    reasoningEffort: form.capabilityReasoningEffort,
    structuredOutput: form.capabilityStructuredOutput,
    tools: form.capabilityTools,
    vision: form.capabilityVision,
    files: form.capabilityFiles,
  }
}

function toModelInput(form: AiModelForm): AiModelInput {
  return {
    providerId: form.providerId,
    displayName: form.displayName.trim(),
    modelId: form.modelId.trim(),
    description: form.description.trim() || undefined,
    capabilities: toCapabilities(form),
    contextWindow: form.contextWindow || undefined,
    maxOutputTokens: form.maxOutputTokens || undefined,
    defaultTemperature: form.defaultTemperature || undefined,
    timeoutMs: form.timeoutMs,
    priority: form.priority || undefined,
    enabled: form.enabled,
  }
}

/** 模型列表为全量返回，服务商名称在前端 join；筛选在客户端完成。 */
export function useAiModelManagement() {
  const feedback = useAppFeedback()
  const providers = ref<AiProvider[]>([])
  const providersLoadError = ref<unknown>(null)
  const providersLoading = ref(false)

  const providerOptions = computed(() => providers.value.map(provider => ({
    label: provider.name,
    value: provider.id,
  })))

  const providerNameById = computed(() => {
    const map = new Map<string, string>()
    providers.value.forEach(provider => map.set(provider.id, provider.name))
    return map
  })

  async function loadProviders(): Promise<void> {
    providersLoading.value = true
    providersLoadError.value = null
    try {
      const result = await fetchAiProviders()
      providers.value = result.items
    }
    catch (error) {
      providersLoadError.value = error
      providers.value = []
    }
    finally {
      providersLoading.value = false
    }
  }

  const modelList = useCrudList<AiModelTableRow, AiModelSearchQuery>({
    createQuery: () => ({ keyword: '', status: 'all' }),
    fetcher: async ({ query }) => {
      const result = await fetchAiModels()
      const keyword = String(query.keyword ?? '').trim().toLocaleLowerCase()
      const items = result.items.filter((model) => {
        const matchesKeyword = !keyword
          || model.displayName.toLocaleLowerCase().includes(keyword)
          || model.modelId.toLocaleLowerCase().includes(keyword)
        const matchesStatus = query.status === 'all'
          || (query.status === 'enabled' ? model.enabled : !model.enabled)
        return matchesKeyword && matchesStatus
      })
      return { items, page: 1, pageSize: items.length || 20, total: items.length }
    },
    immediate: true,
    rowKey: 'id',
  })

  const modelDrawer = useCrudDrawer<AiModelForm, AiModel, AiModelMutationResult>({
    createForm: createModelForm,
    editForm: editModelForm,
    onError: error => void feedback.messageError(error),
    onSuccess: async (result) => {
      await feedback.message('success', result.message)
      await modelList.refresh()
    },
    submit: async ({ data, entity, mode }) => {
      const input = toModelInput(data)
      if (mode === 'create') {
        return createAiModel(input)
      }
      return updateAiModel(entity!.id, input)
    },
  })

  const modelStatusAction = useConfirmedCrudAction<
    { enabled: boolean, model: AiModel },
    AiModelMutationResult
  >({
    action: ({ enabled, model }) => updateAiModelStatus(model.id, enabled),
    confirm: ({ enabled, model }) => ({
      content: `确认${enabled ? '启用' : '停用'}模型“${model.displayName}”吗？`,
      confirmText: enabled ? '启用' : '停用',
      danger: !enabled,
      title: `${enabled ? '启用' : '停用'}模型`,
    }),
    onSuccess: async () => {
      await modelList.refresh()
    },
    successMessage: (_payload, result) => result.message,
  })

  const modelDeleteAction = useConfirmedCrudAction<AiModel, { message: string }>({
    action: model => deleteAiModel(model.id),
    confirm: model => ({
      content: `模型“${model.displayName}”（${model.modelId}）将被永久删除。若已被场景绑定引用，绑定将失效。`,
      confirmText: '删除',
      danger: true,
      title: '删除模型',
    }),
    onSuccess: async () => {
      await modelList.refresh()
    },
    successMessage: (_model, result) => result.message,
  })

  /** 连通性测试：非确认型动作，行内 loading 由页面管理；成功结果由页面展示。 */
  const testingModelId = ref<string | null>(null)

  async function testConnection(model: AiModel): Promise<AiConnectionTestResult> {
    if (testingModelId.value) {
      throw new Error('已有连接测试正在进行')
    }
    testingModelId.value = model.id
    try {
      return await testAiModelConnection(model.id)
    }
    finally {
      testingModelId.value = null
    }
  }

  return {
    loadProviders,
    modelDeleteAction,
    modelDrawer,
    modelList,
    modelStatusAction,
    providerNameById,
    providerOptions,
    providers,
    providersLoadError,
    providersLoading,
    testConnection,
    testingModelId,
  }
}

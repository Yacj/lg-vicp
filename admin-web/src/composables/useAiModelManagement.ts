import type { TableRowData } from 'tdesign-vue-next'
import type {
  AiModel,
  AiModelInput,
  AiModelMutationResult,
  AiModelTestResult,
  AiProvider,
} from '@/types/ai'
import { computed, ref } from 'vue'
import {
  createAiModel,
  deleteAiModel,
  fetchAiModels,
  fetchAiProviders,
  testAiModel,
  updateAiModel,
  updateAiModelStatus,
} from '@/api/modules/ai'
import { planAgentModelAssignment, planVisionModelAssignment } from '@/utils/ai'
import {
  assertNoLegacyModelInputFields,
  createAiModelForm,
  editAiModelForm,
  isModelIdentityChanged,
  toAiModelInput,
  type AiModelForm,
} from '@/utils/ai-model'
import { useAppFeedback } from './useAppFeedback'
import { useConfirmedCrudAction } from './useCrudActions'
import { useCrudDrawer } from './useCrudDrawer'
import { useCrudList } from './useCrudList'

export type { AiModelForm }

export type AiModelTableRow = AiModel & TableRowData

export interface AiModelSearchQuery extends Record<string, unknown> {
  keyword: string
  status: 'all' | 'enabled' | 'disabled'
}

function buildModelInput(
  form: AiModelForm,
  options: { mode: 'create' | 'edit', identityChanged?: boolean },
): AiModelInput {
  const input = toAiModelInput(form, options)
  const leaked = assertNoLegacyModelInputFields(input)
  if (leaked.length > 0) {
    throw new Error(`模型提交包含已停用字段：${leaked.join(', ')}`)
  }
  return input
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
          || (model.providerName ?? '').toLocaleLowerCase().includes(keyword)
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
    createForm: createAiModelForm,
    editForm: editAiModelForm,
    onError: error => void feedback.messageError(error),
    onSuccess: async (result) => {
      await feedback.message('success', result.message)
      await modelList.refresh()
    },
    submit: async ({ data, entity, mode }) => {
      const identityChanged = mode === 'edit' && entity
        ? isModelIdentityChanged(entity, data)
        : false
      const input = buildModelInput(data, { identityChanged, mode })
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

  const modelDefaultAction = useConfirmedCrudAction<AiModel, AiModelMutationResult>({
    action: model => updateAiModel(model.id, { isDefault: true }),
    confirm: model => ({
      content: `确认将“${model.displayName}”设为默认模型吗？其他默认标记将被取消。`,
      confirmText: '设为默认',
      title: '设为默认模型',
    }),
    onSuccess: async () => {
      await modelList.refresh()
    },
    successMessage: (_model, result) => result.message,
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

  const assigningVision = ref(false)
  const assigningAgent = ref(false)

  async function assignVisionModel(modelId: string): Promise<void> {
    if (assigningVision.value) {
      return
    }
    const updates = planVisionModelAssignment(modelList.data.value, modelId)
    if (updates.length === 0) {
      return
    }
    assigningVision.value = true
    try {
      for (const update of updates) {
        await updateAiModel(update.id, update.input)
      }
      await feedback.message('success', '视觉模型已更新')
      await modelList.refresh()
    }
    catch (error) {
      await feedback.messageError(error)
    }
    finally {
      assigningVision.value = false
    }
  }

  async function assignAgentModel(modelId: string): Promise<void> {
    if (assigningAgent.value) {
      return
    }
    const updates = planAgentModelAssignment(modelList.data.value, modelId)
    if (updates.length === 0) {
      await feedback.message('warning', '只能将已开启工具调用能力的模型设为 Agent 主模型')
      return
    }
    assigningAgent.value = true
    try {
      for (const update of updates) {
        await updateAiModel(update.id, update.input)
      }
      await feedback.message('success', 'Agent 主模型已更新')
      await modelList.refresh()
    }
    catch (error) {
      await feedback.messageError(error)
    }
    finally {
      assigningAgent.value = false
    }
  }

  const testingModelId = ref<string | null>(null)

  async function testModel(model: AiModel): Promise<AiModelTestResult> {
    if (testingModelId.value) {
      throw new Error('已有模型检测正在进行')
    }
    testingModelId.value = model.id
    try {
      const result = await testAiModel(model.id)
      await modelList.refresh()
      return result
    }
    finally {
      testingModelId.value = null
    }
  }

  return {
    assigningAgent,
    assigningVision,
    assignAgentModel,
    assignVisionModel,
    loadProviders,
    modelDefaultAction,
    modelDeleteAction,
    modelDrawer,
    modelList,
    modelStatusAction,
    providerNameById,
    providerOptions,
    providers,
    providersLoadError,
    providersLoading,
    testModel,
    testingModelId,
  }
}

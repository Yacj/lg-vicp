import type { TableRowData } from 'tdesign-vue-next'
import type {
  AiModel,
  AiPromptTemplate,
  AiProvider,
  AiScene,
  AiSceneBinding,
  AiSceneBindingInput,
  AiSceneBindingMutationResult,
} from '@/types/ai'
import { computed, ref } from 'vue'
import {
  fetchAiModels,
  fetchAiPrompts,
  fetchAiProviders,
  fetchAiSceneBindings,
  upsertAiSceneBinding,
} from '@/api/modules/ai'
import { AI_SCENE_META } from '@/utils/ai'
import { useAppFeedback } from './useAppFeedback'
import { useCrudDrawer } from './useCrudDrawer'

export type AiSceneBindingTableRow = AiSceneBinding & TableRowData

/** 表单值：scene 只读；模型/提示词空串表示未选；数字空串表示未填（t-input-number 不接受 null）。 */
export interface AiSceneBindingForm extends Record<string, unknown> {
  scene: AiScene
  description: string
  primaryModelId: string
  reasoningModelId: string
  fallbackModelId: string
  promptTemplateId: string
  allowReasoning: boolean
  requireProject: boolean
  allowFileUpload: boolean
  allowKnowledgeSearch: boolean
  allowTools: boolean
  temperature: number | ''
  maxOutputTokens: number | ''
  sort: number | ''
  enabled: boolean
}

const SCENE_KEYS = Object.keys(AI_SCENE_META) as AiScene[]

function toForm(binding: AiSceneBinding | null, scene: AiScene): AiSceneBindingForm {
  return {
    scene,
    description: binding?.description ?? '',
    primaryModelId: binding?.primaryModelId ?? '',
    reasoningModelId: binding?.reasoningModelId ?? '',
    fallbackModelId: binding?.fallbackModelId ?? '',
    promptTemplateId: binding?.promptTemplateId ?? '',
    allowReasoning: binding?.allowReasoning ?? false,
    requireProject: binding?.requireProject ?? false,
    allowFileUpload: binding?.allowFileUpload ?? false,
    allowKnowledgeSearch: binding?.allowKnowledgeSearch ?? false,
    allowTools: binding?.allowTools ?? false,
    temperature: binding?.temperature ?? '',
    maxOutputTokens: binding?.maxOutputTokens ?? '',
    sort: binding?.sort ?? '',
    enabled: binding?.enabled ?? true,
  }
}

/** 场景为固定枚举，绑定按 scene upsert；列表恒为 6 行，未绑定行展示空态。 */
export function useAiSceneBindings() {
  const feedback = useAppFeedback()
  const bindings = ref<AiSceneBinding[]>([])
  const models = ref<AiModel[]>([])
  const prompts = ref<AiPromptTemplate[]>([])
  const providers = ref<AiProvider[]>([])
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const error = ref<unknown>(null)
  const loading = ref(false)

  const rows = computed<AiSceneBindingTableRow[]>(() => {
    const bindingByScene = new Map(bindings.value.map(binding => [binding.scene, binding]))
    return SCENE_KEYS.map((scene) => {
      const binding = bindingByScene.get(scene) ?? null
      return {
        ...toForm(binding, scene),
        id: binding?.id ?? `scene:${scene}`,
        createdAt: binding?.createdAt ?? null,
        updatedAt: binding?.updatedAt ?? null,
      } as AiSceneBindingTableRow
    })
  })

  const modelOptions = computed(() => models.value.map(model => ({
    label: `${model.displayName}（${model.modelId}）`,
    value: model.id,
  })))

  const promptOptions = computed(() => prompts.value.map(prompt => ({
    label: `${prompt.name} v${prompt.version}`,
    value: prompt.id,
  })))

  const modelNameById = computed(() => {
    const map = new Map<string, string>()
    models.value.forEach(model => map.set(model.id, model.displayName))
    return map
  })

  /** 模型 id → 服务商 id，用于展示服务商名称。 */
  const modelProviderIdById = computed(() => {
    const map = new Map<string, string>()
    models.value.forEach(model => map.set(model.id, model.providerId))
    return map
  })

  const promptLabelById = computed(() => {
    const map = new Map<string, string>()
    prompts.value.forEach(prompt => map.set(prompt.id, `${prompt.name} v${prompt.version}`))
    return map
  })

  const providerNameById = computed(() => {
    const map = new Map<string, string>()
    providers.value.forEach(provider => map.set(provider.id, provider.name))
    return map
  })

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    status.value = 'loading'
    try {
      const [bindingResult, modelResult, promptResult, providerResult] = await Promise.all([
        fetchAiSceneBindings(),
        fetchAiModels(),
        fetchAiPrompts(),
        fetchAiProviders(),
      ])
      bindings.value = bindingResult.items
      models.value = modelResult.items
      prompts.value = promptResult.items
      providers.value = providerResult.items
      status.value = 'ready'
    }
    catch (cause) {
      error.value = cause
      status.value = 'error'
    }
    finally {
      loading.value = false
    }
  }

  const sceneDrawer = useCrudDrawer<AiSceneBindingForm, AiSceneBindingTableRow, AiSceneBindingMutationResult>({
    createForm: () => toForm(null, SCENE_KEYS[0]),
    editForm: (row) => {
      const binding = bindings.value.find(item => item.scene === row.scene) ?? null
      return toForm(binding, row.scene)
    },
    onError: cause => void feedback.messageError(cause),
    onSuccess: async (result) => {
      await feedback.message('success', result.message)
      await load()
    },
    submit: async ({ data }) => {
      const input: AiSceneBindingInput = {
        scene: data.scene,
        description: data.description.trim() || undefined,
        primaryModelId: data.primaryModelId,
        reasoningModelId: data.reasoningModelId || null,
        fallbackModelId: data.fallbackModelId || null,
        promptTemplateId: data.promptTemplateId || null,
        allowReasoning: data.allowReasoning,
        requireProject: data.requireProject,
        allowFileUpload: data.allowFileUpload,
        allowKnowledgeSearch: data.allowKnowledgeSearch,
        allowTools: data.allowTools,
        temperature: data.temperature || null,
        maxOutputTokens: data.maxOutputTokens || null,
        sort: data.sort === '' ? undefined : Number(data.sort),
        enabled: data.enabled,
      }
      return upsertAiSceneBinding(input)
    },
  })

  return {
    bindings,
    error,
    load,
    loading,
    modelNameById,
    modelOptions,
    modelProviderIdById,
    promptLabelById,
    promptOptions,
    providerNameById,
    providers,
    rows,
    sceneDrawer,
    status,
  }
}

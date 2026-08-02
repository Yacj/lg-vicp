import type { TableRowData } from 'tdesign-vue-next'
import type { AiProvider, AiProviderInput, AiProviderMutationResult } from '@/types/ai'
import {
  createAiProvider,
  deleteAiProvider,
  fetchAiProviders,
  testAiProviderConnection,
  updateAiProvider,
  updateAiProviderStatus,
} from '@/api/modules/ai'
import { ref } from 'vue'
import { useAppFeedback } from './useAppFeedback'
import { confirmAndRun } from './useAppConfirm'
import { useConfirmedCrudAction } from './useCrudActions'
import { useCrudDrawer } from './useCrudDrawer'
import { useCrudList } from './useCrudList'

export type AiProviderTableRow = AiProvider & TableRowData

export interface AiProviderSearchQuery extends Record<string, unknown> {
  keyword: string
  status: 'all' | 'enabled' | 'disabled'
}

export interface AiProviderForm extends Record<string, unknown> {
  name: string
  description: string
  baseUrl: string
  apiKey: string
  /** 空串表示未填写（t-input-number 不接受 null）。 */
  timeoutMs: number | ''
  priority: number | ''
  enabled: boolean
}

/** 连通性测试结果（成功或失败统一进入结果弹窗；耗时本地计时，后端无该字段）。 */
export interface AiProviderTestOutcome {
  providerName: string
  success: boolean
  message: string
  response: string
  durationMs: number
  requestId: string | null
}

function createProviderForm(): AiProviderForm {
  return {
    name: '',
    description: '',
    baseUrl: '',
    apiKey: '',
    timeoutMs: '',
    priority: '',
    enabled: true,
  }
}

function editProviderForm(provider: AiProvider): AiProviderForm {
  return {
    name: provider.name,
    description: provider.description ?? '',
    baseUrl: provider.baseUrl,
    // 密钥永不回显；编辑时留空表示保留原密钥
    apiKey: '',
    timeoutMs: provider.timeoutMs ?? '',
    priority: provider.priority ?? '',
    enabled: provider.enabled,
  }
}

/** 服务商列表为全量返回（{ items }），关键词与状态筛选在客户端完成。 */
export function useAiProviderManagement() {
  const feedback = useAppFeedback()

  const providerList = useCrudList<AiProviderTableRow, AiProviderSearchQuery>({
    createQuery: () => ({ keyword: '', status: 'all' }),
    fetcher: async ({ query }) => {
      const result = await fetchAiProviders()
      const keyword = String(query.keyword ?? '').trim().toLocaleLowerCase()
      const items = result.items.filter((provider) => {
        const matchesKeyword = !keyword
          || provider.name.toLocaleLowerCase().includes(keyword)
          || provider.baseUrl.toLocaleLowerCase().includes(keyword)
        const matchesStatus = query.status === 'all'
          || (query.status === 'enabled' ? provider.enabled : !provider.enabled)
        return matchesKeyword && matchesStatus
      })
      return { items, page: 1, pageSize: items.length || 20, total: items.length }
    },
    immediate: true,
    rowKey: 'id',
  })

  const providerDrawer = useCrudDrawer<AiProviderForm, AiProvider, AiProviderMutationResult>({
    createForm: createProviderForm,
    editForm: editProviderForm,
    onError: error => void feedback.messageError(error),
    onSuccess: async (result) => {
      await feedback.message('success', result.message)
      await providerList.refresh()
    },
    submit: async ({ data, entity, mode }) => {
      const input: AiProviderInput = {
        name: data.name.trim(),
        description: data.description.trim() || undefined,
        baseUrl: data.baseUrl.trim(),
        timeoutMs: data.timeoutMs || undefined,
        priority: data.priority || undefined,
        enabled: data.enabled,
      }
      if (data.apiKey.trim()) {
        input.apiKey = data.apiKey.trim()
      }
      if (mode === 'create') {
        return createAiProvider(input)
      }
      return updateAiProvider(entity!.id, input)
    },
  })

  const providerStatusAction = useConfirmedCrudAction<
    { enabled: boolean, provider: AiProvider },
    AiProviderMutationResult
  >({
    action: ({ enabled, provider }) => updateAiProviderStatus(provider.id, enabled),
    confirm: ({ enabled, provider }) => ({
      content: `确认${enabled ? '启用' : '停用'}服务商“${provider.name}”吗？${enabled ? '' : '停用后其下模型将无法发起 AI 请求。'}`,
      confirmText: enabled ? '启用' : '停用',
      danger: !enabled,
      title: `${enabled ? '启用' : '停用'}服务商`,
    }),
    onSuccess: async () => {
      await providerList.refresh()
    },
    successMessage: (_payload, result) => result.message,
  })

  const providerDeleteAction = useConfirmedCrudAction<AiProvider, { message: string }>({
    action: provider => deleteAiProvider(provider.id),
    confirm: provider => ({
      content: `服务商“${provider.name}”将被永久删除，其下全部模型将一并删除，且无法恢复。`,
      confirmText: '删除',
      danger: true,
      title: '删除服务商',
    }),
    onSuccess: async () => {
      await providerList.refresh()
    },
    successMessage: (_provider, result) => result.message,
  })

  /** 测试连接：确认后调用后端固定提示词测试，成功/失败均进入结果弹窗（含耗时与 requestId）。 */
  const testingProviderId = ref<string | null>(null)
  const testResultVisible = ref(false)
  const testOutcome = ref<AiProviderTestOutcome | null>(null)
  const lastTestedProvider = ref<AiProvider | null>(null)

  async function runConnectionTest(provider: AiProvider): Promise<void> {
    if (testingProviderId.value) {
      return
    }
    testingProviderId.value = provider.id
    try {
      const confirmed = await confirmAndRun({
        content: `将对服务商“${provider.name}”发起一次连接测试请求（使用其模型，非流式）。测试结果会记录到服务商信息中。`,
        confirmText: '开始测试',
        title: '测试服务商连接',
      }, async () => {
        // 确认后才记录，避免取消确认后重试按钮指向未测试的服务商
        lastTestedProvider.value = provider
        const startedAt = performance.now()
        try {
          const result = await testAiProviderConnection(provider.id)
          testOutcome.value = {
            providerName: provider.name,
            success: true,
            message: result.message,
            response: result.response,
            durationMs: Math.round(performance.now() - startedAt),
            requestId: null,
          }
        }
        catch (error) {
          testOutcome.value = {
            providerName: provider.name,
            success: false,
            message: '连接测试失败',
            response: '',
            durationMs: Math.round(performance.now() - startedAt),
            requestId: normalizeRequestId(error),
          }
        }
        testResultVisible.value = true
        await providerList.refresh()
      })
      if (!confirmed.confirmed) {
        return
      }
    }
    finally {
      testingProviderId.value = null
    }
  }

  /** 重试上一次测试（结果弹窗内的重试入口）。 */
  function retryLastTest(): Promise<void> | undefined {
    return lastTestedProvider.value
      ? runConnectionTest(lastTestedProvider.value)
      : undefined
  }

  function closeTestResult(): void {
    testResultVisible.value = false
  }

  return {
    closeTestResult,
    providerDeleteAction,
    providerDrawer,
    providerList,
    providerStatusAction,
    retryLastTest,
    runConnectionTest,
    testOutcome,
    testResultVisible,
    testingProviderId,
  }
}

function normalizeRequestId(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'requestId' in error) {
    const value = (error as { requestId?: unknown }).requestId
    return typeof value === 'string' && value ? value : null
  }
  return null
}
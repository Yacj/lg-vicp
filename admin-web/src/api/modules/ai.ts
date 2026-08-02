import type {
  AiConnectionTestResult,
  AiFeedbackHandleInput,
  AiFeedbackPageResult,
  AiFeedbackQuery,
  AiModel,
  AiModelInput,
  AiModelMutationResult,
  AiPromptDraftInput,
  AiPromptTemplate,
  AiPromptTemplateInput,
  AiPromptTemplateMutationResult,
  AiPromptVersion,
  AiPromptVersionActionResult,
  AiProvider,
  AiProviderInput,
  AiProviderMutationResult,
  AiProviderTestResult,
  AiSceneBinding,
  AiSceneBindingInput,
  AiSceneBindingMutationResult,
  ConversationOpsDetail,
  PlatformConversationPageResult,
  PlatformConversationQuery,
} from '@/types/ai'
import type { ProjectConversationPageResult } from '@/types/project'
import { api } from '@/api/http/client'

const PLATFORM_AI_PREFIX = '/api/v1/platform/ai'

function aiResourcePath(resource: string, id: string): string {
  return `${PLATFORM_AI_PREFIX}/${resource}/${encodeURIComponent(id)}`
}

/**
 * 按项目查询我的 AI 会话（GET /api/v1/ai/conversations?projectId=）。
 * 会话归属规则：仅返回当前用户自己的会话，私有项目仍需后端项目可见性校验。
 */
export function fetchProjectConversations(
  projectId: string,
  query: { page?: number, pageSize?: number },
  signal?: AbortSignal,
): Promise<ProjectConversationPageResult> {
  return api.get<ProjectConversationPageResult>('/api/v1/ai/conversations', {
    params: { ...query, projectId },
    signal,
  })
}

/** 服务商列表（无分页，返回 { items }）。 */
export function fetchAiProviders(signal?: AbortSignal): Promise<{ items: AiProvider[] }> {
  return api.get<{ items: AiProvider[] }>(`${PLATFORM_AI_PREFIX}/providers`, { signal })
}

export function createAiProvider(input: AiProviderInput): Promise<AiProviderMutationResult> {
  return api.post<AiProviderMutationResult>(`${PLATFORM_AI_PREFIX}/providers`, input)
}

export function updateAiProvider(id: string, input: Partial<AiProviderInput>): Promise<AiProviderMutationResult> {
  return api.patch<AiProviderMutationResult>(aiResourcePath('providers', id), input)
}

export function updateAiProviderStatus(id: string, enabled: boolean): Promise<AiProviderMutationResult> {
  return updateAiProvider(id, { enabled })
}

export function deleteAiProvider(id: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(aiResourcePath('providers', id))
}

/** 服务商连通性测试（无请求体；测试结果写库，列表刷新后可见 lastTestStatus）。 */
export function testAiProviderConnection(id: string): Promise<AiProviderTestResult> {
  return api.post<AiProviderTestResult>(`${aiResourcePath('providers', id)}/test-connection`)
}

/** 模型列表（无分页，返回 { items }）。 */
export function fetchAiModels(signal?: AbortSignal): Promise<{ items: AiModel[] }> {
  return api.get<{ items: AiModel[] }>(`${PLATFORM_AI_PREFIX}/models`, { signal })
}

export function createAiModel(input: AiModelInput): Promise<AiModelMutationResult> {
  return api.post<AiModelMutationResult>(`${PLATFORM_AI_PREFIX}/models`, input)
}

export function updateAiModel(id: string, input: Partial<AiModelInput>): Promise<AiModelMutationResult> {
  return api.patch<AiModelMutationResult>(aiResourcePath('models', id), input)
}

export function updateAiModelStatus(id: string, enabled: boolean): Promise<AiModelMutationResult> {
  return updateAiModel(id, { enabled })
}

export function deleteAiModel(id: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(aiResourcePath('models', id))
}

export function testAiModelConnection(id: string): Promise<AiConnectionTestResult> {
  return api.post<AiConnectionTestResult>(`${aiResourcePath('models', id)}/test-connection`)
}

/** 场景绑定列表（无分页，返回 { items }）。 */
export function fetchAiSceneBindings(signal?: AbortSignal): Promise<{ items: AiSceneBinding[] }> {
  return api.get<{ items: AiSceneBinding[] }>(`${PLATFORM_AI_PREFIX}/scene-bindings`, { signal })
}

export function upsertAiSceneBinding(input: AiSceneBindingInput): Promise<AiSceneBindingMutationResult> {
  return api.put<AiSceneBindingMutationResult>(`${PLATFORM_AI_PREFIX}/scene-bindings`, input)
}

/** 提示词模板列表（无分页，返回 { items }，随 activeVersion 投影）。 */
export function fetchAiPrompts(signal?: AbortSignal): Promise<{ items: AiPromptTemplate[] }> {
  return api.get<{ items: AiPromptTemplate[] }>(`${PLATFORM_AI_PREFIX}/prompts`, { signal })
}

/** 创建提示词草稿（POST /prompts；草稿需发布后才生效）。 */
export function createAiPrompt(input: AiPromptTemplateInput): Promise<AiPromptTemplateMutationResult> {
  return api.post<AiPromptTemplateMutationResult>(`${PLATFORM_AI_PREFIX}/prompts`, input)
}

/** 编辑提示词草稿（PATCH /prompts/:id/draft）。 */
export function updateAiPromptDraft(id: string, input: AiPromptDraftInput): Promise<AiPromptVersionActionResult> {
  return api.patch<AiPromptVersionActionResult>(`${aiResourcePath('prompts', id)}/draft`, input)
}

/** 发布提示词草稿（POST /prompts/:id/publish，body { versionId }）。 */
export function publishAiPrompt(id: string, versionId: string): Promise<AiPromptVersionActionResult> {
  return api.post<AiPromptVersionActionResult>(`${aiResourcePath('prompts', id)}/publish`, { versionId })
}

/** 停用当前生效提示词（POST /prompts/:id/disable）。 */
export function disableAiPrompt(id: string): Promise<{ message: string }> {
  return api.post<{ message: string }>(`${aiResourcePath('prompts', id)}/disable`)
}

/** 基于历史版本创建新草稿（POST /prompts/:id/versions/:versionId/rollback）。 */
export function rollbackAiPromptVersion(id: string, versionId: string): Promise<AiPromptVersionActionResult> {
  return api.post<AiPromptVersionActionResult>(`${aiResourcePath('prompts', id)}/versions/${encodeURIComponent(versionId)}/rollback`)
}

/** 提示词版本列表（GET /prompts/:id/versions，按版本号倒序）。 */
export function fetchAiPromptVersions(id: string, signal?: AbortSignal): Promise<{ items: AiPromptVersion[] }> {
  return api.get<{ items: AiPromptVersion[] }>(`${aiResourcePath('prompts', id)}/versions`, { signal })
}

/** 删除提示词草稿版本（DELETE /prompts/:id/versions/:versionId）。 */
export function deleteAiPromptVersion(id: string, versionId: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`${aiResourcePath('prompts', id)}/versions/${encodeURIComponent(versionId)}`)
}

export function deleteAiPrompt(id: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(aiResourcePath('prompts', id))
}

/** 运营会话列表（分页）。 */
export function fetchPlatformConversations(
  query: PlatformConversationQuery,
  signal?: AbortSignal,
): Promise<PlatformConversationPageResult> {
  return api.get<PlatformConversationPageResult>(`${PLATFORM_AI_PREFIX}/conversations`, { params: query, signal })
}

export function fetchPlatformConversationDetail(id: string, signal?: AbortSignal): Promise<ConversationOpsDetail> {
  return api.get<ConversationOpsDetail>(aiResourcePath('conversations', id), { signal })
}

/** 运营反馈列表（分页）。 */
export function fetchPlatformFeedbacks(
  query: AiFeedbackQuery,
  signal?: AbortSignal,
): Promise<AiFeedbackPageResult> {
  return api.get<AiFeedbackPageResult>(`${PLATFORM_AI_PREFIX}/feedbacks`, { params: query, signal })
}

/** 反馈处理（PUT /feedbacks/:id/handle；仅写入处理备注与处理人/时间，无"处理中"中间态）。 */
export function handleAiFeedback(id: string, input: AiFeedbackHandleInput): Promise<{ message: string }> {
  return api.put<{ message: string }>(`${aiResourcePath('feedbacks', id)}/handle`, input)
}

/** 停止 AI 调试生成（POST /debug/:id/stop；流式侧同时 abort 本地 fetch）。 */
export function stopAiDebugChat(id: string): Promise<{ message: string, debugId: string }> {
  return api.post<{ message: string, debugId: string }>(`${PLATFORM_AI_PREFIX}/debug/${encodeURIComponent(id)}/stop`)
}

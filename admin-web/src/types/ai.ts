import type { PageResult } from './api'
import type { ProjectItem } from './project'

/** AI 场景枚举，与后端 shared/constants.ts AI_SCENES 对齐。 */
export type AiScene
  = | 'general_chat'
    | 'project_design'
    | 'material_compare'
    | 'standard_qa'
    | 'report_generate'
    | 'information_extract'

/** 客户端类型，与后端 CLIENT_APPS 对齐。 */
export type AiClientApp = 'pc_ai' | 'b_admin' | 'c_app'

/** 会话推理模式，与后端 ai_reasoning_mode 枚举对齐。 */
export type AiReasoningMode = 'OFF' | 'ON'

/** 反馈反应，与后端 ai_feedback_reaction 枚举对齐。 */
export type AiFeedbackReaction = 'LIKE' | 'DISLIKE'

/** 消息角色，与后端 ai_message_role 枚举对齐。 */
export type AiMessageRole = 'SYSTEM' | 'USER' | 'ASSISTANT' | 'TOOL'

/** 消息状态，与后端 ai_message_status 枚举对齐。 */
export type AiMessageStatus = 'PENDING' | 'STREAMING' | 'COMPLETED' | 'STOPPED' | 'FAILED'

/** 会话状态（varchar，非数据库枚举）。 */
export type AiConversationStatus = 'active' | 'deleted'

/** 模型能力键，与后端 MODEL_CAPABILITY_KEYS 对齐。 */
export type AiCapabilityKey
  = | 'text'
    | 'streaming'
    | 'structuredOutput'
    | 'reasoning'
    | 'reasoningEffort'
    | 'reasoningAlwaysOn'
    | 'tools'
    | 'vision'
    | 'files'
    | (string & {})

/** 最近测试状态（provider 测试连接结果）。 */
export type AiProviderTestStatus = 'OK' | 'FAILED'

/** AI 服务商（列表/详情响应恒脱敏：密钥替换为 hasApiKey/apiKeyMasked）。 */
export interface AiProvider {
  id: string
  code: string | null
  name: string
  description: string | null
  type: 'OPENAI_COMPATIBLE'
  baseUrl: string
  timeoutMs: number | null
  priority: number | null
  lastTestStatus: AiProviderTestStatus | null
  lastTestMessage: string | null
  lastTestAt: string | null
  hasApiKey: boolean
  apiKeyMasked: string
  enabled: boolean
  createdById: string | null
  updatedById: string | null
  createdAt: string
  updatedAt: string
}

/** 创建/修改服务商请求体；编辑时省略 apiKey 表示保留原密钥。 */
export interface AiProviderInput {
  code?: string
  name: string
  description?: string
  baseUrl: string
  apiKey?: string
  timeoutMs?: number
  priority?: number
  enabled?: boolean
}

/** 服务商变更响应。 */
export interface AiProviderMutationResult {
  message: string
  provider?: AiProvider
}

/** 服务商连通性测试响应（测试结果同步写入服务商 lastTestStatus/lastTestAt）。 */
export interface AiProviderTestResult {
  message: string
  response: string
  provider: AiProvider
}

/** AI 模型。 */
export interface AiModel {
  id: string
  providerId: string
  code: string | null
  displayName: string
  modelId: string
  description: string | null
  capabilities: Record<string, boolean>
  contextWindow: number | null
  maxOutputTokens: number | null
  defaultTemperature: number | null
  timeoutMs: number | null
  priority: number | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** 创建/修改模型请求体。 */
export interface AiModelInput {
  providerId: string
  code?: string
  displayName: string
  modelId: string
  description?: string
  capabilities?: Record<string, boolean>
  contextWindow?: number
  maxOutputTokens?: number
  defaultTemperature?: number
  timeoutMs?: number
  priority?: number
  enabled?: boolean
}

/** 模型变更响应。 */
export interface AiModelMutationResult {
  message: string
  model?: AiModel
}

/** 模型连通性测试响应。 */
export interface AiConnectionTestResult {
  message: string
  response: string
}

/** 场景绑定（GET 列表返回的 publicScene 视图，scene 唯一，GET 无分页）。 */
export interface AiSceneBinding {
  id: string
  scene: AiScene
  name: string
  description: string | null
  primaryModelId: string | null
  defaultModelId: string | null
  defaultModelName: string | null
  reasoningModelId: string | null
  reasoningModelName: string | null
  fallbackModelId: string | null
  fallbackModelName: string | null
  promptTemplateId: string | null
  promptId: string | null
  allowReasoning: boolean
  requireProject: boolean
  allowFileUpload: boolean
  allowKnowledgeSearch: boolean
  allowTools: boolean
  temperature: number | null
  maxOutputTokens: number | null
  enabled: boolean
  sort: number | null
  settings: Record<string, unknown>
  activePromptVersionId: string | null
  activePromptVersion: number | null
  createdAt: string
  updatedAt: string
}

/** 场景绑定 upsert 请求体（PUT，按 scene 唯一；scene 编码不可修改）。 */
export interface AiSceneBindingInput {
  scene: AiScene
  name?: string
  description?: string
  primaryModelId?: string | null
  reasoningModelId?: string | null
  fallbackModelId?: string | null
  promptTemplateId?: string | null
  allowReasoning?: boolean
  requireProject?: boolean
  allowFileUpload?: boolean
  allowKnowledgeSearch?: boolean
  allowTools?: boolean
  temperature?: number | null
  maxOutputTokens?: number | null
  sort?: number
  settings?: Record<string, unknown>
  enabled?: boolean
}

/** 场景绑定变更响应（PUT 返回原始 DB 行，非 publicScene 视图）。 */
export interface AiSceneBindingRow {
  id: string
  code: string
  name: string
  description: string | null
  defaultModelId: string | null
  reasoningModelId: string | null
  fallbackModelId: string | null
  promptId: string | null
  allowReasoning: boolean
  requireProject: boolean
  allowFileUpload: boolean
  allowKnowledgeSearch: boolean
  allowTools: boolean
  temperature: number | null
  maxOutputTokens: number | null
  sort: number | null
  enabled: boolean
  settings: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** 场景绑定变更响应。 */
export interface AiSceneBindingMutationResult {
  message: string
  scene?: AiSceneBindingRow
}

/** 提示词版本状态（版本级，非提示词级）。 */
export type AiPromptVersionStatus = 'DRAFT' | 'PUBLISHED' | 'DISABLED'

/** 提示词模板列表项（GET /platform/ai/prompts，随 activeVersion 投影）。 */
export interface AiPromptTemplate {
  id: string
  scene: AiScene
  name: string
  code: string
  description: string | null
  version: number | null
  status: AiPromptVersionStatus | null
  systemPrompt: string | null
  activeVersionId: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** 创建提示词草稿请求体（systemPrompt ≥ 10 字符）。 */
export interface AiPromptTemplateInput {
  scene: AiScene
  name: string
  description?: string
  systemPrompt: string
  changeNote?: string
}

/** 编辑提示词草稿请求体（PATCH /:id/draft）。 */
export interface AiPromptDraftInput {
  name?: string
  description?: string
  systemPrompt: string
  changeNote?: string
}

/** 提示词草稿变更响应。 */
export interface AiPromptTemplateMutationResult {
  message: string
  prompt?: AiPromptTemplate & { draftVersion?: number, draftId?: string }
}

/** 提示词版本（prompt_versions 全行）。 */
export interface AiPromptVersion {
  id: string
  promptId: string
  version: number
  content: string
  status: AiPromptVersionStatus
  changeNote: string | null
  createdById: string | null
  publishedById: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 发布/停用/回滚草稿等版本动作响应。 */
export interface AiPromptVersionActionResult {
  message: string
  version?: { id: string, version: number, status: AiPromptVersionStatus }
  draft?: { id: string, version: number, status: AiPromptVersionStatus }
}

/** AI 会话（ai_conversations 全行）。 */
export interface AiConversation {
  id: string
  userId: string
  projectId: string | null
  clientApp: AiClientApp
  scene: AiScene
  title: string | null
  reasoningMode: AiReasoningMode
  isPinned: boolean
  status: AiConversationStatus
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

/** AI 消息（ai_messages 全行）。 */
export interface AiMessage {
  id: string
  conversationId: string
  userId: string | null
  role: AiMessageRole
  status: AiMessageStatus
  content: string
  reasoningMode: AiReasoningMode
  provider: string | null
  model: string | null
  promptTemplateVersion: number | null
  tokenInput: number | null
  tokenOutput: number | null
  reasoningTokens: number | null
  durationMs: number | null
  startedAt: string | null
  finishedAt: string | null
  errorMessage: string | null
  errorCode: string | null
  requestId: string | null
  stopReason: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

/** 运营会话列表项（GET /platform/ai/conversations）。 */
export interface PlatformConversationItem {
  conversation: AiConversation
  user: {
    id: string
    displayName: string
    phone: string | null
    role: 'SUPER_ADMIN' | 'CHANNEL_USER' | 'NORMAL_USER'
    channelType: 'DEALER' | 'SALESPERSON' | null
  }
  project: { id: string, name: string } | null
  messageCount: number
}

/** 运营会话列表查询参数。 */
export interface PlatformConversationQuery {
  page?: number
  pageSize?: number
  keyword?: string
  userId?: string
  projectId?: string
  clientApp?: AiClientApp
  scene?: AiScene
  status?: AiConversationStatus
}

/** 运营会话列表响应。 */
export type PlatformConversationPageResult = PageResult<PlatformConversationItem>

/** 检索日志（ai_retrieval_logs）。 */
export interface AiRetrievalLog {
  id: string
  conversationId: string
  messageId: string | null
  documentId: string | null
  chunkId: string | null
  score: number | null
  sourcePage: number | null
  sourceTitle: string | null
  createdAt: string
}

/** 工具调用日志（ai_tool_calls）。 */
export interface AiToolCall {
  id: string
  conversationId: string
  messageId: string | null
  toolName: string
  inputJson: Record<string, unknown> | null
  outputJson: Record<string, unknown> | null
  success: boolean
  errorMessage: string | null
  createdAt: string
}

/** 消息反馈（ai_message_feedbacks 全行，含处理字段）。 */
export interface AiMessageFeedback {
  id: string
  messageId: string
  conversationId: string
  projectId: string | null
  userId: string
  reaction: AiFeedbackReaction | null
  reasonCode: string | null
  tags: string[]
  content: string | null
  clientApp: AiClientApp | null
  handledById: string | null
  handledAt: string | null
  handlingNote: string | null
  createdAt: string
  updatedAt: string
}

/** 重新生成记录（ai_message_regenerations）。 */
export interface AiMessageRegeneration {
  id: string
  conversationId: string
  originalMessageId: string
  regeneratedMessageId: string
  userId: string
  reason: string | null
  createdAt: string
}

/** 审计日志（audit_logs）。 */
export interface AiAuditLog {
  id: string
  actorUserId: string | null
  projectId: string | null
  action: string
  targetType: string | null
  targetId: string | null
  beforeJson: unknown
  afterJson: unknown
  ip: string | null
  userAgent: string | null
  requestId: string | null
  createdAt: string
}

/** 报告（reports，运营详情嵌套返回）。 */
export interface AiReport {
  id: string
  projectId: string
  conversationId: string | null
  reportType: string
  status: 'DRAFT' | 'QUEUED' | 'GENERATING' | 'READY' | 'FAILED'
  contentJson: Record<string, unknown> | null
  templateVersion: string
  promptTemplateVersion: number | null
  publishedAt: string | null
  errorMessage: string | null
  createdById: string
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 运营会话详情响应（GET /platform/ai/conversations/:id）。 */
export interface ConversationOpsDetail {
  conversation: AiConversation
  user: {
    id: string
    displayName: string
    phone: string | null
    email: string | null
    role: 'SUPER_ADMIN' | 'CHANNEL_USER' | 'NORMAL_USER'
    channelType: 'DEALER' | 'SALESPERSON' | null
    status: 'ACTIVE' | 'DISABLED'
  }
  project: ProjectItem | null
  messages: AiMessage[]
  processingSummary: {
    stages: Array<{ stage: string, message: string }>
    note: string
  }
  retrievals: AiRetrievalLog[]
  toolCalls: AiToolCall[]
  feedbacks: AiMessageFeedback[]
  regenerations: AiMessageRegeneration[]
  reports: AiReport[]
  tasks: unknown[]
  shareLinks: unknown[]
  shareViews: unknown[]
  auditLogs: AiAuditLog[]
}

/** 反馈列表项（GET /platform/ai/feedbacks）。 */
export interface AiFeedbackItem {
  feedback: AiMessageFeedback
  message: {
    id: string
    content: string
    provider: string | null
    model: string | null
    tokenInput: number | null
    tokenOutput: number | null
    durationMs: number | null
    createdAt: string
  }
  conversation: {
    id: string
    scene: AiScene
    clientApp: AiClientApp
    projectId: string | null
  }
  user: {
    id: string
    displayName: string
    phone: string | null
  }
}

/** 反馈列表查询参数。 */
export interface AiFeedbackQuery {
  page?: number
  pageSize?: number
  projectId?: string
  userId?: string
  reaction?: AiFeedbackReaction
  scene?: AiScene
}

/** 反馈列表响应。 */
export type AiFeedbackPageResult = PageResult<AiFeedbackItem>

/** 反馈处理请求体（PUT /feedbacks/:id/handle；后端仅写入 handlingNote，reasonCode 预留）。 */
export interface AiFeedbackHandleInput {
  handlingNote?: string
  reasonCode?: string
}

// ============ AI 调试台 ============

/** 调试消息角色（debug/chat body 仅支持 user/assistant）。 */
export type AiDebugMessageRole = 'user' | 'assistant'

/** 调试消息（1-30 条，content ≤ 60000 字符）。 */
export interface AiDebugMessage {
  role: AiDebugMessageRole
  content: string
}

/** 调试对话请求体（scene/modelId/promptVersionId 至少指定一项）。 */
export interface AiDebugRequestBody {
  scene?: AiScene
  modelId?: string
  promptVersionId?: string
  reasoningMode?: AiReasoningMode
  messages: AiDebugMessage[]
}

/** done 事件（流式回答完成）。 */
export interface AiDebugDoneData {
  messageId: string
  finishReason: string
  usage: {
    inputTokens: number | null
    outputTokens: number | null
    reasoningTokens: number | null
  }
  model: { id: string }
  latencyMs: number
}

/** stopped 事件（用户停止生成）。 */
export interface AiDebugStoppedData {
  messageId: string
  partialContent: string
  content: string
  usage?: AiDebugDoneData['usage']
}

/** error 事件（生成失败，含 requestId 供排查）。 */
export interface AiDebugErrorData {
  code: string
  message: string
  requestId: string
  retryable: boolean
}

/** SSE 事件判别联合（与后端事件名一一对应）。 */
export type AiDebugSseEvent
  = | { type: 'message', data: { messageId: string, requestId: string } }
    | { type: 'progress', data: { stage: string, message: string } }
    | { type: 'delta', data: { text: string } }
    | { type: 'done', data: AiDebugDoneData }
    | { type: 'stopped', data: AiDebugStoppedData }
    | { type: 'error', data: AiDebugErrorData }

import type {
  AiMessage,
  AiRetrievalLog,
  AiToolCall,
  ConversationOpsDetail,
} from '@/types/ai'
import type { AppStatus } from '@/components/ui/AppStatusTag.vue'

/** 与后端 AGENT_TOOL_NAMES / TOOL 描述对齐，仅展示业务用途，不暴露 Schema 或代码。 */
export const AGENT_TOOL_CATALOG = [
  {
    name: 'search_knowledge',
    label: '知识检索',
    purpose: '检索已发布且当前用户有权访问的知识资料（图集/标准/构造）。',
  },
  {
    name: 'get_project_context',
    label: '项目资料',
    purpose: '读取当前会话关联项目的结构化档案（名称/地区/建筑类型）。',
  },
  {
    name: 'get_project_memory',
    label: '项目记忆',
    purpose: '读取当前项目已确认的长期记忆，不含未核实假设。',
  },
  {
    name: 'thermal_calculate',
    label: '热工计算',
    purpose: '调用系统确定性热工计算引擎，禁止自行估算传热系数。',
  },
  {
    name: 'compare_products',
    label: '产品对比',
    purpose: '对已明确产品做结构化对比，返回动态维度与证据；不打分、不排名、不替用户做唯一最终选择。',
  },
  {
    name: 'get_report_types',
    label: '报告类型',
    purpose: '列出可生成的报告类型及是否必须关联项目。',
  },
  {
    name: 'generate_report',
    label: '生成报告',
    purpose: '仅在用户明确要求生成报告时调用，基于已确认选择或对比快照生成结构化报告。',
  },
] as const

export type AgentToolCatalogName = (typeof AGENT_TOOL_CATALOG)[number]['name']

export type AgentToolRuntimeStatus = 'available' | 'disabled'

/** 服务端环境变量默认值（本页只读，不假装实时读取运行配置）。 */
export const AGENT_RUNTIME_LIMITS = [
  {
    key: 'maxSteps',
    label: '最大步骤数',
    value: 8,
    unit: '步',
    source: 'AI_AGENT_MAX_STEPS',
  },
  {
    key: 'toolTimeoutMs',
    label: '单 Tool 超时',
    value: 20000,
    unit: 'ms',
    source: '服务端默认 20 秒',
  },
  {
    key: 'overallTimeoutMs',
    label: '总超时',
    value: 120000,
    unit: 'ms',
    source: 'AI_AGENT_OVERALL_TIMEOUT_MS',
  },
] as const

export type AgentErrorCategory
  = | 'MODEL_ERROR'
    | 'TOOL_ERROR'
    | 'TOOL_TIMEOUT'
    | 'PERMISSION_DENIED'
    | 'AGENT_LOOP_LIMIT'
    | 'MEMORY_CONFLICT'
    | 'CANCELLED'

export interface AgentErrorDisplay {
  category: AgentErrorCategory
  label: string
  description: string
  sourceCode: string | null
}

export const AGENT_ERROR_CATEGORY_META: Record<AgentErrorCategory, { label: string, description: string }> = {
  AGENT_LOOP_LIMIT: { description: '工具调用次数过多或出现循环，已停止本次任务。', label: '步骤超限' },
  CANCELLED: { description: '本次任务已取消。', label: '已取消' },
  MEMORY_CONFLICT: { description: '项目记忆存在冲突，需要人工确认后再继续。', label: '记忆冲突' },
  MODEL_ERROR: { description: '模型或服务商返回异常，请检查模型配置后重试。', label: '模型异常' },
  PERMISSION_DENIED: { description: '当前账号无权执行该工具或访问相关资料。', label: '权限不足' },
  TOOL_ERROR: { description: '专业工具执行失败，请查看工具结果后重试。', label: '工具失败' },
  TOOL_TIMEOUT: { description: '工具执行超时，请稍后重试。', label: '工具超时' },
}

const MODEL_ERROR_CODES = new Set([
  'AI_PROVIDER_UNAVAILABLE',
  'AI_MODEL_UNAVAILABLE',
  'AI_MODEL_TIMEOUT',
  'AI_PROVIDER_RATE_LIMIT',
  'AI_CONFIG_INVALID',
  'AGENT_MODEL_NOT_CONFIGURED',
  'VISION_MODEL_NOT_CONFIGURED',
  'AI_CONTEXT_TOO_LONG',
  'AI_STREAM_INTERRUPTED',
  'AI_CONTENT_REJECTED',
  'AI_CONTENT_BLOCKED',
  'MODEL_ERROR',
])

export function classifyAgentError(
  errorCode: string | null | undefined,
  errorMessage: string | null | undefined,
  options: { toolFailed?: boolean } = {},
): AgentErrorCategory {
  const code = errorCode?.trim() ?? ''
  const message = errorMessage ?? ''
  if (code === 'AGENT_LOOP_LIMIT' || code === 'AGENT_LOOP_LIMIT'.replace('_', '')) {
    return 'AGENT_LOOP_LIMIT'
  }
  if (code === 'AGENT_TOOL_TIMEOUT' || code === 'TOOL_TIMEOUT') {
    return 'TOOL_TIMEOUT'
  }
  if (code === 'AGENT_CANCELLED' || code === 'CANCELLED') {
    return 'CANCELLED'
  }
  if (code === 'PERMISSION_DENIED' || code === 'AI_CONVERSATION_FORBIDDEN') {
    return 'PERMISSION_DENIED'
  }
  if (code === 'MEMORY_CONFLICT' || /记忆冲突|记忆存在冲突/.test(message)) {
    return 'MEMORY_CONFLICT'
  }
  if (code === 'AGENT_LOOP_LIMIT' || /工具调用次数过多|循环/.test(message)) {
    return 'AGENT_LOOP_LIMIT'
  }
  if (MODEL_ERROR_CODES.has(code) || code === 'MODEL_ERROR') {
    return 'MODEL_ERROR'
  }
  if (options.toolFailed || code === 'TOOL_ERROR') {
    return 'TOOL_ERROR'
  }
  return 'MODEL_ERROR'
}

export function toAgentErrorDisplay(
  errorCode: string | null | undefined,
  errorMessage: string | null | undefined,
  options: { toolFailed?: boolean } = {},
): AgentErrorDisplay {
  const category = classifyAgentError(errorCode, errorMessage, options)
  const meta = AGENT_ERROR_CATEGORY_META[category]
  return {
    category,
    description: errorMessage?.trim() || meta.description,
    label: meta.label,
    sourceCode: errorCode?.trim() || category,
  }
}

export function getAgentToolLabel(toolName: string): string {
  if (toolName === 'compare_products' || toolName === 'compare_solutions') {
    return '产品对比'
  }
  if (toolName === 'generate_report' || toolName === 'generate_report_draft') {
    return '生成报告'
  }
  return AGENT_TOOL_CATALOG.find(item => item.name === toolName)?.label ?? toolName
}

export function getAgentToolPurpose(toolName: string): string {
  return AGENT_TOOL_CATALOG.find(item => item.name === toolName)?.purpose ?? '系统已注册的专业工具。'
}

export function resolveAgentToolStatus(agentEnabled: boolean): AgentToolRuntimeStatus {
  return agentEnabled ? 'available' : 'disabled'
}

export function getAgentToolStatusLabel(status: AgentToolRuntimeStatus): string {
  return status === 'available' ? '可用' : '未启用'
}

export function getAgentToolStatusTone(status: AgentToolRuntimeStatus): AppStatus {
  return status === 'available' ? 'success' : 'disabled'
}

export const GLOBAL_RESPONSE_POLICY_APPLIED_LABEL = '全局回答规则已生效'

function collectMetadataPromptCodes(metadata: Record<string, unknown> | null | undefined): string[] {
  if (!metadata) {
    return []
  }
  const codes: string[] = []
  const list = metadata.appliedPromptCodes ?? metadata.promptCodes
  if (Array.isArray(list)) {
    list.forEach((item) => {
      if (typeof item === 'string' && item.trim()) {
        codes.push(item.trim())
      }
    })
  }
  const single = metadata.appliedPromptCode ?? metadata.promptCode
  if (typeof single === 'string' && single.trim()) {
    codes.push(single.trim())
  }
  return codes
}

export function collectAppliedPromptCodes(detail: ConversationOpsDetail): string[] {
  return [...new Set(detail.messages.flatMap(message => collectMetadataPromptCodes(message.metadata)))]
}

export function resolveRunPromptIndicators(detail: ConversationOpsDetail): {
  appliedCodes: string[]
  globalResponsePolicyApplied: boolean
  systemPromptExposed: false
} {
  const appliedCodes = [...new Set(['GLOBAL_RESPONSE_POLICY', ...collectAppliedPromptCodes(detail)])]
  return {
    appliedCodes,
    globalResponsePolicyApplied: true,
    systemPromptExposed: false,
  }
}

export function formatAgentDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined) {
    return '—'
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`
  }
  return `${(durationMs / 1000).toFixed(1)}s`
}

export type ProjectedAgentRunStatus = 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'STOPPED' | 'RUNNING'

export interface ProjectedAgentToolCall {
  id: string
  name: string
  label: string
  durationMs: number | null
  success: boolean
  errorMessage: string | null
  inputJson: Record<string, unknown> | null
  outputJson: Record<string, unknown> | null
}

export interface ProjectedAgentRun {
  id: string
  conversationId: string
  conversationTitle: string
  userName: string
  projectName: string | null
  userQuestion: string
  status: ProjectedAgentRunStatus
  durationMs: number | null
  model: string | null
  errorCode: string | null
  errorMessage: string | null
  toolCalls: ProjectedAgentToolCall[]
  sources: AiRetrievalLog[]
  startedAt: string
  /** 调试标识：全局回答规则已生效。普通页面不展示完整 System Prompt。 */
  globalResponsePolicyApplied: boolean
  appliedPromptCodes: string[]
}

function messageStatusToRunStatus(status: AiMessage['status']): ProjectedAgentRunStatus {
  if (status === 'FAILED') {
    return 'FAILED'
  }
  if (status === 'STOPPED') {
    return 'CANCELLED'
  }
  if (status === 'STREAMING' || status === 'PENDING') {
    return 'RUNNING'
  }
  return 'COMPLETED'
}

export function getAgentRunStatusLabel(status: ProjectedAgentRunStatus | string): string {
  if (status === 'COMPLETED') {
    return '成功'
  }
  if (status === 'FAILED') {
    return '失败'
  }
  if (status === 'CANCELLED' || status === 'STOPPED') {
    return '已取消'
  }
  if (status === 'WAITING_USER_INPUT') {
    return '等待输入'
  }
  if (status === 'RUNNING') {
    return '进行中'
  }
  return status
}

export function getAgentRunStatusTone(status: ProjectedAgentRunStatus | string): AppStatus {
  if (status === 'COMPLETED') {
    return 'success'
  }
  if (status === 'FAILED') {
    return 'error'
  }
  if (status === 'CANCELLED' || status === 'STOPPED') {
    return 'warning'
  }
  if (status === 'RUNNING' || status === 'WAITING_USER_INPUT') {
    return 'processing'
  }
  return 'default'
}

function toProjectedToolCall(tool: AiToolCall): ProjectedAgentToolCall {
  return {
    durationMs: tool.durationMs ?? null,
    errorMessage: tool.errorMessage,
    id: tool.id,
    inputJson: tool.inputJson,
    label: getAgentToolLabel(tool.toolName),
    name: tool.toolName,
    outputJson: tool.outputJson,
    success: tool.success,
  }
}

function previousUserQuestion(messages: readonly AiMessage[], assistantIndex: number): string {
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'USER' && message.content.trim()) {
      return message.content
    }
  }
  return '（无用户问题）'
}

function sourcesForMessage(retrievals: readonly AiRetrievalLog[], messageId: string): AiRetrievalLog[] {
  return retrievals.filter(item => item.messageId === messageId)
}

/**
 * 从会话运营详情投影 Agent 运行：按助手消息归组 Tool Calls。
 * 不读取模型私有推理内容。
 */
export function projectAgentRunsFromConversation(detail: ConversationOpsDetail): ProjectedAgentRun[] {
  const messages = [...detail.messages].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  const toolsByMessage = new Map<string, AiToolCall[]>()
  detail.toolCalls.forEach((tool) => {
    const key = tool.messageId ?? tool.agentRunId ?? tool.id
    const list = toolsByMessage.get(key) ?? []
    list.push(tool)
    toolsByMessage.set(key, list)
  })

  return messages.flatMap((message, index) => {
    if (message.role !== 'ASSISTANT') {
      return []
    }
    const tools = (toolsByMessage.get(message.id) ?? []).slice().sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt))
    if (tools.length === 0 && message.status !== 'FAILED' && message.status !== 'STOPPED') {
      return []
    }
    const failedTool = tools.find(item => !item.success)
    return [{
      appliedPromptCodes: [...new Set([
        'GLOBAL_RESPONSE_POLICY',
        ...collectMetadataPromptCodes(message.metadata),
      ])],
      conversationId: detail.conversation.id,
      conversationTitle: detail.conversation.title || '未命名会话',
      durationMs: message.durationMs,
      errorCode: message.errorCode,
      errorMessage: message.errorMessage ?? failedTool?.errorMessage ?? null,
      globalResponsePolicyApplied: true,
      id: tools[0]?.agentRunId ?? message.id,
      model: message.model,
      projectName: detail.project?.name ?? null,
      sources: sourcesForMessage(detail.retrievals, message.id),
      startedAt: message.startedAt ?? message.createdAt,
      status: messageStatusToRunStatus(message.status),
      toolCalls: tools.map(toProjectedToolCall),
      userName: detail.user.displayName,
      userQuestion: previousUserQuestion(messages, index),
    }]
  })
}

export function isConversationInDateRange(
  isoTime: string,
  range: readonly string[] | null | undefined,
): boolean {
  if (!range || range.length < 2 || !range[0] || !range[1]) {
    return true
  }
  const time = Date.parse(isoTime)
  const start = Date.parse(`${range[0]}T00:00:00.000`)
  const end = Date.parse(`${range[1]}T23:59:59.999`)
  if (Number.isNaN(time) || Number.isNaN(start) || Number.isNaN(end)) {
    return true
  }
  return time >= start && time <= end
}

export function formatJsonPreview(value: unknown): string {
  if (value === null || value === undefined) {
    return '无'
  }
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

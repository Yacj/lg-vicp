import type {
  AiCapabilityKey,
  AiClientApp,
  AiFeedbackReaction,
  AiMessageRole,
  AiMessageStatus,
  AiPromptVersionStatus,
  AiReasoningMode,
  AiScene,
} from '@/types/ai'
import { marked } from 'marked'

/** AI 场景枚举元数据，严格对齐后端 AI_SCENES 常量。 */
export const AI_SCENE_META: Record<AiScene, { label: string, description: string }> = {
  general_chat: { description: '通用对话，未关联项目的日常问答', label: '通用对话' },
  project_design: { description: '基于项目资料的节能设计方案问答', label: '项目设计' },
  material_compare: { description: '材料与设备的对比选型问答', label: '材料对比' },
  standard_qa: { description: '建筑节能规范与标准问答', label: '规范问答' },
  report_generate: { description: '生成节能设计报告与文档', label: '报告生成' },
  information_extract: { description: '从资料中抽取结构化信息', label: '信息抽取' },
}

export const AI_SCENE_OPTIONS = (Object.keys(AI_SCENE_META) as AiScene[]).map(value => ({
  label: AI_SCENE_META[value].label,
  value,
}))

export function getAiSceneLabel(scene: AiScene | string): string {
  return AI_SCENE_META[scene as AiScene]?.label ?? scene
}

/** 客户端类型标签，对齐后端 CLIENT_APPS。 */
export const AI_CLIENT_APP_META: Record<AiClientApp, string> = {
  b_admin: 'B 端管理台',
  c_app: 'C 端应用',
  pc_ai: 'PC AI 工作台',
}

export function getAiClientAppLabel(clientApp: AiClientApp | string): string {
  return AI_CLIENT_APP_META[clientApp as AiClientApp] ?? clientApp
}

/** 消息角色标签，对齐后端 ai_message_role 枚举。 */
export const AI_MESSAGE_ROLE_META: Record<AiMessageRole, string> = {
  ASSISTANT: '助手',
  SYSTEM: '系统',
  TOOL: '工具',
  USER: '用户',
}

export function getAiMessageRoleLabel(role: AiMessageRole | string): string {
  return AI_MESSAGE_ROLE_META[role as AiMessageRole] ?? role
}

/** 消息状态标签，对齐后端 ai_message_status 枚举。 */
export const AI_MESSAGE_STATUS_META: Record<AiMessageStatus, string> = {
  COMPLETED: '已完成',
  FAILED: '失败',
  PENDING: '等待中',
  STOPPED: '已停止',
  STREAMING: '生成中',
}

export function getAiMessageStatusLabel(status: AiMessageStatus | string): string {
  return AI_MESSAGE_STATUS_META[status as AiMessageStatus] ?? status
}

/** 反馈反应标签，对齐后端 AI_FEEDBACK_REACTIONS。 */
export const AI_FEEDBACK_REACTION_META: Record<AiFeedbackReaction, string> = {
  DISLIKE: '点踩',
  LIKE: '点赞',
}

export function getAiFeedbackReactionLabel(reaction: AiFeedbackReaction | string): string {
  return AI_FEEDBACK_REACTION_META[reaction as AiFeedbackReaction] ?? reaction
}

/** 推理模式标签。 */
export function getAiReasoningModeLabel(mode: AiReasoningMode | string): string {
  return mode === 'ON' ? '深度思考' : '快速回答'
}

/**
 * 提取提示词中的变量占位符（{{xxx}} 形式），按出现顺序去重。
 * 不识别 {{ 与 }} 嵌套，空占位符忽略。
 */
export function extractPromptVariables(systemPrompt: string): string[] {
  const matches = systemPrompt.match(/\{\{[^{}]*\}\}/g) ?? []
  const variables = matches
    .map(match => match.slice(2, -2).trim())
    .filter(Boolean)
  return [...new Set(variables)]
}

/** 计算文本字符数（中文按字计，不含首尾空白）。 */
export function countPromptChars(text: string): number {
  return text.trim().length
}

/** 行级差异类型。 */
export type LineDiffKind = 'equal' | 'added' | 'removed'

export interface LineDiff {
  kind: LineDiffKind
  /** 原版本（旧提示词）行号，1 起；added 行为 null。 */
  oldLine: number | null
  /** 新版本（新提示词）行号，1 起；removed 行为 null。 */
  newLine: number | null
  text: string
}

/**
 * 提示词版本差异对比（基于 LCS 的行级 diff，纯函数无依赖）。
 * oldText 为旧版本，newText 为新版本；equal 行可折叠由展示层决定。
 */
export function diffPromptVersions(oldText: string, newText: string): LineDiff[] {
  const oldLines = oldText.split(/\r?\n/)
  const newLines = newText.split(/\r?\n/)

  const oldCount = oldLines.length
  const newCount = newLines.length
  const lcs: number[][] = Array.from({ length: oldCount + 1 }, () =>
    Array.from({ length: newCount + 1 }, () => 0))

  for (let i = oldCount - 1; i >= 0; i--) {
    for (let j = newCount - 1; j >= 0; j--) {
      lcs[i][j] = oldLines[i] === newLines[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const result: LineDiff[] = []
  let i = 0
  let j = 0
  while (i < oldCount && j < newCount) {
    if (oldLines[i] === newLines[j]) {
      result.push({ kind: 'equal', oldLine: i + 1, newLine: j + 1, text: oldLines[i] })
      i++
      j++
    }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ kind: 'removed', oldLine: i + 1, newLine: null, text: oldLines[i] })
      i++
    }
    else {
      result.push({ kind: 'added', oldLine: null, newLine: j + 1, text: newLines[j] })
      j++
    }
  }
  while (i < oldCount) {
    result.push({ kind: 'removed', oldLine: i + 1, newLine: null, text: oldLines[i] })
    i++
  }
  while (j < newCount) {
    result.push({ kind: 'added', oldLine: null, newLine: j + 1, text: newLines[j] })
    j++
  }
  return result
}

/** 模型能力键标签，对齐后端 MODEL_CAPABILITY_KEYS 白名单。 */
export const AI_MODEL_CAPABILITY_LABELS: Record<AiCapabilityKey, string> = {
  files: '文件',
  reasoning: '深度推理',
  reasoningAlwaysOn: '推理常开',
  reasoningEffort: '推理强度',
  streaming: '流式',
  structuredOutput: '结构化输出',
  text: '文本',
  tools: '工具调用',
  vision: '视觉',
}

/** 模型能力标签（按固定顺序，仅返回开启项）。 */
export function getAiModelCapabilityLabels(capabilities: Record<string, boolean> | undefined | null): string[] {
  if (!capabilities) {
    return []
  }
  return (Object.keys(AI_MODEL_CAPABILITY_LABELS) as AiCapabilityKey[])
    .filter(key => capabilities[key] === true)
    .map(key => AI_MODEL_CAPABILITY_LABELS[key])
}

/** 提示词版本状态标签，对齐后端 DRAFT/PUBLISHED/DISABLED。 */
export const AI_PROMPT_VERSION_STATUS_META: Record<AiPromptVersionStatus, string> = {
  DISABLED: '已停用',
  DRAFT: '草稿',
  PUBLISHED: '已发布',
}

export function getAiPromptVersionStatusLabel(status: AiPromptVersionStatus | string): string {
  return AI_PROMPT_VERSION_STATUS_META[status as AiPromptVersionStatus] ?? status
}

/** 反馈处理状态标签（后端仅两态：已处理/未处理）。 */
export function getAiFeedbackHandledLabel(handledAt: string | null | undefined): string {
  return handledAt ? '已处理' : '未处理'
}

/** HTML 转义：AI 输出渲染前必须转义，杜绝内嵌 HTML/脚本。 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 渲染 AI 回答：先 HTML 转义原文，再解析 Markdown（仅 md 语法，不执行任何 HTML）。 */
export function renderMarkdown(text: string): string {
  const escaped = escapeHtml(text)
  try {
    return marked.parse(escaped, { async: false, breaks: true, gfm: true }) as string
  }
  catch {
    return escaped
  }
}

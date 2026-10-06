import type { UserSelectionKind, UserSelectionOption } from './aiUserSelection.ts'
import type { AiSourceRef, ReportTaskStatus } from '@/api/types'
import {
  parseUserSelectionRequest,
  shouldAutoSelectWhenSingle,
} from './aiUserSelection.ts'

export type AgentRunStatus = 'RUNNING' | 'WAITING_USER_INPUT' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

export interface AgentRunDto {
  id: string
  conversationId: string
  status: AgentRunStatus
  waitingPrompt?: string | null
  waitingOptions?: unknown[] | null
  errorMessage?: string | null
  errorCode?: string | null
  assistantMessageId?: string | null
}

export interface AgentToolStep {
  key: string
  label: string
  status: 'active' | 'done' | 'error'
}

export interface AgentChoiceOption {
  id: string
  label: string
  title?: string
  description: string
  resumeContent: string
  meta?: Record<string, unknown>
  disabled?: boolean
}

export interface ComparisonConfirmAction {
  type: 'CONTINUE' | 'GENERATE_REPORT'
  label: string
}

export interface ParsedNeedInput {
  runId: string
  prompt: string
  title?: string
  description?: string
  mode: 'choice' | 'conflict' | 'text' | 'selection'
  selectionKind?: UserSelectionKind
  options: AgentChoiceOption[]
  conflict?: {
    previous: string
    next: string
  }
  multiple?: boolean
  minSelections?: number
  maxSelections?: number
  autoSelectWhenSingle?: boolean
  confirmAction?: ComparisonConfirmAction
  comparisonResult?: unknown
  hidden?: boolean
}

export interface SessionReport {
  id: string
  projectId: string | null
  title: string
  status?: ReportTaskStatus
  basedOn?: string[]
}

export type ProjectMemoryType = 'FACT' | 'CONSTRAINT' | 'DECISION' | 'PREFERENCE' | 'TODO' | 'ASSUMPTION'
export type ProjectMemoryStatus = 'ACTIVE' | 'PENDING' | 'SUPERSEDED' | 'REJECTED'

export const MEMORY_TYPE_LABELS: Record<ProjectMemoryType, string> = {
  FACT: '项目条件',
  DECISION: '方案决定',
  CONSTRAINT: '约束',
  PREFERENCE: '偏好',
  TODO: '待办',
  ASSUMPTION: '待核实',
}

export const CONFIRMED_MEMORY_ORDER: ProjectMemoryType[] = [
  'FACT',
  'DECISION',
  'CONSTRAINT',
  'PREFERENCE',
  'TODO',
]

const SEARCH_STATUS_COPY = '正在查找相关资料…'
const DEFAULT_STATUS_COPY = '正在整理结果…'
const COMPARE_STATUS_COPY = '正在整理对比结果…'
const REPORT_STATUS_COPY = '正在生成报告…'

const AGENT_TOOL_LABELS: Record<string, { active: string, done: string }> = {
  search_knowledge: { active: SEARCH_STATUS_COPY, done: '已找到相关资料' },
  get_project_context: { active: DEFAULT_STATUS_COPY, done: '已整理结果' },
  get_project_state: { active: DEFAULT_STATUS_COPY, done: '已整理结果' },
  get_project_memory: { active: DEFAULT_STATUS_COPY, done: '已整理结果' },
  get_product_data: { active: SEARCH_STATUS_COPY, done: '已找到相关资料' },
  thermal_calculate: { active: DEFAULT_STATUS_COPY, done: '已整理结果' },
  compare_solutions: { active: COMPARE_STATUS_COPY, done: '已整理对比结果' },
  compare_products: { active: COMPARE_STATUS_COPY, done: '已整理对比结果' },
  get_report_types: { active: REPORT_STATUS_COPY, done: '报告已生成' },
  generate_report_draft: { active: REPORT_STATUS_COPY, done: '报告已生成' },
  generate_report: { active: REPORT_STATUS_COPY, done: '报告已生成' },
}

const TECHNICAL_TEXT_PATTERN = /^(?:tool_|step\s*\d|token|json|chain of thought|cot\b|agent\b|capability\b|scene\b|context\b|memory\b|toolcall|search_knowledge running|agent step)/i
const HIDDEN_CONCEPT_PATTERN = /\b(?:Agent|Tool|Scene|Capability|Context|Memory)\b|项目上下文|Project Context|思考链|内部 Prompt|知识库工具|ToolCall|tool_start|agent_status/i

export function isUserFacingStatusText(value: string) {
  const text = value.trim()
  if (!text) {
    return false
  }
  if (TECHNICAL_TEXT_PATTERN.test(text) || HIDDEN_CONCEPT_PATTERN.test(text)) {
    return false
  }
  if (/正在(?:调用|执行)/.test(text) || (/工具/.test(text) && /调用|执行/.test(text))) {
    return false
  }
  if (text.startsWith('{') || text.startsWith('[')) {
    return false
  }
  return !Object.prototype.hasOwnProperty.call(AGENT_TOOL_LABELS, text)
}

export function agentActiveLabel(toolName?: string | null, message?: string | null) {
  const mapped = toolName && AGENT_TOOL_LABELS[toolName] ? AGENT_TOOL_LABELS[toolName].active : ''
  const text = message?.trim() || ''
  if (text && isUserFacingStatusText(text)) {
    return text
  }
  return mapped || DEFAULT_STATUS_COPY
}

export function agentDoneLabel(toolName?: string | null, success = true) {
  if (!success) {
    return DEFAULT_STATUS_COPY
  }
  if (toolName && AGENT_TOOL_LABELS[toolName]) {
    return AGENT_TOOL_LABELS[toolName].done
  }
  return DEFAULT_STATUS_COPY
}

export function isReportTool(toolName?: string | null) {
  return toolName === 'generate_report_draft' || toolName === 'generate_report'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function formatScheme(value: unknown) {
  if (typeof value === 'string') {
    return value.trim()
  }
  const record = asRecord(value)
  if (!record) {
    return ''
  }
  const parts = [
    asText(record.name),
    asText(record.title),
    asText(record.systemName),
    asText(record.materialName),
    asText(record.schemeName),
  ].filter(Boolean)
  const thickness = asNumber(record.thicknessMm) ?? asNumber(record.thickness)
  if (thickness != null) {
    parts.push(`${thickness}mm`)
  }
  return parts.filter((item, index) => parts.indexOf(item) === index).join(' · ')
}

function conflictValues(value: unknown) {
  const record = asRecord(value)
  if (!record) {
    return null
  }
  const type = asText(record.type) || asText(record.kind)
  const previous = asText(record.previous) || asText(record.oldValue) || asText(record.original) || asText(record.from)
  const next = asText(record.next) || asText(record.newValue) || asText(record.current) || asText(record.to)
  if ((type === 'memory_conflict' || type === 'conflict' || (previous && next)) && previous && next) {
    return { previous, next }
  }
  return null
}

function optionDescription(record: Record<string, unknown>, index: number) {
  const scheme = formatScheme(record.scheme ?? record)
  const kValue = asNumber(record.kValue) ?? asNumber(record.K)
  const bits = [
    scheme,
    kValue != null ? `K = ${kValue}` : '',
    asText(record.description),
    asText(record.summary),
  ].filter(Boolean)
  return bits.join(' · ') || `方案${index}`
}

function toChoiceOptions(options: UserSelectionOption[]): AgentChoiceOption[] {
  return options.map(item => ({
    id: item.id,
    label: item.title,
    title: item.title,
    description: item.description,
    resumeContent: item.resumeContent,
    meta: item.meta,
    disabled: item.disabled,
  }))
}

export function parseNeedUserInput(payload: {
  runId?: string
  prompt?: string
  title?: string
  description?: string
  type?: string
  selectionKind?: string
  options?: unknown
  multiple?: boolean
  minSelections?: number
  maxSelections?: number
  autoSelectWhenSingle?: boolean
  confirmAction?: unknown
  comparisonResult?: unknown
  request?: unknown
}): ParsedNeedInput | null {
  const runId = asText(payload.runId)
  if (!runId) {
    return null
  }
  const prompt = asText(payload.prompt) || asText(payload.description) || '请确认后继续'
  const title = asText(payload.title)
  const rawOptions = Array.isArray(payload.options) ? payload.options : []
  const structured = parseUserSelectionRequest({
    type: payload.type,
    selectionKind: payload.selectionKind,
    title: payload.title,
    description: payload.description || payload.prompt,
    prompt: payload.prompt,
    options: rawOptions,
    multiple: payload.multiple,
    minSelections: payload.minSelections,
    maxSelections: payload.maxSelections,
    autoSelectWhenSingle: payload.autoSelectWhenSingle,
    confirmAction: payload.confirmAction,
    request: payload.request,
  })

  if (structured) {
    return {
      runId,
      prompt: structured.description || prompt,
      title: structured.title || title,
      description: structured.description,
      mode: 'selection',
      selectionKind: structured.selectionKind,
      options: toChoiceOptions(structured.options),
      multiple: structured.multiple,
      minSelections: structured.minSelections,
      maxSelections: structured.maxSelections,
      autoSelectWhenSingle: structured.autoSelectWhenSingle,
      confirmAction: structured.confirmAction,
      comparisonResult: payload.comparisonResult,
      hidden: shouldAutoSelectWhenSingle(structured),
    }
  }

  const conflictFromOptions = rawOptions.map(conflictValues).find(Boolean)
  const promptLooksLikeConflict = /不同|冲突|覆盖|原值|新值/.test(prompt)

  if (payload.type !== 'CHOICE' && (conflictFromOptions || (promptLooksLikeConflict && rawOptions.length <= 2))) {
    const previous = conflictFromOptions?.previous || asText(asRecord(rawOptions[0])?.label) || asText(rawOptions[0])
    const next = conflictFromOptions?.next || asText(asRecord(rawOptions[1])?.label) || asText(rawOptions[1])
    if (previous && next) {
      return {
        runId,
        prompt: promptLooksLikeConflict ? prompt : '检测到新的项目条件与之前记录不同',
        title,
        mode: 'conflict',
        options: [
          { id: 'use-new', label: '使用新值', description: next, resumeContent: '使用新值' },
          { id: 'keep-old', label: '保留原值', description: previous, resumeContent: '保留原值' },
        ],
        conflict: { previous, next },
      }
    }
  }

  const options = rawOptions.map((item, index) => {
    const record = asRecord(item)
    const order = asNumber(record?.index) ?? index + 1
    const label = asText(record?.label) || `方案${order}`
    const description = record ? optionDescription(record, order) : asText(item) || label
    const resumeContent = asText(record?.label) || asText(record?.resumeContent) || label
    return {
      id: asText(record?.candidateId) || asText(record?.id) || `${order}`,
      label,
      description: description === label ? '' : description,
      resumeContent,
    }
  }).filter(item => item.label)

  if (options.length) {
    return {
      runId,
      prompt,
      title,
      mode: 'choice',
      selectionKind: 'GENERIC',
      options,
      multiple: false,
      minSelections: 1,
      maxSelections: 1,
      confirmAction: { type: 'CONTINUE', label: '确认' },
    }
  }
  return { runId, prompt, title, mode: 'text', options: [] }
}

export function isProductSelection(input: ParsedNeedInput | null | undefined) {
  return input?.mode === 'selection' && input.selectionKind === 'PRODUCT'
}

export function isVisibleSelection(input: ParsedNeedInput | null | undefined) {
  return Boolean(input && (input.mode === 'selection' || input.mode === 'choice') && input.options.length && !input.hidden)
}

export function applyToolStart(steps: AgentToolStep[], toolName?: string | null, message?: string | null): AgentToolStep[] {
  const label = agentActiveLabel(toolName, message)
  const key = toolName || steps.find(step => step.status === 'active')?.key || `step-${steps.length + 1}`
  const next = steps.map(step => (
    step.status === 'active' && step.key !== key
      ? { ...step, status: 'done' as const }
      : step
  ))
  const existing = next.findIndex(step => step.key === key)
  if (existing >= 0) {
    next[existing] = { key, label, status: 'active' }
    return next
  }
  return [...next, { key, label, status: 'active' }]
}

export function applyToolResult(steps: AgentToolStep[], toolName?: string | null, success = true): AgentToolStep[] {
  const label = agentDoneLabel(toolName, success)
  const key = toolName || steps.find(step => step.status === 'active')?.key
  if (!key) {
    return [...steps, { key: `done-${steps.length + 1}`, label, status: success ? 'done' : 'error' }]
  }
  let found = false
  const next = steps.map((step) => {
    if (step.key !== key || found) {
      return step.status === 'active' && !toolName ? { ...step, label, status: success ? 'done' as const : 'error' as const } : step
    }
    found = true
    return { ...step, label, status: success ? 'done' as const : 'error' as const }
  })
  return found ? next : [...next, { key, label, status: success ? 'done' : 'error' }]
}

export function dedupeAiSources(sources: AiSourceRef[]): AiSourceRef[] {
  const seen = new Set<string>()
  const result: AiSourceRef[] = []
  for (const source of sources) {
    const key = [
      source.documentId || '',
      source.sectionId || '',
      source.pageId || '',
      source.pageLabel || '',
      source.title,
    ].join('|')
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(source)
  }
  return result
}

export function reportTitleFromUnknown(value: unknown, fallback = '报告已生成') {
  const record = asRecord(value)
  const nested = asRecord(record?.contentJson) || asRecord(record?.draft)
  return asText(nested?.title) || asText(record?.title) || fallback
}

export function memoryStatusLabel(status: ProjectMemoryStatus) {
  if (status === 'SUPERSEDED') {
    return '已更新'
  }
  if (status === 'REJECTED') {
    return '已作废'
  }
  if (status === 'PENDING') {
    return '待确认'
  }
  return '已确认'
}

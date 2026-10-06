/**
 * 统一 USER_SELECTION 协议。
 * 图集来源 / 报告类型 / 产品多选共用同一套 WAITING JSON，不再各自造选择协议。
 */

export const USER_SELECTION_KINDS = ['KNOWLEDGE_SOURCE', 'REPORT_TYPE', 'PRODUCT', 'GENERIC'] as const
export type UserSelectionKind = (typeof USER_SELECTION_KINDS)[number]
export type UserSelectionConfirmActionType = 'CONTINUE' | 'GENERATE_REPORT'

export interface UserSelectionOption {
  id: string
  title: string
  description: string
  meta?: Record<string, unknown>
  disabled?: boolean
  resumeContent: string
}

export interface UserSelectionConfirmAction {
  type: UserSelectionConfirmActionType
  label: string
}

export interface UserSelectionRequest {
  type: 'USER_SELECTION'
  selectionKind: UserSelectionKind
  title: string
  description?: string
  multiple: boolean
  minSelections: number
  maxSelections?: number
  autoSelectWhenSingle: boolean
  options: UserSelectionOption[]
  confirmAction: UserSelectionConfirmAction
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

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

export function isUserSelectionKind(value: unknown): value is UserSelectionKind {
  return typeof value === 'string' && (USER_SELECTION_KINDS as readonly string[]).includes(value)
}

export function uniqueSelectedIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.map(item => item?.trim() ?? '').filter(Boolean))]
}

export function defaultSelectionTitle(kind: UserSelectionKind) {
  if (kind === 'KNOWLEDGE_SOURCE') {
    return '选择参考资料'
  }
  if (kind === 'REPORT_TYPE') {
    return '选择报告类型'
  }
  if (kind === 'PRODUCT') {
    return '请选择需要纳入报告的产品/方案'
  }
  return '请选择后继续'
}

export function defaultConfirmAction(kind: UserSelectionKind, multiple: boolean): UserSelectionConfirmAction {
  if (kind === 'KNOWLEDGE_SOURCE') {
    return { type: 'CONTINUE', label: '确认使用' }
  }
  if (kind === 'REPORT_TYPE') {
    return { type: 'CONTINUE', label: '继续' }
  }
  if (kind === 'PRODUCT') {
    return { type: 'GENERATE_REPORT', label: '确认并生成报告' }
  }
  return { type: multiple ? 'CONTINUE' : 'CONTINUE', label: '确认' }
}

export function parseConfirmAction(
  value: unknown,
  kind: UserSelectionKind,
  multiple: boolean,
): UserSelectionConfirmAction {
  const record = asRecord(value)
  const fallback = defaultConfirmAction(kind, multiple)
  if (!record) {
    return fallback
  }
  const type = record.type === 'GENERATE_REPORT' ? 'GENERATE_REPORT' : 'CONTINUE'
  return {
    type,
    label: asText(record.label) || (type === 'GENERATE_REPORT' ? '确认并生成报告' : fallback.label),
  }
}

function knowledgeKindLabel(kind: unknown) {
  if (kind === 'atlas') {
    return '图集'
  }
  if (kind === 'standard') {
    return '标准规范'
  }
  if (kind === 'technical_manual') {
    return '技术手册'
  }
  if (kind === 'approved_document') {
    return '已发布资料'
  }
  return ''
}

export function optionMetaLines(kind: UserSelectionKind | undefined, option: UserSelectionOption): string[] {
  const meta = option.meta || {}
  const lines: string[] = []
  if (kind === 'KNOWLEDGE_SOURCE') {
    const typeLabel = knowledgeKindLabel(meta.kind) || asText(meta.docType)
    const scope = asText(meta.scope) || asText(meta.applicableTo) || asText(meta.application)
    const published = asText(meta.publishedAt) || asText(meta.publishTime) || asText(meta.published)
    if (typeLabel) {
      lines.push(typeLabel)
    }
    if (scope) {
      lines.push(`适用：${scope}`)
    }
    else if (option.description && option.description !== typeLabel) {
      lines.push(option.description.startsWith('适用') ? option.description : `适用：${option.description}`)
    }
    if (published) {
      lines.push(published)
    }
    return lines
  }
  if (kind === 'REPORT_TYPE') {
    return option.description ? [option.description] : []
  }
  if (kind === 'PRODUCT') {
    return option.description ? [option.description] : []
  }
  return option.description ? [option.description] : []
}

export function parseSelectionOptions(rawOptions: unknown[]): UserSelectionOption[] {
  return rawOptions.map((item, index) => {
    const record = asRecord(item)
    const order = asNumber(record?.index) ?? index + 1
    const title = asText(record?.title)
      || asText(record?.label)
      || asText(record?.name)
      || `选项${order}`
    const description = asText(record?.description)
      || asText(record?.summary)
      || asText(record?.keyFeatures)
    const meta = asRecord(record?.meta) || asRecord(record?.data) || undefined
    const id = asText(record?.id)
      || asText(record?.productId)
      || asText(record?.candidateId)
      || asText(record?.code)
      || `${order}`
    return {
      id,
      title,
      description,
      meta,
      disabled: record?.disabled === true,
      resumeContent: asText(record?.resumeContent) || title,
    }
  }).filter(item => item.id && item.title)
}

function inferSelectionKind(payload: {
  type?: string
  selectionKind?: unknown
  multiple?: boolean
  confirmAction?: unknown
}): UserSelectionKind {
  if (isUserSelectionKind(payload.selectionKind)) {
    return payload.selectionKind
  }
  if (payload.type === 'COMPARISON_SELECTION') {
    return 'PRODUCT'
  }
  const confirm = asRecord(payload.confirmAction)
  if (payload.multiple && confirm?.type === 'GENERATE_REPORT') {
    return 'PRODUCT'
  }
  return 'GENERIC'
}

/**
 * 兼容扁平 waiting 与嵌套 request：优先 request（统一协议），其余字段作 fallback。
 */
export function parseUserSelectionRequest(raw: unknown): UserSelectionRequest | null {
  const value = asRecord(raw)
  if (!value) {
    return null
  }
  const nested = asRecord(value.request)
  const source = nested?.type === 'USER_SELECTION'
    ? nested
    : value.type === 'USER_SELECTION'
      ? value
      : null
  const type = asText(source?.type) || asText(value.type)
  const isLegacyComparison = type === 'COMPARISON_SELECTION'
    || (value.multiple === true && asRecord(value.confirmAction)?.type === 'GENERATE_REPORT')
  if (!source && !isLegacyComparison && type !== 'USER_SELECTION') {
    return null
  }
  const record = source || value
  const options = parseSelectionOptions(Array.isArray(record.options) ? record.options : (Array.isArray(value.options) ? value.options : []))
  if (!options.length) {
    return null
  }
  const selectionKind = inferSelectionKind({
    type,
    selectionKind: record.selectionKind ?? value.selectionKind,
    multiple: record.multiple === true || value.multiple === true || isLegacyComparison,
    confirmAction: record.confirmAction ?? value.confirmAction,
  })
  const multiple = asBoolean(record.multiple ?? value.multiple, selectionKind === 'PRODUCT' || selectionKind === 'KNOWLEDGE_SOURCE' || isLegacyComparison)
  const minSelections = asNumber(record.minSelections ?? value.minSelections) ?? 1
  const maxSelections = asNumber(record.maxSelections ?? value.maxSelections) ?? (multiple ? undefined : 1)
  return {
    type: 'USER_SELECTION',
    selectionKind,
    title: asText(record.title) || asText(value.title) || defaultSelectionTitle(selectionKind),
    description: asText(record.description) || asText(record.prompt) || asText(value.description) || asText(value.prompt) || undefined,
    multiple,
    minSelections: minSelections > 0 ? minSelections : 1,
    maxSelections,
    autoSelectWhenSingle: asBoolean(record.autoSelectWhenSingle ?? value.autoSelectWhenSingle, true),
    options,
    confirmAction: parseConfirmAction(record.confirmAction ?? value.confirmAction, selectionKind, multiple),
  }
}

export function shouldAutoSelectWhenSingle(request: Pick<UserSelectionRequest, 'autoSelectWhenSingle' | 'options' | 'minSelections'> | null | undefined) {
  if (!request?.autoSelectWhenSingle) {
    return false
  }
  if (request.options.length !== 1) {
    return false
  }
  if (request.minSelections > 1) {
    return false
  }
  return Boolean(request.options[0]?.id)
}

export function autoSelectWhenSingleOption(request: UserSelectionRequest | null | undefined): string[] | null {
  if (!shouldAutoSelectWhenSingle(request) || !request) {
    return null
  }
  const onlyId = request.options[0]?.id
  return onlyId ? [onlyId] : null
}

export function canConfirmSelection(selectedCount: number, request: Pick<UserSelectionRequest, 'minSelections' | 'maxSelections' | 'multiple'> | null | undefined) {
  if (!request) {
    return false
  }
  if (selectedCount < request.minSelections) {
    return false
  }
  if (request.maxSelections != null && selectedCount > request.maxSelections) {
    return false
  }
  if (!request.multiple && selectedCount > 1) {
    return false
  }
  return selectedCount > 0
}

export function nextSelectedIds(
  current: string[],
  optionId: string,
  request: Pick<UserSelectionRequest, 'multiple' | 'maxSelections'> | null | undefined,
): string[] {
  if (!request) {
    return current
  }
  if (!request.multiple) {
    return current[0] === optionId ? current : [optionId]
  }
  const index = current.indexOf(optionId)
  if (index >= 0) {
    return current.filter(id => id !== optionId)
  }
  if (request.maxSelections != null && current.length >= request.maxSelections) {
    return current
  }
  return [...current, optionId]
}

export function selectionResumeAction(request: UserSelectionRequest): ConversationUiAction | undefined {
  if (request.selectionKind === 'KNOWLEDGE_SOURCE') {
    return 'SELECT_KNOWLEDGE_SOURCES'
  }
  if (request.confirmAction.type === 'GENERATE_REPORT' || request.selectionKind === 'PRODUCT') {
    return 'GENERATE_REPORT'
  }
  return undefined
}

export type ConversationUiAction = 'SELECT_PRODUCTS' | 'GENERATE_REPORT' | 'SELECT_KNOWLEDGE_SOURCES'

export function fromParsedWaiting(waiting: {
  selectionKind?: UserSelectionKind
  title?: string
  description?: string
  prompt?: string
  multiple?: boolean
  minSelections?: number
  maxSelections?: number
  autoSelectWhenSingle?: boolean
  options: Array<{
    id: string
    label: string
    title?: string
    description: string
    meta?: Record<string, unknown>
    disabled?: boolean
    resumeContent: string
  }>
  confirmAction?: UserSelectionConfirmAction
}): UserSelectionRequest {
  const selectionKind = waiting.selectionKind || 'GENERIC'
  const multiple = waiting.multiple === true
  return {
    type: 'USER_SELECTION',
    selectionKind,
    title: waiting.title || defaultSelectionTitle(selectionKind),
    description: waiting.description || waiting.prompt,
    multiple,
    minSelections: waiting.minSelections && waiting.minSelections > 0 ? waiting.minSelections : 1,
    maxSelections: waiting.maxSelections,
    autoSelectWhenSingle: waiting.autoSelectWhenSingle !== false,
    options: waiting.options.map(item => ({
      id: item.id,
      title: item.title || item.label,
      description: item.description,
      meta: item.meta,
      disabled: item.disabled,
      resumeContent: item.resumeContent || item.title || item.label,
    })),
    confirmAction: waiting.confirmAction || defaultConfirmAction(selectionKind, multiple),
  }
}

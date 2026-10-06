import type {
  AiAdmissionCheckResult,
  AiModel,
  AiModelInput,
  AiModelTestResult,
  AiModelTestStatus,
  AiProvider,
  AiReasoningLevel,
} from '@/types/ai'
import { BusinessError, HttpRequestError } from '@/types/error'

export const AI_REASONING_LEVELS = ['LOW', 'HIGH', 'MAX'] as const

export const AI_REASONING_LEVEL_META: Record<AiReasoningLevel, { label: string, hint: string }> = {
  HIGH: { hint: '适合日常AI和Agent任务', label: '高' },
  LOW: { hint: '适合简单任务', label: '低' },
  MAX: { hint: '适合复杂分析任务，通常成本和耗时更高', label: '最高' },
}

export const AI_REASONING_LEVEL_OPTIONS = AI_REASONING_LEVELS.map(value => ({
  hint: AI_REASONING_LEVEL_META[value].hint,
  label: AI_REASONING_LEVEL_META[value].label,
  value,
}))

export type AiModelDisplayTestStatus = AiModelTestStatus | 'STALE'

export const ENABLE_MODEL_REQUIRES_TEST_HINT = '请先完成模型检测，并确保所有必需能力正常。'

export const TOOL_CALLING_BLOCKED_HINT = '当前模型无法完成系统要求的工具调用，不能启用为正式模型。'

export const MODEL_PROMPT_DUTY_HINT = '回答风格、精炼程度和业务关注点请前往“提示词配置”维护。全局回答规则控制怎么说。'

export const MODEL_PROMPT_DUTY_PATH = '/ai-config/business-prompts'

export interface AiModelForm extends Record<string, unknown> {
  providerId: string
  displayName: string
  modelId: string
  supportsVision: boolean
  reasoningLevel: AiReasoningLevel
  enabled: boolean
  isDefault: boolean
}

export interface AiModelIdentity {
  providerId: string
  modelId: string
  supportsVision: boolean
  reasoningLevel: AiReasoningLevel
}

export type AiModelTestErrorKind
  = | 'connection'
    | 'auth'
    | 'model_not_found'
    | 'text'
    | 'tool_calling'
    | 'vision'
    | 'reasoning'
    | 'provider_config'

export const AI_MODEL_TEST_ERROR_LABELS: Record<AiModelTestErrorKind, string> = {
  auth: '认证失败',
  connection: '连接失败',
  model_not_found: '模型不存在',
  provider_config: 'Provider配置错误',
  reasoning: '推理强度不支持',
  text: '文本生成失败',
  tool_calling: 'Agent工具调用失败',
  vision: '图片输入失败',
}

export interface AiAdmissionCheckRow {
  key: keyof AiModelTestResult['checks']
  label: string
  state: 'ok' | 'failed' | 'skipped'
  message: string
}

const ADMISSION_CHECK_LABELS: Record<keyof AiModelTestResult['checks'], string> = {
  connection: '接口连接',
  reasoning: '推理配置',
  text: '文本生成',
  toolCalling: 'Agent工具调用',
  vision: '图片输入',
}

const LEGACY_MODEL_INPUT_KEYS = [
  'temperature',
  'defaultTemperature',
  'topP',
  'presencePenalty',
  'frequencyPenalty',
  'maxOutputTokens',
  'maxTokens',
  'timeoutMs',
  'contextWindow',
  'answerStyle',
  'responseStyle',
  'capabilities',
  'supportsTools',
  'supportsAgent',
  'supportsText',
  'supportsStreaming',
  'supportsReasoning',
  'responseFormat',
  'toolChoice',
] as const

export function createAiModelForm(): AiModelForm {
  return {
    displayName: '',
    enabled: false,
    isDefault: false,
    modelId: '',
    providerId: '',
    reasoningLevel: 'HIGH',
    supportsVision: false,
  }
}

export function editAiModelForm(model: AiModel): AiModelForm {
  return {
    displayName: model.displayName || model.name || '',
    enabled: model.enabled,
    isDefault: model.isDefault,
    modelId: model.modelId,
    providerId: model.providerId,
    reasoningLevel: isAiReasoningLevel(model.reasoningLevel) ? model.reasoningLevel : 'HIGH',
    supportsVision: model.supportsVision === true,
  }
}

export function getModelIdentity(source: AiModelIdentity): AiModelIdentity {
  return {
    modelId: source.modelId.trim(),
    providerId: source.providerId,
    reasoningLevel: source.reasoningLevel,
    supportsVision: source.supportsVision,
  }
}

export function isModelIdentityChanged(before: AiModelIdentity, after: AiModelIdentity): boolean {
  const saved = getModelIdentity(before)
  const next = getModelIdentity(after)
  return saved.providerId !== next.providerId
    || saved.modelId !== next.modelId
    || saved.supportsVision !== next.supportsVision
    || saved.reasoningLevel !== next.reasoningLevel
}

export function toAiModelInput(
  form: AiModelForm,
  options: { mode: 'create' | 'edit', identityChanged?: boolean } = { mode: 'edit' },
): AiModelInput {
  const blocked = options.mode === 'create' || options.identityChanged === true
  return {
    displayName: form.displayName.trim(),
    enabled: blocked ? false : form.enabled,
    isDefault: blocked ? false : form.isDefault,
    modelId: form.modelId.trim(),
    providerId: form.providerId,
    reasoningLevel: form.reasoningLevel,
    supportsVision: form.supportsVision,
  }
}

export function assertNoLegacyModelInputFields(input: object): string[] {
  return LEGACY_MODEL_INPUT_KEYS.filter(key => key in input)
}

export function isAiReasoningLevel(value: unknown): value is AiReasoningLevel {
  return value === 'LOW' || value === 'HIGH' || value === 'MAX'
}

export function getAiReasoningLevelLabel(level: AiReasoningLevel | string | null | undefined): string {
  if (isAiReasoningLevel(level)) {
    return AI_REASONING_LEVEL_META[level].label
  }
  return '-'
}

export function resolveDisplayedTestStatus(
  saved: AiModelTestStatus | null | undefined,
  identityChanged: boolean,
): AiModelDisplayTestStatus {
  if (identityChanged) {
    return 'STALE'
  }
  if (saved === 'PASSED' || saved === 'FAILED' || saved === 'UNTESTED') {
    return saved
  }
  return 'UNTESTED'
}

export function getDisplayedTestStatusLabel(status: AiModelDisplayTestStatus): string {
  if (status === 'PASSED') {
    return '正常'
  }
  if (status === 'FAILED') {
    return '异常'
  }
  if (status === 'STALE') {
    return '需要重新检测'
  }
  return '未测试'
}

export function getDisplayedTestStatusTone(
  status: AiModelDisplayTestStatus,
): 'success' | 'error' | 'warning' | 'disabled' {
  if (status === 'PASSED') {
    return 'success'
  }
  if (status === 'FAILED') {
    return 'error'
  }
  if (status === 'STALE') {
    return 'warning'
  }
  return 'disabled'
}

export function canEnableModel(status: AiModelDisplayTestStatus): boolean {
  return status === 'PASSED'
}

export function canSetDefaultModel(
  model: Pick<AiModel, 'enabled' | 'lastTestStatus'>,
  identityChanged = false,
): boolean {
  if (identityChanged) {
    return false
  }
  return model.enabled === true && model.lastTestStatus === 'PASSED'
}

export function resolveSelectedProvider(
  providers: readonly AiProvider[],
  providerId: string,
): AiProvider | undefined {
  return providers.find(provider => provider.id === providerId)
}

export function getProviderBaseUrlPreview(provider: AiProvider | undefined): string {
  return provider?.baseUrl?.trim() || ''
}

export function getProviderCredentialPreview(provider: AiProvider | undefined): string {
  if (!provider) {
    return ''
  }
  if (provider.apiKeyMasked) {
    return provider.apiKeyMasked
  }
  return provider.hasApiKey ? '已配置' : '未配置'
}

export function buildAdmissionCheckRows(
  report: AiModelTestResult | null | undefined,
  supportsVision: boolean,
): AiAdmissionCheckRow[] {
  const keys: Array<keyof AiModelTestResult['checks']> = [
    'connection',
    'text',
    'toolCalling',
    'reasoning',
    'vision',
  ]
  return keys.map((key) => {
    if (key === 'vision' && !supportsVision) {
      return {
        key,
        label: ADMISSION_CHECK_LABELS.vision,
        message: '未启用',
        state: 'skipped',
      }
    }
    const check = report?.checks[key]
    if (!check) {
      return {
        key,
        label: ADMISSION_CHECK_LABELS[key],
        message: '未测试',
        state: 'skipped',
      }
    }
    return {
      key,
      label: ADMISSION_CHECK_LABELS[key],
      message: check.ok ? '正常' : classifyCheckFailure(key, check).label,
      state: check.ok ? 'ok' : 'failed',
    }
  })
}

export function isToolCallingBlocked(report: AiModelTestResult | null | undefined): boolean {
  return report?.checks.toolCalling.ok === false
}

export function classifyModelTestFailure(input: {
  error?: unknown
  report?: AiModelTestResult | null
}): { kind: AiModelTestErrorKind, label: string, message: string } {
  if (input.report && input.report.ok === false) {
    const failed = (Object.entries(input.report.checks) as Array<
      [keyof AiModelTestResult['checks'], AiAdmissionCheckResult | undefined]
    >)
      .find(([, check]) => check && !check.ok)
    if (failed) {
      return classifyCheckFailure(failed[0], failed[1]!)
    }
  }

  const raw = extractErrorText(input.error)
  const kind = classifyErrorText(raw)
  return {
    kind,
    label: AI_MODEL_TEST_ERROR_LABELS[kind],
    message: raw || AI_MODEL_TEST_ERROR_LABELS[kind],
  }
}

function classifyCheckFailure(
  key: keyof AiModelTestResult['checks'],
  check: AiAdmissionCheckResult,
): { kind: AiModelTestErrorKind, label: string, message: string } {
  const fromMessage = classifyErrorText(check.message)
  let kind: AiModelTestErrorKind
  if (key === 'connection') {
    kind = fromMessage === 'auth' || fromMessage === 'provider_config' || fromMessage === 'model_not_found'
      ? fromMessage
      : 'connection'
  }
  else if (key === 'text') {
    kind = 'text'
  }
  else if (key === 'toolCalling') {
    kind = 'tool_calling'
  }
  else if (key === 'reasoning') {
    kind = 'reasoning'
  }
  else {
    kind = 'vision'
  }
  return {
    kind,
    label: AI_MODEL_TEST_ERROR_LABELS[kind],
    message: check.message,
  }
}

function extractErrorText(error: unknown): string {
  if (error instanceof BusinessError || error instanceof HttpRequestError || error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return ''
}

function classifyErrorText(message: string): AiModelTestErrorKind {
  const text = message.toLocaleLowerCase()
  if (!text) {
    return 'connection'
  }
  if (/未配置 api key|尚未配置 api|provider配置|服务商.*密钥|ai_config_invalid/.test(text)) {
    return 'provider_config'
  }
  if (/401|403|unauthoriz|invalid key|api key 无效|认证失败|密钥无效/.test(text)) {
    return 'auth'
  }
  if (/模型不存在|model not found|404|not found/.test(text)) {
    return 'model_not_found'
  }
  if (/推理强度|reasoning|ai_reasoning_not_supported/.test(text)) {
    return 'reasoning'
  }
  if (/工具调用|tool call|agent/.test(text)) {
    return 'tool_calling'
  }
  if (/图片|视觉|vision/.test(text)) {
    return 'vision'
  }
  if (/文本|text/.test(text)) {
    return 'text'
  }
  if (/base url|连接|econnrefused|network|timeout|timed out/.test(text)) {
    return 'connection'
  }
  return 'connection'
}

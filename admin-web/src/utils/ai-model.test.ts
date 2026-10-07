import { describe, expect, it } from 'vitest'
import type { AiModel, AiModelTestResult, AiProvider } from '@/types/ai'
import { BusinessError } from '@/types/error'
import {
  AI_REASONING_LEVEL_OPTIONS,
  assertNoLegacyModelInputFields,
  buildAdmissionCheckRows,
  canEnableModel,
  canSetDefaultModel,
  classifyModelTestFailure,
  createAiModelForm,
  editAiModelForm,
  ENABLE_MODEL_REQUIRES_TEST_HINT,
  getAiReasoningLevelLabel,
  getDisplayedTestStatusLabel,
  getProviderBaseUrlPreview,
  getProviderCredentialPreview,
  isModelIdentityChanged,
  isToolCallingBlocked,
  MODEL_PROMPT_DUTY_HINT,
  resolveDisplayedTestStatus,
  toAiModelInput,
  TOOL_CALLING_BLOCKED_HINT,
} from './ai-model'

const providerFixture: AiProvider = {
  apiKeyMasked: 'sk-****abcd',
  baseUrl: 'https://api.deepseek.com/v1',
  code: 'deepseek',
  createdAt: '2026-01-01T00:00:00.000Z',
  createdById: null,
  description: null,
  enabled: true,
  hasApiKey: true,
  id: 'provider-1',
  lastTestAt: null,
  lastTestMessage: null,
  lastTestStatus: null,
  name: 'DeepSeek',
  priority: 1,
  timeoutMs: 60000,
  type: 'OPENAI_COMPATIBLE',
  updatedAt: '2026-01-01T00:00:00.000Z',
  updatedById: null,
}

const modelFixture: AiModel = {
  baseUrl: 'https://api.deepseek.com/v1',
  code: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  credentialId: 'provider-1',
  description: null,
  displayName: 'DeepSeek Chat',
  enabled: true,
  id: 'model-1',
  isDefault: true,
  lastTestAt: '2026-01-02T00:00:00.000Z',
  lastTestError: null,
  lastTestStatus: 'PASSED',
  modelId: 'deepseek-chat',
  name: 'DeepSeek Chat',
  provider: 'deepseek',
  providerId: 'provider-1',
  providerName: 'DeepSeek',
  reasoningLevel: 'HIGH',
  supportsVision: false,
  updatedAt: '2026-01-02T00:00:00.000Z',
  capabilities: { text: true, tools: true },
  defaultTemperature: 0.7,
  maxOutputTokens: 8192,
}

function passedReport(overrides: Partial<AiModelTestResult['checks']> = {}): AiModelTestResult {
  return {
    checks: {
      connection: { message: '已建立模型连接', ok: true },
      reasoning: { message: '推理配置有效', ok: true },
      text: { message: '已返回有效文本', ok: true },
      toolCalling: { message: '工具调用成功', ok: true },
      ...overrides,
    },
    message: '模型准入测试通过',
    ok: true,
  }
}

describe('ai model form mapping', () => {
  it('creates a model form with HIGH reasoning and disabled status', () => {
    expect(createAiModelForm()).toEqual({
      displayName: '',
      enabled: false,
      isDefault: false,
      modelId: '',
      providerId: '',
      reasoningLevel: 'HIGH',
      supportsVision: false,
    })
  })

  it('maps edit form from public model fields and ignores legacy extras', () => {
    const form = editAiModelForm(modelFixture)
    expect(form).toEqual({
      displayName: 'DeepSeek Chat',
      enabled: true,
      isDefault: true,
      modelId: 'deepseek-chat',
      providerId: 'provider-1',
      reasoningLevel: 'HIGH',
      supportsVision: false,
    })
    expect(form).not.toHaveProperty('defaultTemperature')
    expect(form).not.toHaveProperty('answerStyle')
    expect(form).not.toHaveProperty('responseStyle')
    expect(form).not.toHaveProperty('capabilities')
  })

  it('submits only the allowed fields and never sends legacy parameters', () => {
    const input = toAiModelInput(editAiModelForm(modelFixture), { mode: 'edit' })
    expect(input).toEqual({
      displayName: 'DeepSeek Chat',
      enabled: true,
      isDefault: true,
      modelId: 'deepseek-chat',
      providerId: 'provider-1',
      reasoningLevel: 'HIGH',
      supportsVision: false,
    })
    expect(assertNoLegacyModelInputFields(input)).toEqual([])
    expect(input).not.toHaveProperty('temperature')
    expect(input).not.toHaveProperty('topP')
    expect(input).not.toHaveProperty('maxOutputTokens')
    expect(input).not.toHaveProperty('capabilities')
    expect(input).not.toHaveProperty('answerStyle')
    expect(input).not.toHaveProperty('responseStyle')
  })

  it('forces new models to stay disabled and not default', () => {
    const form = createAiModelForm()
    form.displayName = 'New'
    form.modelId = 'new-model'
    form.providerId = 'provider-1'
    form.enabled = true
    form.isDefault = true
    expect(toAiModelInput(form, { mode: 'create' })).toMatchObject({
      enabled: false,
      isDefault: false,
    })
  })

  it('forces enabled and default off after identity fields change', () => {
    const form = editAiModelForm(modelFixture)
    form.modelId = 'deepseek-reasoner'
    expect(toAiModelInput(form, { identityChanged: true, mode: 'edit' })).toMatchObject({
      enabled: false,
      isDefault: false,
      modelId: 'deepseek-reasoner',
    })
  })
})

describe('ai model identity invalidation', () => {
  it('treats provider, modelId, vision and reasoning changes as identity changes', () => {
    const before = editAiModelForm(modelFixture)
    expect(isModelIdentityChanged(before, { ...before, providerId: 'provider-2' })).toBe(true)
    expect(isModelIdentityChanged(before, { ...before, modelId: 'other' })).toBe(true)
    expect(isModelIdentityChanged(before, { ...before, supportsVision: true })).toBe(true)
    expect(isModelIdentityChanged(before, { ...before, reasoningLevel: 'MAX' })).toBe(true)
    expect(isModelIdentityChanged(before, { ...before, displayName: '改名' } as typeof before)).toBe(false)
  })

  it('shows 需要重新检测 immediately when identity fields change on a passed model', () => {
    expect(resolveDisplayedTestStatus('PASSED', true)).toBe('STALE')
    expect(getDisplayedTestStatusLabel('STALE')).toBe('需要重新检测')
    expect(resolveDisplayedTestStatus('PASSED', false)).toBe('PASSED')
    expect(getDisplayedTestStatusLabel('UNTESTED')).toBe('未测试')
    expect(getDisplayedTestStatusLabel('FAILED')).toBe('异常')
    expect(getDisplayedTestStatusLabel('PASSED')).toBe('正常')
  })
})

describe('ai model enable and default rules', () => {
  it('blocks enable unless the current detection status is PASSED', () => {
    expect(canEnableModel('UNTESTED')).toBe(false)
    expect(canEnableModel('FAILED')).toBe(false)
    expect(canEnableModel('STALE')).toBe(false)
    expect(canEnableModel('PASSED')).toBe(true)
    expect(ENABLE_MODEL_REQUIRES_TEST_HINT).toContain('请先完成模型检测')
  })

  it('allows default only when enabled and PASSED', () => {
    expect(canSetDefaultModel({ enabled: true, lastTestStatus: 'PASSED' })).toBe(true)
    expect(canSetDefaultModel({ enabled: false, lastTestStatus: 'PASSED' })).toBe(false)
    expect(canSetDefaultModel({ enabled: true, lastTestStatus: 'FAILED' })).toBe(false)
    expect(canSetDefaultModel({ enabled: true, lastTestStatus: 'UNTESTED' })).toBe(false)
    expect(canSetDefaultModel({ enabled: true, lastTestStatus: 'PASSED' }, true)).toBe(false)
  })
})

describe('ai model reasoning and vision presentation', () => {
  it('keeps only LOW / HIGH / MAX with short business hints', () => {
    expect(AI_REASONING_LEVEL_OPTIONS.map(item => item.value)).toEqual(['LOW', 'HIGH', 'MAX'])
    expect(getAiReasoningLevelLabel('LOW')).toBe('低')
    expect(getAiReasoningLevelLabel('HIGH')).toBe('高')
    expect(getAiReasoningLevelLabel('MAX')).toBe('最高')
    expect(AI_REASONING_LEVEL_OPTIONS.find(item => item.value === 'LOW')?.hint).toBe('适合简单任务')
    expect(AI_REASONING_LEVEL_OPTIONS.find(item => item.value === 'HIGH')?.hint).toBe('适合日常 AI 任务')
    expect(AI_REASONING_LEVEL_OPTIONS.find(item => item.value === 'MAX')?.hint).toContain('成本和耗时更高')
    expect(JSON.stringify(AI_REASONING_LEVEL_OPTIONS)).not.toContain('reasoning_effort')
    expect(JSON.stringify(AI_REASONING_LEVEL_OPTIONS)).not.toContain('medium')
    expect(JSON.stringify(AI_REASONING_LEVEL_OPTIONS)).not.toContain('thinking_budget')
  })

  it('reads API URL and credentials from the selected provider only', () => {
    expect(getProviderBaseUrlPreview(providerFixture)).toBe('https://api.deepseek.com/v1')
    expect(getProviderCredentialPreview(providerFixture)).toBe('sk-****abcd')
    expect(getProviderCredentialPreview({ ...providerFixture, apiKeyMasked: '', hasApiKey: false })).toBe('未配置')
    expect(getProviderBaseUrlPreview(undefined)).toBe('')
  })

  it('does not expand DeepSeek-specific runtime parameters in the form', () => {
    const form = editAiModelForm({ ...modelFixture, provider: 'deepseek' })
    const input = toAiModelInput(form, { mode: 'edit' })
    expect(Object.keys(input).sort()).toEqual([
      'displayName',
      'enabled',
      'isDefault',
      'modelId',
      'providerId',
      'reasoningLevel',
      'supportsVision',
    ].sort())
  })

  it('points answer style responsibility to prompt configuration', () => {
    expect(MODEL_PROMPT_DUTY_HINT).toContain('提示词配置')
    expect(MODEL_PROMPT_DUTY_HINT).toContain('全局回答规则')
    expect(MODEL_PROMPT_DUTY_HINT).not.toContain('Temperature')
    expect(assertNoLegacyModelInputFields({
      answerStyle: 'professional',
      responseStyle: 'concise',
    })).toEqual(['answerStyle', 'responseStyle'])
  })
})

describe('ai model admission results', () => {
  it('marks vision as 未启用 instead of failed when supportsVision is false', () => {
    const rows = buildAdmissionCheckRows(passedReport(), false)
    expect(rows.find(row => row.key === 'vision')).toEqual({
      key: 'vision',
      label: '图片输入',
      message: '未启用',
      state: 'skipped',
    })
    expect(rows.filter(row => row.key !== 'vision').every(row => row.state === 'ok')).toBe(true)
  })

  it('shows vision as a real failure when it was enabled and the check failed', () => {
    const rows = buildAdmissionCheckRows(passedReport({
      vision: { message: '模型声明支持视觉，但实际无法处理图片输入', ok: false },
    }), true)
    expect(rows.find(row => row.key === 'vision')).toMatchObject({
      message: '图片输入失败',
      state: 'failed',
    })
  })

  it('blocks enable messaging when tool calling fails and never offers a bypass', () => {
    const report = passedReport({
      toolCalling: { message: '模型未完成真实工具调用回环', ok: false },
    })
    report.ok = false
    expect(isToolCallingBlocked(report)).toBe(true)
    expect(TOOL_CALLING_BLOCKED_HINT).toContain('不能启用为正式模型')
    expect(TOOL_CALLING_BLOCKED_HINT).not.toContain('关闭Agent')
    expect(TOOL_CALLING_BLOCKED_HINT).not.toContain('关闭Tools')
  })

  it('classifies admission failures into distinct kinds instead of a generic 测试失败', () => {
    expect(classifyModelTestFailure({
      report: { ...passedReport({ connection: { message: '连接测试失败，请检查 Base URL 与 API Key', ok: false } }), ok: false, message: '未通过' },
    }).label).toBe('连接失败')

    expect(classifyModelTestFailure({
      error: new BusinessError({ code: 401, message: 'API Key 无效' }, 'req-1'),
    }).label).toBe('认证失败')

    expect(classifyModelTestFailure({
      error: new BusinessError({ code: 404, message: 'AI 模型不存在' }, 'req-2'),
    }).label).toBe('模型不存在')

    expect(classifyModelTestFailure({
      report: { ...passedReport({ text: { message: '模型未返回有效文本', ok: false } }), ok: false, message: '未通过' },
    }).label).toBe('文本生成失败')

    expect(classifyModelTestFailure({
      report: { ...passedReport({ toolCalling: { message: '工具调用测试失败', ok: false } }), ok: false, message: '未通过' },
    }).label).toBe('工具调用失败')

    expect(classifyModelTestFailure({
      report: { ...passedReport({ vision: { message: '图片输入调用失败', ok: false } }), ok: false, message: '未通过' },
    }).label).toBe('图片输入失败')

    expect(classifyModelTestFailure({
      report: { ...passedReport({ reasoning: { message: '当前模型不支持推理强度 MAX', ok: false } }), ok: false, message: '未通过' },
    }).label).toBe('推理强度不支持')

    expect(classifyModelTestFailure({
      error: new BusinessError({ code: 409, message: '模型服务商尚未配置 API Key' }, 'req-3'),
    }).label).toBe('服务商配置错误')
  })
})

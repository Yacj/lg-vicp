import { describe, expect, it } from 'vitest'
import type { ConversationOpsDetail } from '@/types/ai'
import {
  AGENT_TOOL_CATALOG,
  classifyAgentError,
  getAgentToolLabel,
  isConversationInDateRange,
  projectAgentRunsFromConversation,
  resolveAgentToolStatus,
  resolveRunPromptIndicators,
  toAgentErrorDisplay,
} from './ai-agent'

function makeDetail(overrides: Partial<ConversationOpsDetail> = {}): ConversationOpsDetail {
  return {
    auditLogs: [],
    conversation: {
      clientApp: 'pc_ai',
      createdAt: '2026-09-01T08:00:00.000Z',
      id: 'conv-1',
      isPinned: false,
      projectId: 'project-1',
      reasoningMode: 'OFF',
      scene: 'general_chat',
      status: 'active',
      title: '热工咨询',
      updatedAt: '2026-09-01T08:10:00.000Z',
      userId: 'user-1',
    } as ConversationOpsDetail['conversation'],
    feedbacks: [],
    messages: [],
    processingSummary: { note: '', stages: [] },
    project: { id: 'project-1', name: '某办公楼' } as ConversationOpsDetail['project'],
    regenerations: [],
    reports: [],
    retrievals: [],
    shareLinks: [],
    shareViews: [],
    tasks: [],
    toolCalls: [],
    user: {
      channelType: null,
      displayName: '张工',
      email: null,
      id: 'user-1',
      phone: '13800000000',
      role: 'CHANNEL_USER',
      status: 'ACTIVE',
    },
    ...overrides,
  }
}

describe('agent tool catalog', () => {
  it('covers the six business tools without exposing schema or prompt editors', () => {
    expect(AGENT_TOOL_CATALOG.map(item => item.label)).toEqual([
      '知识检索',
      '项目资料',
      '项目记忆',
      '热工计算',
      '产品对比',
      '报告类型',
      '生成报告',
    ])
    expect(AGENT_TOOL_CATALOG.some(item => item.label.includes('方案对比'))).toBe(false)
    expect(AGENT_TOOL_CATALOG.map(item => item.name)).not.toContain('compare_solutions')
    expect(getAgentToolLabel('thermal_calculate')).toBe('热工计算')
    expect(getAgentToolLabel('compare_products')).toBe('产品对比')
    expect(getAgentToolLabel('compare_solutions')).toBe('产品对比')
    expect(getAgentToolLabel('generate_report')).toBe('生成报告')
    expect(getAgentToolLabel('generate_report_draft')).toBe('生成报告')
    expect(resolveAgentToolStatus(true)).toBe('available')
    expect(resolveAgentToolStatus(false)).toBe('disabled')
  })
})

describe('agent error classification', () => {
  it('maps backend codes to friendly B-end categories', () => {
    expect(classifyAgentError('AI_MODEL_TIMEOUT', null)).toBe('MODEL_ERROR')
    expect(classifyAgentError('AGENT_TOOL_TIMEOUT', null)).toBe('TOOL_TIMEOUT')
    expect(classifyAgentError('AGENT_LOOP_LIMIT', null)).toBe('AGENT_LOOP_LIMIT')
    expect(classifyAgentError('AGENT_CANCELLED', null)).toBe('CANCELLED')
    expect(classifyAgentError('AI_CONVERSATION_FORBIDDEN', null)).toBe('PERMISSION_DENIED')
    expect(classifyAgentError(null, '项目记忆存在冲突', { toolFailed: true })).toBe('MEMORY_CONFLICT')
    expect(classifyAgentError(null, '工具执行失败', { toolFailed: true })).toBe('TOOL_ERROR')
    expect(toAgentErrorDisplay('AGENT_LOOP_LIMIT', null).label).toBe('步骤超限')
  })
})

describe('run projection', () => {
  it('projects tool order, duration and failure from conversation ops detail', () => {
    const detail = makeDetail({
      messages: [
        {
          content: '帮我算一下外墙传热系数',
          conversationId: 'conv-1',
          createdAt: '2026-09-01T08:00:00.000Z',
          durationMs: null,
          errorCode: null,
          errorMessage: null,
          finishedAt: null,
          id: 'user-msg',
          metadata: null,
          model: null,
          promptTemplateVersion: null,
          provider: null,
          reasoningMode: 'OFF',
          reasoningTokens: null,
          requestId: null,
          role: 'USER',
          startedAt: null,
          status: 'COMPLETED',
          stopReason: null,
          tokenInput: null,
          tokenOutput: null,
          userId: 'user-1',
        },
        {
          content: '已完成热工计算',
          conversationId: 'conv-1',
          createdAt: '2026-09-01T08:01:00.000Z',
          durationMs: 420,
          errorCode: null,
          errorMessage: null,
          finishedAt: '2026-09-01T08:01:00.000Z',
          id: 'assistant-msg',
          metadata: null,
          model: 'qwen-plus',
          promptTemplateVersion: null,
          provider: 'dashscope',
          reasoningMode: 'OFF',
          reasoningTokens: 12,
          requestId: 'req-1',
          role: 'ASSISTANT',
          startedAt: '2026-09-01T08:00:40.000Z',
          status: 'COMPLETED',
          stopReason: null,
          tokenInput: 100,
          tokenOutput: 80,
          userId: null,
        },
      ],
      retrievals: [{
        chunkId: 'chunk-1',
        conversationId: 'conv-1',
        createdAt: '2026-09-01T08:00:50.000Z',
        documentId: 'doc-1',
        id: 'ret-1',
        messageId: 'assistant-msg',
        score: 0.9,
        sourcePage: 12,
        sourceTitle: '图集 12J',
      }],
      toolCalls: [
        {
          agentRunId: 'run-1',
          conversationId: 'conv-1',
          createdAt: '2026-09-01T08:00:41.000Z',
          durationMs: 320,
          errorMessage: null,
          id: 'tool-1',
          inputJson: { query: '传热系数' },
          messageId: 'assistant-msg',
          outputJson: { hits: 2 },
          success: true,
          toolName: 'search_knowledge',
        },
        {
          agentRunId: 'run-1',
          conversationId: 'conv-1',
          createdAt: '2026-09-01T08:00:42.000Z',
          durationMs: 20,
          errorMessage: null,
          id: 'tool-2',
          inputJson: {},
          messageId: 'assistant-msg',
          outputJson: { name: '某办公楼' },
          success: true,
          toolName: 'get_project_context',
        },
        {
          agentRunId: 'run-1',
          conversationId: 'conv-1',
          createdAt: '2026-09-01T08:00:43.000Z',
          durationMs: 80,
          errorMessage: null,
          id: 'tool-3',
          inputJson: {},
          messageId: 'assistant-msg',
          outputJson: { k: 0.3 },
          success: true,
          toolName: 'thermal_calculate',
        },
      ],
    })

    const [run] = projectAgentRunsFromConversation(detail)
    expect(run?.userQuestion).toBe('帮我算一下外墙传热系数')
    expect(run?.model).toBe('qwen-plus')
    expect(run?.status).toBe('COMPLETED')
    expect(run?.toolCalls.map(item => `${item.label} ${item.durationMs}ms`)).toEqual([
      '知识检索 320ms',
      '项目资料 20ms',
      '热工计算 80ms',
    ])
    expect(run?.sources[0]?.sourceTitle).toBe('图集 12J')
    expect(run?.globalResponsePolicyApplied).toBe(true)
    expect(run?.appliedPromptCodes).toContain('GLOBAL_RESPONSE_POLICY')
    expect(JSON.stringify(run)).not.toMatch(/thinking|chain of thought|推理过程/i)
    expect(JSON.stringify(run)).not.toContain('【用户回答规则】')
  })

  it('shows compare and report tools as business actions, not 方案对比Agent', () => {
    const detail = makeDetail({
      messages: [
        {
          content: '对比 VICP 和岩棉',
          conversationId: 'conv-1',
          createdAt: '2026-09-01T08:00:00.000Z',
          durationMs: null,
          errorCode: null,
          errorMessage: null,
          finishedAt: null,
          id: 'user-msg',
          metadata: null,
          model: null,
          promptTemplateVersion: null,
          provider: null,
          reasoningMode: 'OFF',
          reasoningTokens: null,
          requestId: null,
          role: 'USER',
          startedAt: null,
          status: 'COMPLETED',
          stopReason: null,
          tokenInput: null,
          tokenOutput: null,
          userId: 'user-1',
        },
        {
          content: '已完成产品对比',
          conversationId: 'conv-1',
          createdAt: '2026-09-01T08:01:00.000Z',
          durationMs: 200,
          errorCode: null,
          errorMessage: null,
          finishedAt: '2026-09-01T08:01:00.000Z',
          id: 'assistant-msg',
          metadata: null,
          model: 'qwen-plus',
          promptTemplateVersion: null,
          provider: 'dashscope',
          reasoningMode: 'OFF',
          reasoningTokens: null,
          requestId: 'req-2',
          role: 'ASSISTANT',
          startedAt: '2026-09-01T08:00:40.000Z',
          status: 'COMPLETED',
          stopReason: null,
          tokenInput: 100,
          tokenOutput: 80,
          userId: null,
        },
      ],
      toolCalls: [
        {
          agentRunId: 'run-2',
          conversationId: 'conv-1',
          createdAt: '2026-09-01T08:00:41.000Z',
          durationMs: 80,
          errorMessage: null,
          id: 'tool-1',
          inputJson: { productIds: ['vicp', 'rockwool'] },
          messageId: 'assistant-msg',
          outputJson: { ok: true },
          success: true,
          toolName: 'compare_products',
        },
        {
          agentRunId: 'run-2',
          conversationId: 'conv-1',
          createdAt: '2026-09-01T08:00:42.000Z',
          durationMs: 40,
          errorMessage: null,
          id: 'tool-2',
          inputJson: {},
          messageId: 'assistant-msg',
          outputJson: { ok: true },
          success: true,
          toolName: 'compare_solutions',
        },
        {
          agentRunId: 'run-2',
          conversationId: 'conv-1',
          createdAt: '2026-09-01T08:00:43.000Z',
          durationMs: 60,
          errorMessage: null,
          id: 'tool-3',
          inputJson: {},
          messageId: 'assistant-msg',
          outputJson: { reportId: 'r1' },
          success: true,
          toolName: 'generate_report',
        },
      ],
    })

    const [run] = projectAgentRunsFromConversation(detail)
    expect(run?.toolCalls.map(item => item.label)).toEqual(['产品对比', '产品对比', '生成报告'])
    expect(JSON.stringify(run)).not.toContain('方案对比Agent')
    expect(JSON.stringify(run)).not.toContain('方案对比 Agent')
  })

  it('projects failed records with friendly error categories', () => {
    const detail = makeDetail({
      messages: [{
        content: '',
        conversationId: 'conv-1',
        createdAt: '2026-09-01T08:01:00.000Z',
        durationMs: 90,
        errorCode: 'AGENT_LOOP_LIMIT',
        errorMessage: 'AI 工具调用次数过多或出现循环，已停止本次任务',
        finishedAt: '2026-09-01T08:01:00.000Z',
        id: 'assistant-fail',
        metadata: null,
        model: 'qwen-plus',
        promptTemplateVersion: null,
        provider: null,
        reasoningMode: 'OFF',
        reasoningTokens: null,
        requestId: null,
        role: 'ASSISTANT',
        startedAt: '2026-09-01T08:00:00.000Z',
        status: 'FAILED',
        stopReason: null,
        tokenInput: null,
        tokenOutput: null,
        userId: null,
      }],
    })
    const [run] = projectAgentRunsFromConversation(detail)
    expect(run?.status).toBe('FAILED')
    expect(classifyAgentError(run?.errorCode, run?.errorMessage)).toBe('AGENT_LOOP_LIMIT')
  })
})

describe('date range filter', () => {
  it('keeps conversations inside the selected local day range', () => {
    expect(isConversationInDateRange('2026-09-18T12:00:00.000Z', ['2026-09-18', '2026-09-18'])).toBe(true)
    expect(isConversationInDateRange('2026-09-01T12:00:00.000Z', ['2026-09-18', '2026-09-18'])).toBe(false)
    expect(isConversationInDateRange('2026-09-18T02:00:00.000Z', [])).toBe(true)
  })
})

describe('run prompt indicators', () => {
  it('marks GLOBAL_RESPONSE_POLICY as applied without exposing system prompt', () => {
    const indicators = resolveRunPromptIndicators(makeDetail({
      messages: [{
        content: '【用户回答规则】完整 System Prompt 不应出现在运行记录页',
        conversationId: 'conv-1',
        createdAt: '2026-09-01T08:00:00.000Z',
        durationMs: null,
        errorCode: null,
        errorMessage: null,
        finishedAt: null,
        id: 'sys-msg',
        metadata: { appliedPromptCodes: ['GLOBAL_RESPONSE_POLICY', 'BASE_CHAT'] },
        model: null,
        promptTemplateVersion: 3,
        provider: null,
        reasoningMode: 'OFF',
        reasoningTokens: null,
        requestId: null,
        role: 'SYSTEM',
        startedAt: null,
        status: 'COMPLETED',
        stopReason: null,
        tokenInput: null,
        tokenOutput: null,
        userId: null,
      }],
    }))
    expect(indicators.globalResponsePolicyApplied).toBe(true)
    expect(indicators.appliedCodes).toEqual(['GLOBAL_RESPONSE_POLICY', 'BASE_CHAT'])
    expect(indicators.systemPromptExposed).toBe(false)
  })
})

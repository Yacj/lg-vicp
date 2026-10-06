import { describe, expect, it } from 'vitest'
import type { AiAuditLog, AiMessage } from '@/types/ai'
import {
  messageMetricsText,
  projectConversationThread,
  speechAlign,
} from './conversation-thread'

function createMessage(partial: Partial<AiMessage> & Pick<AiMessage, 'id' | 'role'>): AiMessage {
  return {
    conversationId: 'conversation-1',
    createdAt: '2026-09-15T09:21:06.000Z',
    durationMs: null,
    errorCode: null,
    errorMessage: null,
    finishedAt: null,
    metadata: null,
    model: null,
    promptTemplateVersion: null,
    provider: null,
    reasoningMode: 'OFF',
    reasoningTokens: null,
    requestId: null,
    startedAt: null,
    status: 'COMPLETED',
    stopReason: null,
    tokenInput: null,
    tokenOutput: null,
    userId: null,
    content: '',
    ...partial,
  }
}

function createAudit(partial: Partial<AiAuditLog> & Pick<AiAuditLog, 'id' | 'action' | 'targetId'>): AiAuditLog {
  return {
    actorUserId: null,
    afterJson: null,
    beforeJson: null,
    createdAt: '2026-09-15T09:21:07.000Z',
    ip: null,
    projectId: null,
    requestId: null,
    targetType: 'AI_MESSAGES',
    userAgent: null,
    ...partial,
  }
}

describe('conversation thread projection', () => {
  it('aligns user speech to the right and assistant speech to the left', () => {
    expect(speechAlign('USER')).toBe('user')
    expect(speechAlign('ASSISTANT')).toBe('assistant')
  })

  it('turns user and assistant messages into speech, system and tool into notices', () => {
    const items = projectConversationThread([
      createMessage({ content: '你好', id: 'm-user', role: 'USER' }),
      createMessage({ content: '请稍候', id: 'm-system', role: 'SYSTEM' }),
      createMessage({ content: '检索完成', id: 'm-tool', role: 'TOOL' }),
      createMessage({ content: '这是回答', id: 'm-assistant', role: 'ASSISTANT' }),
    ], [])

    expect(items.map(item => [item.kind, item.id])).toEqual([
      ['speech', 'speech:m-user'],
      ['notice', 'notice:m-system'],
      ['notice', 'notice:m-tool'],
      ['speech', 'speech:m-assistant'],
    ])
  })

  it('hides routine send audits and keeps failure as a compact status event', () => {
    const items = projectConversationThread([
      createMessage({
        content: '',
        errorMessage: '上游超时',
        finishedAt: '2026-09-15T09:21:10.000Z',
        id: 'm-failed',
        role: 'ASSISTANT',
        status: 'FAILED',
      }),
    ], [
      createAudit({ action: 'ai.message_sent', id: 'audit-sent', targetId: 'm-failed' }),
    ])

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ kind: 'speech', id: 'speech:m-failed' })
    expect(items[1]).toMatchObject({
      align: 'assistant',
      detail: '上游超时',
      kind: 'event',
      label: '生成失败',
      tone: 'error',
    })
  })

  it('merges stopped status with the matching audit into one event', () => {
    const items = projectConversationThread([
      createMessage({
        id: 'm-stopped',
        role: 'ASSISTANT',
        status: 'STOPPED',
        stopReason: 'user_cancel',
      }),
    ], [
      createAudit({ action: 'ai.message_stopped', id: 'audit-stop', targetId: 'm-stopped' }),
    ])

    expect(items.filter(item => item.kind === 'event')).toEqual([
      expect.objectContaining({
        align: 'assistant',
        id: 'audit-stop',
        kind: 'event',
        label: '停止生成',
        detail: 'user_cancel',
        tone: 'warning',
      }),
    ])
  })

  it('shows content interception as an error event', () => {
    const items = projectConversationThread([
      createMessage({ content: '敏感词', id: 'm-user', role: 'USER' }),
    ], [
      createAudit({ action: 'ai.message_blocked', id: 'audit-block', targetId: 'm-user' }),
    ])

    expect(items[1]).toMatchObject({
      align: 'user',
      kind: 'event',
      label: '内容拦截',
      tone: 'error',
    })
  })
})

describe('message metrics text', () => {
  it('omits empty duration, zero reasoning tokens and request-only rows', () => {
    expect(messageMetricsText(createMessage({ id: 'm1', role: 'USER', requestId: 'req-1' }))).toBe('')
    expect(messageMetricsText(createMessage({
      durationMs: 4100,
      id: 'm2',
      promptTemplateVersion: 1,
      reasoningTokens: 0,
      role: 'ASSISTANT',
      tokenInput: 344,
      tokenOutput: 221,
    }))).toBe('耗时 4.1s · 输入 344 / 输出 221 · 提示词版本 v1')
  })
})

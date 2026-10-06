import type { AiAuditLog, AiMessage } from '@/types/ai'
import { getAiAuditActionLabel, getAiMessageStatusLabel } from '@/utils/ai'

/** 例行发送、以及已有独立区块的反馈/重新生成，不作为时间轴事件。 */
const HIDDEN_MESSAGE_AUDIT_ACTIONS = new Set([
  'ai.message_feedback_upserted',
  'ai.message_regenerated',
  'ai.message_sent',
])

export type ConversationThreadEventTone = 'warning' | 'error' | 'default'

export type ConversationThreadItem =
  | { id: string, kind: 'speech', message: AiMessage }
  | { id: string, kind: 'notice', message: AiMessage }
  | {
    id: string
    kind: 'event'
    align: 'user' | 'assistant'
    label: string
    detail: string
    time: string
    tone: ConversationThreadEventTone
  }

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`
  }
  return `${(durationMs / 1000).toFixed(1)}s`
}

/** 仅拼接有值的运营指标；用户消息和空字段不占一行。 */
export function messageMetricsText(message: AiMessage): string {
  const parts: string[] = []
  if (message.durationMs !== null) {
    parts.push(`耗时 ${formatDuration(message.durationMs)}`)
  }
  if (message.tokenInput !== null || message.tokenOutput !== null) {
    const tokens = [`输入 ${message.tokenInput ?? '-'}`, `输出 ${message.tokenOutput ?? '-'}`]
    if (message.reasoningTokens !== null && message.reasoningTokens > 0) {
      tokens.push(`推理 ${message.reasoningTokens}`)
    }
    parts.push(tokens.join(' / '))
  }
  if (message.promptTemplateVersion !== null) {
    parts.push(`提示词版本 v${message.promptTemplateVersion}`)
  }
  return parts.join(' · ')
}

export function speechAlign(role: AiMessage['role']): 'user' | 'assistant' {
  return role === 'USER' ? 'user' : 'assistant'
}

function eventToneForAudit(action: string): ConversationThreadEventTone {
  if (action === 'ai.message_blocked') {
    return 'error'
  }
  if (action === 'ai.message_stopped') {
    return 'warning'
  }
  return 'default'
}

function projectMessageEvents(message: AiMessage, audits: AiAuditLog[]): ConversationThreadItem[] {
  const visibleAudits = audits.filter(item => !HIDDEN_MESSAGE_AUDIT_ACTIONS.has(item.action))
  const align = speechAlign(message.role)
  const events: ConversationThreadItem[] = []

  if (message.status === 'FAILED') {
    events.push({
      align,
      detail: message.errorMessage ?? '',
      id: `event:${message.id}:failed`,
      kind: 'event',
      label: '生成失败',
      time: message.finishedAt ?? message.createdAt,
      tone: 'error',
    })
  }

  const stoppedAudit = visibleAudits.find(item => item.action === 'ai.message_stopped')
  if (message.status === 'STOPPED' || stoppedAudit) {
    events.push({
      align,
      detail: message.stopReason ?? '',
      id: stoppedAudit?.id ?? `event:${message.id}:stopped`,
      kind: 'event',
      label: '停止生成',
      time: stoppedAudit?.createdAt ?? message.finishedAt ?? message.createdAt,
      tone: 'warning',
    })
  }

  if (message.status === 'PENDING' || message.status === 'STREAMING') {
    events.push({
      align,
      detail: '',
      id: `event:${message.id}:status`,
      kind: 'event',
      label: getAiMessageStatusLabel(message.status),
      time: message.createdAt,
      tone: 'warning',
    })
  }

  for (const audit of visibleAudits) {
    if (audit.action === 'ai.message_stopped') {
      continue
    }
    events.push({
      align,
      detail: '',
      id: `event:${audit.id}`,
      kind: 'event',
      label: getAiAuditActionLabel(audit.action),
      time: audit.createdAt,
      tone: eventToneForAudit(audit.action),
    })
  }

  return events
}

export function projectConversationThread(
  messages: AiMessage[],
  audits: AiAuditLog[],
): ConversationThreadItem[] {
  const items: ConversationThreadItem[] = []
  for (const message of messages) {
    if (message.role === 'SYSTEM' || message.role === 'TOOL') {
      items.push({ id: `notice:${message.id}`, kind: 'notice', message })
    }
    else {
      items.push({ id: `speech:${message.id}`, kind: 'speech', message })
    }
    items.push(...projectMessageEvents(
      message,
      audits.filter(item => item.targetId === message.id),
    ))
  }
  return items
}

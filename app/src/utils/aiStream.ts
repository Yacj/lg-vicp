import type { AiStreamEventPayload } from '@/api/types'
import { normalizeAiSources } from '@/utils/aiSource'

function asText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export function parseStreamEvent(event: string, data: Record<string, unknown>): AiStreamEventPayload | null {
  switch (event) {
    // 后端为兼容新旧客户端会双发同内容事件（message/message_start、delta/text_delta、done/message_done）。
    // 只消费旧事件名，忽略别名，否则同一段正文会被拼接两次。
    case 'message_start':
    case 'text_delta':
    case 'message_done':
      return null
    case 'message': {
      if (typeof data.messageId !== 'string' || typeof data.conversationId !== 'string') {
        return null
      }
      return {
        event: 'message',
        data: {
          messageId: data.messageId,
          conversationId: data.conversationId,
          userMessageId: typeof data.userMessageId === 'string' ? data.userMessageId : undefined,
          originalMessageId: typeof data.originalMessageId === 'string' ? data.originalMessageId : undefined,
          requestId: typeof data.requestId === 'string' ? data.requestId : '',
        },
      }
    }
    case 'progress': {
      if (typeof data.message !== 'string') {
        return null
      }
      const stage = data.stage === 'analyzing' || data.stage === 'checking' || data.stage === 'composing' || data.stage === 'completed'
        ? data.stage
        : 'analyzing'
      return { event: 'progress', data: { stage, message: data.message } }
    }
    case 'agent_status': {
      // writeProgress 会顺带发一条带 stage 的 agent_status，与 progress 重复；工具级状态才处理。
      if (typeof data.stage === 'string' && !data.toolName && !data.runId) {
        return null
      }
      const message = asText(data.message)
      if (!message) {
        return null
      }
      return {
        event: 'agent_status',
        data: {
          message,
          toolName: asText(data.toolName) || undefined,
          runId: asText(data.runId) || undefined,
        },
      }
    }
    case 'tool_start': {
      return {
        event: 'tool_start',
        data: {
          message: asText(data.message) || undefined,
          toolName: asText(data.toolName) || undefined,
        },
      }
    }
    case 'tool_result': {
      return {
        event: 'tool_result',
        data: {
          toolName: asText(data.toolName) || undefined,
          success: data.success !== false,
          error: asText(data.error) || undefined,
        },
      }
    }
    case 'need_user_input': {
      if (typeof data.runId !== 'string') {
        return null
      }
      return {
        event: 'need_user_input',
        data: {
          runId: data.runId,
          prompt: asText(data.prompt) || '请确认后继续',
          options: Array.isArray(data.options) ? data.options : [],
        },
      }
    }
    case 'sources': {
      return {
        event: 'sources',
        data: { sources: normalizeAiSources(data.sources) },
      }
    }
    case 'delta': {
      if (typeof data.text !== 'string') {
        return null
      }
      return { event: 'delta', data: { text: data.text } }
    }
    case 'done': {
      if (typeof data.messageId !== 'string' || typeof data.conversationId !== 'string') {
        return null
      }
      return {
        event: 'done',
        data: {
          messageId: data.messageId,
          conversationId: data.conversationId,
          finishReason: typeof data.finishReason === 'string' ? data.finishReason : 'COMPLETED',
          sources: normalizeAiSources(data.sources),
          model: data.model && typeof data.model === 'object' ? (data.model as { id: string }) : null,
          regeneratedMessageId: typeof data.regeneratedMessageId === 'string' ? data.regeneratedMessageId : undefined,
        },
      }
    }
    case 'stopped': {
      if (typeof data.messageId !== 'string') {
        return null
      }
      const content = typeof data.content === 'string'
        ? data.content
        : (typeof data.partialContent === 'string' ? data.partialContent : '')
      return { event: 'stopped', data: { messageId: data.messageId, content } }
    }
    case 'error': {
      return {
        event: 'error',
        data: {
          code: typeof data.code === 'string' ? data.code : 'UNKNOWN',
          message: typeof data.message === 'string' ? data.message : 'AI 回答生成失败',
          requestId: typeof data.requestId === 'string' ? data.requestId : '',
          retryable: typeof data.retryable === 'boolean' ? data.retryable : undefined,
        },
      }
    }
    default:
      return null
  }
}

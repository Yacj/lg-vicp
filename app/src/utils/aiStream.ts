import type { AiStreamEventPayload } from '@/api/types'
import { normalizeAiSources } from './aiSource.ts'

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
      const toolName = asText(data.toolName)
      if (!message && !toolName && !asText(data.runId)) {
        return null
      }
      return {
        event: 'agent_status',
        data: {
          message,
          toolName: toolName || undefined,
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
    case 'need_user_input':
    case 'waiting_user_input': {
      if (typeof data.runId !== 'string') {
        return null
      }
      const nested = data.request && typeof data.request === 'object'
        ? data.request as Record<string, unknown>
        : null
      const rawType = asText(nested?.type) || asText(data.type)
      const type = rawType === 'USER_SELECTION'
        || rawType === 'COMPARISON_SELECTION'
        || rawType === 'APPROVAL'
        || rawType === 'CHOICE'
        ? rawType
        : undefined
      const selectionKindRaw = asText(nested?.selectionKind) || asText(data.selectionKind)
      const selectionKind = selectionKindRaw === 'KNOWLEDGE_SOURCE'
        || selectionKindRaw === 'REPORT_TYPE'
        || selectionKindRaw === 'PRODUCT'
        || selectionKindRaw === 'GENERIC'
        ? selectionKindRaw
        : undefined
      const confirmSource = nested?.confirmAction || data.confirmAction
      const confirm = confirmSource && typeof confirmSource === 'object'
        ? confirmSource as Record<string, unknown>
        : null
      const multiple = data.multiple === true
        || nested?.multiple === true
        || type === 'COMPARISON_SELECTION'
        || selectionKind === 'KNOWLEDGE_SOURCE'
        || selectionKind === 'PRODUCT'
      const confirmType = confirm?.type === 'GENERATE_REPORT'
        ? 'GENERATE_REPORT' as const
        : (confirm?.type === 'CONTINUE' ? 'CONTINUE' as const : undefined)
      return {
        event: 'need_user_input',
        data: {
          runId: data.runId,
          type,
          selectionKind,
          title: asText(nested?.title) || asText(data.title) || undefined,
          description: asText(nested?.description) || asText(data.description) || undefined,
          prompt: asText(data.prompt) || asText(nested?.description) || '请确认后继续',
          options: Array.isArray(nested?.options) ? nested.options : (Array.isArray(data.options) ? data.options : []),
          multiple,
          minSelections: typeof (nested?.minSelections ?? data.minSelections) === 'number'
            ? Number(nested?.minSelections ?? data.minSelections)
            : undefined,
          maxSelections: typeof (nested?.maxSelections ?? data.maxSelections) === 'number'
            ? Number(nested?.maxSelections ?? data.maxSelections)
            : undefined,
          autoSelectWhenSingle: (nested?.autoSelectWhenSingle ?? data.autoSelectWhenSingle) !== false,
          confirmAction: confirmType
            ? {
                type: confirmType,
                label: asText(confirm.label) || (confirmType === 'GENERATE_REPORT' ? '确认并生成报告' : '确认'),
              }
            : undefined,
          comparisonResult: data.comparisonResult,
          request: nested || (type === 'USER_SELECTION' ? data : undefined),
        },
      }
    }
    case 'comparison_ready': {
      const comparisonResult = data.comparisonResult
        ?? data.comparison
        ?? (Array.isArray(data.products) && Array.isArray(data.dimensions) ? data : undefined)
      return {
        event: 'comparison_ready',
        data: {
          comparisonResult,
          thermalStatus: asText(data.thermalStatus) || undefined,
          missingNotes: Array.isArray(data.missingNotes) ? data.missingNotes.filter((item): item is string => typeof item === 'string') : undefined,
        },
      }
    }
    case 'product_cards': {
      const products = Array.isArray(data.products) ? data.products : Array.isArray(data.items) ? data.items : []
      return {
        event: 'product_cards',
        data: { products },
      }
    }
    case 'report_started': {
      return {
        event: 'report_started',
        data: {
          conversationId: asText(data.conversationId) || undefined,
        },
      }
    }
    case 'report_queued': {
      const reportId = asText(data.reportId)
      if (!reportId) {
        return null
      }
      return {
        event: 'report_queued',
        data: {
          reportId,
          taskId: asText(data.taskId) || undefined,
          status: asText(data.status) || 'QUEUED',
          selectedProductIds: Array.isArray(data.selectedProductIds)
            ? data.selectedProductIds.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
            : undefined,
          title: asText(data.title) || undefined,
        },
      }
    }
    case 'report_completed': {
      const reportId = asText(data.reportId)
      if (!reportId) {
        return null
      }
      return {
        event: 'report_completed',
        data: {
          reportId,
          selectedProductIds: Array.isArray(data.selectedProductIds)
            ? data.selectedProductIds.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
            : undefined,
          title: asText(data.title) || undefined,
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

import type {
  ConversationListQuery,
  ConversationSettingsBody,
  CreateConversationBody,
  MessageFeedbackBody,
  MoveConversationBody,
  ReportDraftBody,
  SendMessageBody,
  UpdateConversationBody,
} from '../types'
import { request } from '../request'

export const aiApi = {
  createConversation(data: CreateConversationBody) {
    return request('POST', '/ai/conversations', { data })
  },

  listConversations(params: ConversationListQuery = {}) {
    return request('GET', '/ai/conversations', { params })
  },

  getConversation(id: string) {
    return request('GET', '/ai/conversations/{id}', { pathParams: { id } })
  },

  updateConversation(id: string, data: UpdateConversationBody) {
    return request('PATCH', '/ai/conversations/{id}', { pathParams: { id }, data })
  },

  removeConversation(id: string) {
    return request('DELETE', '/ai/conversations/{id}', { pathParams: { id } })
  },

  pinConversation(id: string, pinned: boolean) {
    return request('PUT', '/ai/conversations/{id}/pin', { pathParams: { id }, data: { pinned } })
  },

  moveConversation(id: string, data: MoveConversationBody) {
    return request('PATCH', '/ai/conversations/{id}/project', { pathParams: { id }, data })
  },

  restoreConversation(id: string) {
    return request('POST', '/ai/conversations/{id}/restore', { pathParams: { id } })
  },

  updateSettings(id: string, data: ConversationSettingsBody) {
    return request('PATCH', '/ai/conversations/{id}/settings', { pathParams: { id }, data })
  },

  sendMessage(id: string, data: SendMessageBody) {
    return request('POST', '/ai/conversations/{id}/messages', {
      pathParams: { id },
      data,
      headers: { Accept: 'text/event-stream' },
    })
  },

  stopMessage(id: string) {
    return request('POST', '/ai/messages/{id}/stop', { pathParams: { id } })
  },

  feedbackMessage(id: string, data: MessageFeedbackBody) {
    return request('PUT', '/ai/messages/{id}/feedback', { pathParams: { id }, data })
  },

  regenerateMessage(id: string, reason?: string) {
    return request('POST', '/ai/messages/{id}/regenerate', {
      pathParams: { id },
      data: reason ? { reason } : undefined,
    })
  },

  createReportDraft(id: string, data: ReportDraftBody) {
    return request('POST', '/ai/conversations/{id}/report-draft', { pathParams: { id }, data })
  },
}

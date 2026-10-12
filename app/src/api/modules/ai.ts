import type { SolutionActionBody, SolutionQueryState } from '../solution-types'
import type {
  AiSourceLocatorQuery,
  ConversationListQuery,
  ConversationSettingsBody,
  CreateConversationBody,
  MessageFeedbackBody,
  MoveConversationBody,
  QuickPromptListQuery,
  RegenerateMessageBody,
  ReportDraftBody,
  ResumeAgentRunBody,
  SendMessageBody,
  TranscribeVoiceBody,
  UpdateConversationBody,
} from '../types'
import { request } from '../request'

export const aiApi = {
  getSolution(conversationId: string) {
    return request('GET', '/ai/conversations/{conversationId}/solution', { pathParams: { conversationId } })
  },

  startSolution(conversationId: string, data: { expectedVersion?: number } = {}) {
    return request('POST', '/ai/conversations/{conversationId}/solution', { pathParams: { conversationId }, data })
  },

  querySolution(conversationId: string, data: { expectedVersion: number, query: SolutionQueryState }) {
    return request('POST', '/ai/conversations/{conversationId}/solution/query', { pathParams: { conversationId }, data })
  },

  solutionAction(conversationId: string, data: SolutionActionBody) {
    return request('POST', '/ai/conversations/{conversationId}/solution/actions', { pathParams: { conversationId }, data })
  },

  addSolutionCalculation(conversationId: string, data: { calculationId: string }) {
    // 正式计算接口仅接受 calculationId，由后端在事务内读取并校验当前版本。
    return request('POST', '/ai/conversations/{conversationId}/solution/calculations', { pathParams: { conversationId }, data })
  },

  addSolutionProducts(conversationId: string, data: { expectedVersion: number, productIds: string[] }) {
    return request('POST', '/ai/conversations/{conversationId}/solution/products', { pathParams: { conversationId }, data })
  },

  getSolutionSnapshot(conversationId: string, snapshotId: string) {
    return request('GET', '/ai/conversations/{conversationId}/solution/snapshots/{snapshotId}', { pathParams: { conversationId, snapshotId } })
  },

  listQuickPrompts(params: QuickPromptListQuery = {}) {
    return request('GET', '/ai/quick-prompts', { params })
  },

  getSourceDetail(params: AiSourceLocatorQuery) {
    const query: Record<string, string> = {}
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        query[key] = value
      }
    }
    return request('GET', '/ai/knowledge/source-detail', { params: query })
  },

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

  transcribeVoice(data: TranscribeVoiceBody) {
    return request('POST', '/ai/voice/transcribe', { data })
  },

  stopMessage(id: string) {
    return request('POST', '/ai/messages/{id}/stop', { pathParams: { id } })
  },

  feedbackMessage(id: string, data: MessageFeedbackBody) {
    return request('PUT', '/ai/messages/{id}/feedback', { pathParams: { id }, data })
  },

  regenerateMessage(id: string, data: RegenerateMessageBody = {}) {
    return request('POST', '/ai/messages/{id}/regenerate', {
      pathParams: { id },
      data,
    })
  },

  createReportDraft(id: string, data: ReportDraftBody) {
    return request('POST', '/ai/conversations/{id}/report-draft', { pathParams: { id }, data })
  },

  getActiveAgentRun(id: string) {
    return request('GET', '/ai/conversations/{id}/active-agent-run', { pathParams: { id } })
  },

  getAgentRun(id: string) {
    return request('GET', '/ai/agent-runs/{id}', { pathParams: { id } })
  },

  resumeAgentRun(id: string, data: ResumeAgentRunBody) {
    return request('POST', '/ai/agent-runs/{id}/resume', {
      pathParams: { id },
      data,
      headers: { Accept: 'text/event-stream' },
    })
  },
}

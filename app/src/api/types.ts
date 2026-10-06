export interface ApiEnvelope<T> {
  success: true
  data: T
  requestId: string
}

export interface ApiPage<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export interface PageQuery {
  page?: number
  pageSize?: number
}

export interface ConversationListQuery extends PageQuery {
  keyword?: string
  projectId?: string
  clientApp?: ConversationRecord['clientApp']
  pinned?: boolean
  includeDeleted?: boolean
}

export interface FileListQuery extends PageQuery {
  projectId?: string
}

export type AuthClient = 'C_APP' | 'PC_AI'
export type UserRole = 'SUPER_ADMIN' | 'CHANNEL_USER' | 'NORMAL_USER'
export type ChannelType = 'DEALER' | 'SALESPERSON' | null

export interface ClientUser {
  id: string
  displayName: string
  phone?: string | null
  email?: string | null
  role: UserRole
  channelType: ChannelType
  clientType: AuthClient
  status?: 'ACTIVE' | 'DISABLED'
}

export interface PasswordLoginBody {
  clientType: AuthClient
  phone: string
  password: string
}

/** C 端密码注册。role / adminLoginEnabled 由 Backend 固定为 NORMAL_USER / false，前端不得传。 */
export interface PasswordRegisterBody {
  clientType: AuthClient
  phone: string
  password: string
}

export interface SmsSendBody {
  clientType: AuthClient
  phone: string
  purpose?: 'LOGIN' | 'PASSWORD'
}

export interface SmsLoginBody extends SmsSendBody {
  code: string
}

/** 微信手机号快捷登录只提交一次性 code，不提交明文手机号。 */
export interface WechatPhoneLoginBody {
  loginCode: string
  phoneCode: string
}

export interface PasswordSmsBody {
  clientType: AuthClient
  phone: string
  code: string
  password: string
}

export interface LoginResult {
  user: ClientUser
  accessToken: string
  refreshToken: string
  refreshTokenId: string
  refreshTokenExpiresAt: string
  isFirstLogin?: boolean
  passwordSet?: boolean
}

export interface WechatPhoneLoginResult extends LoginResult {
  isFirstLogin: boolean
  passwordSet: boolean
}

export interface PasswordMutationResult {
  message: string
  passwordSet: boolean
  userId: string
}

export interface RegisterResult extends LoginResult {
  message?: string
}

export interface RefreshResult {
  accessToken: string
  refreshToken: string
  refreshTokenExpiresAt: string
  clientType: AuthClient
}

export interface ClientCapabilities {
  canCreateProject: boolean
  canUseAi: boolean
  canGenerateReport: boolean
  canViewPublicProject: boolean
}

export interface ClientInfo {
  user: ClientUser
  capabilities: ClientCapabilities
}

export interface ProfileSummary {
  projects: {
    total: number
    public: number
  }
  conversations: {
    total: number
  }
}

/** 新建/修改可见范围只允许这两种；PUBLIC 仅为历史数据展示兼容。 */
export type ProjectVisibility = 'PRIVATE' | 'DEPARTMENT'
export type StoredProjectVisibility = ProjectVisibility | 'PUBLIC'

export interface ClientSelectableDepartment {
  id: string
  name: string
  pathName: string
  hasChildren: boolean
}

export interface ProjectListQuery extends PageQuery {
  visibility?: StoredProjectVisibility
  keyword?: string
}

export interface CreateProjectBody {
  name: string
  description?: string
  region?: string
  buildingType?: string
  visibility?: ProjectVisibility
  visibleDepartmentId?: string
  includeChildDepartments?: boolean
}

export interface UpdateProjectBody {
  name?: string
  description?: string
  region?: string
  buildingType?: string
}

export interface UpdateProjectVisibilityBody {
  visibility: ProjectVisibility
  visibleDepartmentId?: string
  includeChildDepartments?: boolean
}

export interface ProjectRecord {
  id: string
  name: string
  description: string | null
  region: string | null
  buildingType: string | null
  visibility: StoredProjectVisibility
  visibilityPolicy: 'LOGGED_IN_USERS'
  visibleDepartmentId?: string | null
  includeChildDepartments?: boolean
  /** 若 Backend 附带部门名则优先展示，APP 不回传 departmentId */
  visibleDepartmentName?: string | null
  status: string
  metadata: Record<string, unknown> | null
  createdById: string
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  /** 后端 projectResponse 附带：是否为创建者或超管（可管理项目） */
  canManage: boolean
  canEdit?: boolean
  canDelete?: boolean
}

export type AiScene = 'general_chat' | 'project_design' | 'material_compare' | 'standard_qa' | 'report_generate' | 'information_extract'
export type AiFeedbackReaction = 'LIKE' | 'DISLIKE'

export interface ConversationRecord {
  id: string
  userId: string
  projectId: string | null
  clientApp: 'c_app' | 'pc_ai' | 'b_admin'
  scene: AiScene
  title: string | null
  reasoningMode: 'OFF' | 'ON'
  status: string
  isPinned: boolean
  lastMessageAt?: string | null
  createdAt: string
  updatedAt: string
}

/** 会话列表项在会话本体外附带的聚合信息（GET /ai/conversations 专有，详情接口不返回） */
export interface ConversationListItem extends ConversationRecord {
  project: { id: string, name: string } | null
  messageCount: number
  lastMessage: {
    id: string
    role: 'USER' | 'ASSISTANT'
    status: ConversationMessage['status']
    preview: string
    createdAt: string
  } | null
}

export interface CreateConversationBody {
  projectId?: string
  clientApp: 'c_app' | 'pc_ai' | 'b_admin'
  /** C 端可省略，后端默认 general_chat；用户不选择场景 */
  scene?: AiScene
  title?: string
  reasoningMode?: 'OFF' | 'ON'
}

export type AiQuickPromptPosition = 'AI_HOME' | 'PROJECT_AI'
export type AiQuickPromptIcon = 'book' | 'project' | 'material' | 'standard' | 'calc' | 'compare' | 'chat'

/** C 端只读快捷提问（GET /ai/quick-prompts） */
export interface ClientQuickPrompt {
  id: string
  title: string
  description: string | null
  content: string
  icon: string
  position: AiQuickPromptPosition
}

export interface QuickPromptListQuery {
  position?: AiQuickPromptPosition
}

export interface UpdateConversationBody {
  title: string
}

export interface MoveConversationBody {
  projectId: string | null
}

export interface ConversationSettingsBody {
  reasoningMode: 'OFF' | 'ON'
}

export type UserSelectionKind = 'KNOWLEDGE_SOURCE' | 'REPORT_TYPE' | 'PRODUCT' | 'GENERIC'
export type UserSelectionConfirmActionType = 'CONTINUE' | 'GENERATE_REPORT'
export type ConversationUiAction = 'SELECT_PRODUCTS' | 'GENERATE_REPORT' | 'SELECT_KNOWLEDGE_SOURCES'

export interface SendMessageBody {
  content?: string
  attachmentFileIds?: string[]
  optionId?: string
  optionIds?: string[]
  selectedIds?: string[]
  selectedProductIds?: string[]
  selectionKind?: UserSelectionKind
  action?: ConversationUiAction
  confirmAction?: UserSelectionConfirmActionType
}

export interface RegenerateMessageBody {
  reason?: string
}

export interface TranscribeVoiceBody {
  speech: string
  format: 'm4a' | 'wav'
  rate: 16000
  channel: 1
  durationMs?: number
}

export interface TranscribeVoiceResult {
  text: string
}

export interface MessageFeedbackBody {
  reaction?: AiFeedbackReaction | null
  tags?: string[]
  content?: string | null
  clientApp?: ConversationRecord['clientApp']
}

export interface ReportDraftBody {
  reportType: ReportType
  requirements?: string
}

export type AiSourceType = 'KNOWLEDGE' | 'STANDARD' | 'ATLAS' | 'THERMAL' | 'OTHER'
export type AiRetrievalUnit = 'DOCUMENT' | 'SECTION' | 'PAGE' | 'BLOCK' | 'CHUNK'

export interface AiSourceHighlight {
  pageId?: string
  pageNumber?: number | null
  pageLabel?: string | null
  blockId?: string
  charStart?: number | null
  charEnd?: number | null
  text?: string
}

/** AI 回答来源（与后端 ai-source.mapper 对齐）。C 端只展示 title / tocPath / pageLabel / quote。 */
export interface AiSourceRef {
  sourceType?: AiSourceType
  retrievalUnit?: AiRetrievalUnit
  documentId?: string
  versionId?: string
  sectionId?: string
  pageId?: string
  blockId?: string
  chunkId?: string
  title: string
  tocPath?: string[] | null
  sectionTitle?: string | null
  chapter?: string | null
  section?: string | null
  sectionPath?: string[] | null
  citationAnchor?: string | null
  pageNumber?: number | null
  /** PDF 物理页，仅用于打开原文定位，不展示给用户 */
  physicalPageNumber?: number | null
  /** 印刷页码标签（用户主展示：A7 / 21） */
  pageLabel?: string | null
  pageTitle?: string | null
  originalFileId?: string | null
  pageStart?: number | null
  pageEnd?: number | null
  /** 兼容一期字段：等价 pageNumber，不作为用户页码 */
  page?: number | null
  matchedText?: string | null
  quote?: string | null
  snippet?: string | null
  highlightRanges?: AiSourceHighlight[]
  evidenceLevel?: string | null
  score?: number | null
}

export interface AiSourceLocatorQuery {
  documentId?: string
  sectionId?: string
  pageId?: string
  blockId?: string
  chunkId?: string
  matchedText?: string
}

export interface AiSourceDocumentSummary {
  id: string
  title: string
  versionId: string
  version: number
  docNumber: string | null
  docType: string
  visibility: string
  projectId: string | null
}

export interface AiSourceDetailLocation {
  sectionId: string | null
  chapter: string | null
  section: string | null
  sectionPath: string[] | null
  citationAnchor: string | null
  pageNumber: number | null
  physicalPageNumber: number | null
  pageLabel: string | null
  pageTitle: string | null
}

export interface AiSourcePageBlock {
  id: string
  blockIndex: number
  content: string
  contentType: string
  sourceAnchor: string | null
  metadata: Record<string, unknown> | null
}

export interface AiSourcePage {
  id: string
  pageNumber: number
  physicalPageNumber: number
  pageLabel: string | null
  pageTitle: string | null
  fullText: string
  extractedText: string
  blocks: AiSourcePageBlock[]
  pageImageUrl: string | null
}

export interface AiSourceDetailHighlight {
  pageId: string
  pageNumber: number
  physicalPageNumber?: number
  pageLabel: string | null
  blockId: string | null
  text: string
  charStart: number | null
  charEnd: number | null
}

export interface AiSourceDetail {
  document: AiSourceDocumentSummary
  toc: { path: string[] | null }
  location: AiSourceDetailLocation
  original: {
    fileId: string | null
    pageImageUrl: string | null
    previewUrl: string | null
  }
  extracted: {
    text: string | null
    blocks: AiSourcePageBlock[]
  }
  page: AiSourcePage | null
  highlights: AiSourceDetailHighlight[]
}

export interface AiRetrievalRecord {
  id: string
  conversationId: string
  messageId: string | null
  documentId: string | null
  chunkId: string | null
  score: number | null
  sourcePage: number | null
  sourceTitle: string | null
  createdAt: string
}

export interface AiRegenerationRecord {
  id: string
  conversationId: string
  originalMessageId: string
  regeneratedMessageId: string
  userId: string | null
  reason: string | null
  createdAt: string
}

export interface AiShareLinkRecord {
  id: string
  token: string
  targetType: ShareTargetType
  targetId: string | null
  projectId: string | null
  createdById: string | null
  title: string
  enabled: boolean
  expiresAt: string | null
  maxViews: number | null
  viewCount: number
  createdAt: string
  updatedAt: string
}

export interface ReportItem extends ReportRecord {
  artifacts: Array<{
    id: string
    reportId: string
    artifactType: ReportArtifactType
    fileId: string
    sortOrder: number
    status: string
    file: {
      id: string
      originalName: string
      mimeType: string
      sizeBytes: number
      status: string
    }
  }>
  sources: unknown[]
}

/**
 * SSE 流事件负载（后端 ai-sse 事件序列：message → progress* → delta* → done|stopped|error）。
 * send 与 regenerate 共用，regenerate 的 message/done 事件额外携带 originalMessageId/regeneratedMessageId。
 */
export type AiStreamEventPayload
  = | {
    event: 'message'
    data: {
      messageId: string
      conversationId: string
      userMessageId?: string
      originalMessageId?: string
      requestId: string
    }
  }
  | {
    event: 'progress'
    data: {
      stage: 'analyzing' | 'checking' | 'composing' | 'completed'
      message: string
    }
  }
  | {
    event: 'agent_status'
    data: {
      message: string
      toolName?: string
      runId?: string
    }
  }
  | {
    event: 'tool_start'
    data: {
      message?: string
      toolName?: string
    }
  }
  | {
    event: 'tool_result'
    data: {
      toolName?: string
      success: boolean
      error?: string
    }
  }
  | {
    event: 'need_user_input'
    data: {
      runId: string
      type?: 'USER_SELECTION' | 'CHOICE' | 'APPROVAL' | 'COMPARISON_SELECTION'
      selectionKind?: UserSelectionKind
      title?: string
      description?: string
      prompt: string
      options: unknown[]
      multiple?: boolean
      minSelections?: number
      maxSelections?: number
      autoSelectWhenSingle?: boolean
      confirmAction?: { type: UserSelectionConfirmActionType, label: string }
      comparisonResult?: unknown
      request?: unknown
    }
  }
  | {
    event: 'comparison_ready'
    data: {
      comparisonResult?: unknown
      thermalStatus?: string
      missingNotes?: string[]
    }
  }
  | {
    event: 'product_cards'
    data: {
      products: unknown[]
    }
  }
  | {
    event: 'report_started'
    data: {
      conversationId?: string
    }
  }
  | {
    event: 'report_queued'
    data: {
      reportId: string
      taskId?: string
      status?: string
      selectedProductIds?: string[]
      title?: string
    }
  }
  | {
    event: 'report_completed'
    data: {
      reportId: string
      selectedProductIds?: string[]
      title?: string
    }
  }
  | {
    event: 'sources'
    data: {
      sources: AiSourceRef[]
    }
  }
  | {
    event: 'delta'
    data: { text: string }
  }
  | {
    event: 'done'
    data: {
      messageId: string
      conversationId: string
      finishReason: string
      sources: AiSourceRef[]
      model?: { id: string } | null
      regeneratedMessageId?: string
    }
  }
  | {
    event: 'stopped'
    data: {
      messageId: string
      content: string
    }
  }
  | {
    event: 'error'
    data: {
      code: string
      message: string
      requestId: string
      retryable?: boolean
    }
  }

export type FilePurpose = 'GENERAL' | 'CHAT_IMAGE'
export type MessageAttachmentType = 'IMAGE'
export type MessageVisionStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED'

export interface MessageAttachment {
  id: string
  fileId: string
  attachmentType: MessageAttachmentType
  sortOrder: number
  visionStatus?: MessageVisionStatus | null
  semanticSummary?: string | null
  file?: {
    id: string
    originalName: string
    mimeType: string
    sizeBytes: number
    status: string
  }
  /** 本地乐观消息或已解析的预览地址，不落库 */
  previewUrl?: string
}

export interface ConversationMessage {
  id: string
  conversationId: string
  userId: string | null
  role: 'USER' | 'ASSISTANT' | 'SYSTEM'
  content: string
  status: 'PENDING' | 'STREAMING' | 'COMPLETED' | 'STOPPED' | 'FAILED'
  reasoningMode: 'OFF' | 'ON'
  model?: string | null
  durationMs?: number | null
  startedAt?: string | null
  finishedAt?: string | null
  stopReason?: string | null
  createdAt: string
  attachments?: MessageAttachment[]
}

export interface AiMessageFeedback {
  id: string
  messageId: string
  conversationId: string
  userId: string
  reaction: AiFeedbackReaction | null
  tags: string[]
  content: string | null
  createdAt: string
}

export type AgentRunStatus = 'RUNNING' | 'WAITING_USER_INPUT' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

export interface AgentRunWaitingDto {
  type?: 'USER_SELECTION' | 'CHOICE' | 'APPROVAL' | 'COMPARISON_SELECTION'
  selectionKind?: UserSelectionKind
  title?: string
  description?: string
  prompt: string
  options?: unknown[]
  multiple?: boolean
  minSelections?: number
  maxSelections?: number
  autoSelectWhenSingle?: boolean
  confirmAction?: { type: UserSelectionConfirmActionType, label: string }
  comparisonResult?: unknown
  request?: unknown
}

export interface AgentRunDto {
  id: string
  conversationId: string
  status: AgentRunStatus
  currentStep?: number
  waitingPrompt?: string | null
  waitingOptions?: unknown[] | null
  waiting?: AgentRunWaitingDto | null
  selectedComparison?: { optionIds: string[], labels: string[] } | null
  errorMessage?: string | null
  errorCode?: string | null
  assistantMessageId?: string | null
  startedAt?: string
  finishedAt?: string | null
}

export interface ResumeAgentRunBody {
  content?: string
  optionId?: string
  optionIds?: string[]
  selectedIds?: string[]
  selectedProductIds?: string[]
  selectionKind?: UserSelectionKind
  action?: ConversationUiAction
  confirmAction?: UserSelectionConfirmActionType
}

export type ProjectMemoryType = 'FACT' | 'CONSTRAINT' | 'DECISION' | 'PREFERENCE' | 'TODO' | 'ASSUMPTION'
export type ProjectMemoryStatus = 'ACTIVE' | 'PENDING' | 'SUPERSEDED' | 'REJECTED'
export type ProjectMemoryView = 'active' | 'pending' | 'history'

export interface ProjectMemoryItem {
  id: string
  projectId: string
  memoryType: ProjectMemoryType
  title: string | null
  content: string
  status: ProjectMemoryStatus
  verified: boolean
  sourceConversationId: string | null
  createdBy: 'AI' | 'USER' | string
  supersededById: string | null
  createdAt: string
  updatedAt: string
}

export interface UpdateProjectMemoryBody {
  title?: string | null
  content?: string
  memoryType?: ProjectMemoryType
}

export interface ConversationDetail {
  conversation: ConversationRecord
  messages: ConversationMessage[]
  activeAgentRun?: AgentRunDto | null
  processingSummary?: {
    stages: Array<{ stage: string, message: string }>
    note?: string
  }
  retrievals: AiRetrievalRecord[]
  feedbacks: AiMessageFeedback[]
  regenerations: AiRegenerationRecord[]
  reports: ReportItem[]
  shareLinks: AiShareLinkRecord[]
}

export interface UploadIntentBody {
  projectId?: string
  purpose?: FilePurpose
  fileName: string
  mimeType: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' | 'image/png' | 'image/jpeg'
  sizeBytes: number
  sha256?: string
}

export interface UploadIntentResult {
  message: string
  fileId: string
  mode?: 'UPLOAD' | 'REUSE'
  uploadUrl?: string
  headers?: Record<string, string>
  expiresAt?: string
  file?: {
    id: string
    originalName: string
    mimeType: string
    sizeBytes: number
    sha256: string | null
  }
}

export interface UploadCompleteResult {
  message: string
  fileId: string
  taskId?: string
  status?: string
  duplicateOfFileId?: string
}

export interface FileRecord {
  id: string
  projectId: string | null
  originalName: string
  mimeType: string
  sizeBytes: number
  sha256: string | null
  purpose?: FilePurpose
  status: 'UPLOADING' | 'UPLOADED' | 'QUEUED' | 'PARSING' | 'OCR_REQUIRED' | 'INDEXING' | 'READY' | 'FAILED' | 'DELETED'
  errorMessage: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface FileStatusResult {
  file: FileRecord
  task: AsyncTaskRecord | null
}

export interface AsyncTaskRecord {
  id: string
  queueName: string
  jobType: string
  businessType: string | null
  businessId: string | null
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  progress: number
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export type ReportType = string
export type ReportArtifactType = 'HTML' | 'IMAGE' | 'WORD' | 'PDF'
export type ReportTaskStatus = 'QUEUED' | 'GENERATING' | 'READY' | 'FAILED' | 'CANCELLED'
export type ReportRecordStatus = 'DRAFT' | 'QUEUED' | 'PROCESSING' | 'GENERATING' | 'READY' | 'FAILED' | 'CANCELLED' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'

export interface PublicReportType {
  code: string
  name: string
  description: string
  requiresProject: boolean
  enabled: boolean
}

export interface CreateReportBody {
  projectId?: string
  conversationId?: string
  reportType: ReportType
  contentJson?: Record<string, unknown>
  sourceMessageIds?: string[]
}

export interface ReportProjectRef {
  id: string
  name: string
}

export interface ReportListQuery extends PageQuery {
  projectId?: string
}

export interface MyReportItem {
  id: string
  title: string
  reportType: ReportType | string
  status: ReportRecord['status'] | string
  createdAt: string
  project: ReportProjectRef | null
}

export interface ReportRecord {
  id: string
  projectId: string | null
  conversationId: string | null
  reportType: ReportType
  contentJson: Record<string, unknown>
  status: ReportRecordStatus | string
  errorMessage: string | null
  publishedAt: string | null
  templateVersion: string
  createdById: string
  createdAt: string
  updatedAt: string
}

export interface ReportDetail {
  report: ReportRecord
  project?: ReportProjectRef | null
  sources: unknown[]
  availableFormats: ReportArtifactType[]
}

export interface LinkReportProjectBody {
  projectId: string
}

export interface ReportDraftResult {
  message: string
  report: ReportRecord
  draft?: Record<string, unknown>
}

export interface CreateReportResult {
  message: string
  report: ReportRecord
  taskId: string
}

export interface ReportTaskResult {
  message: string
  reportId: string
  taskId: string
}

export interface DownloadUrlResult {
  url: string
  expiresIn: number
}

export type ShareTargetType = 'AI_MESSAGES' | 'REPORT' | 'REPORT_ARTIFACT' | 'PROJECT'

export interface CreateShareBody {
  targetType: ShareTargetType
  messageIds?: string[]
  reportId?: string
  artifactType?: ReportArtifactType
  title?: string
  projectId?: string
  expiresAt?: string
  maxViews?: number
}

export interface ShareMessageSnapshot {
  index: number
  id: string
  role?: 'USER' | 'ASSISTANT'
  content: string
  model?: string | null
  createdAt: string
}

export interface SharePublicPayload {
  type: ShareTargetType
  conversationId?: string
  scene?: string | null
  messages?: ShareMessageSnapshot[]
}

export interface CreateShareResult {
  message: string
  share: AiShareLinkRecord
  url: string
}

export interface PublicShareResult {
  title: string
  targetType: ShareTargetType
  payload: SharePublicPayload
}

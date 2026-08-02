import type { PageResult } from './api'
import type { AsyncTaskRecord, FileRecord } from './file'

/** 项目可见性，与后端 PROJECT_VISIBILITY 对齐。 */
export type ProjectVisibility = 'PRIVATE' | 'PUBLIC'

/** 项目状态，与后端 projects.status 对齐。 */
export type ProjectStatus = 'active' | 'deleted'

/** 项目记录（后端 projects 表投影，创建/更新 schema 只开放 name/description/visibility）。 */
export interface ProjectItem {
  id: string
  name: string
  description: string | null
  region: string | null
  buildingType: string | null
  visibility: ProjectVisibility
  visibilityPolicy: string
  status: ProjectStatus
  metadata: Record<string, unknown> | null
  createdById: string
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 项目中心视图切换。 */
export type ProjectViewKey = 'my' | 'public' | 'all'

/** GET /workspace/projects/my、/projects/public、/platform/projects 查询参数。 */
export interface ProjectPageQuery {
  page?: number
  pageSize?: number
  /** 仅平台全部项目列表支持。 */
  visibility?: ProjectVisibility
  [key: string]: unknown
}

/** 项目分页列表响应。 */
export type ProjectPageResult = PageResult<ProjectItem>

/** 创建项目请求体（createProjectBodySchema）。 */
export interface CreateProjectInput {
  name: string
  description?: string
  visibility: ProjectVisibility
}

/** 修改项目请求体（updateProjectBodySchema，不含 visibility）。 */
export interface UpdateProjectInput {
  name?: string
  description?: string
}

/** 项目变更接口响应。 */
export interface ProjectMutationResult {
  message: string
  project?: ProjectItem
}

/** GET /projects/:id 响应。 */
export interface ProjectDetailResult {
  message?: string
  project: ProjectItem
}

/** AI 会话列表项（GET /ai/conversations?projectId= 返回结构）。 */
export interface ProjectConversation {
  id: string
  userId: string
  projectId: string | null
  clientApp: string
  scene: string
  title: string | null
  reasoningMode: 'OFF' | 'ON'
  isPinned: boolean
  status: string
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  project: { id: string, name: string } | null
  messageCount: number
  lastMessage: {
    id: string
    role: 'USER' | 'ASSISTANT'
    status: string
    preview: string
    createdAt: string
  } | null
}

/** GET /ai/conversations 响应。 */
export type ProjectConversationPageResult = PageResult<ProjectConversation>

/** 项目操作记录（audit_logs 表投影）。 */
export interface ProjectAuditLog {
  id: string
  actorUserId: string | null
  projectId: string | null
  action: string
  targetType: string | null
  targetId: string | null
  beforeJson: unknown
  afterJson: unknown
  ip: string | null
  userAgent: string | null
  requestId: string | null
  createdAt: string
}

/** GET /platform/audit-logs 响应。 */
export type ProjectAuditLogPageResult = PageResult<ProjectAuditLog>

/** 项目详情页资料文件列表项。 */
export type ProjectFile = FileRecord

export type { AsyncTaskRecord }
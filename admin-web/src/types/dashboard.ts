export type AttentionPriority = 'high' | 'medium' | 'low'

export type KnowledgePipelineStage =
  | 'PENDING_PARSE'
  | 'PARSING'
  | 'PENDING_REVIEW'
  | 'STORED'
  | 'FAILED'

export type TaskStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

export type TrendRange = '7d' | '30d'

/** 工作台核心指标，后端未聚合时整体为 null */
export interface DashboardSummary {
  projectTotal: number
  pendingDocuments: number
  pendingReviewData: number
  reportTasks: number
}

/** 待处理事项，可携带跳转路由与按钮权限 */
export interface DashboardAttentionItem {
  id: string
  priority: AttentionPriority
  type: string
  title: string
  description?: string
  count?: number
  time?: string
  route?: string
  permission?: string
}

export interface KnowledgePipelineStatus {
  stage: KnowledgePipelineStage
  count: number
  /** 对应筛选页路由；无真实路由时为 null，禁止点击 */
  route: string | null
}

export interface DashboardRecentProject {
  id: string
  name: string
  region?: string
  visibility: 'PUBLIC' | 'PRIVATE'
  stage?: string
  updatedAt: string
  ownerName?: string
  /** 项目详情路由；后端未提供时为空，禁止点击 */
  route?: string
}

export interface DashboardRecentActivity {
  id: string
  actor: string
  action: string
  objectName: string
  type: string
  time: string
  route?: string
}

export interface DashboardTrendPoint {
  date: string
  stored: number
  reviewed: number
  reports: number
}

export interface DashboardTaskDistributionItem {
  status: TaskStatus
  count: number
}

export interface DashboardOverview {
  summary: DashboardSummary | null
  attentionItems: DashboardAttentionItem[]
  knowledgePipeline: KnowledgePipelineStatus[]
  recentProjects: DashboardRecentProject[]
  recentActivities: DashboardRecentActivity[]
  trend: DashboardTrendPoint[] | null
  taskDistribution: DashboardTaskDistributionItem[] | null
}

/** 无后端聚合数据时的诚实空投影 */
export function createEmptyDashboardOverview(): DashboardOverview {
  return {
    summary: null,
    attentionItems: [],
    knowledgePipeline: [],
    recentProjects: [],
    recentActivities: [],
    trend: null,
    taskDistribution: null,
  }
}
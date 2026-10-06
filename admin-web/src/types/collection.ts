import type { PageQuery, PageResult } from '@/types/api'

/** 采集管理独立 Domain：获取外部候选资料，确认后导入 Knowledge。 */

export const COLLECTION_PERMISSIONS = {
  LIST: 'system:collection:list',
  MANUAL_CREATE: 'system:collection:manual:create',
  AUTO_LIST: 'system:collection:auto:list',
  AUTO_CREATE: 'system:collection:auto:create',
  AUTO_UPDATE: 'system:collection:auto:update',
  AUTO_TOGGLE: 'system:collection:auto:toggle',
  TASK_VIEW: 'system:collection:task:view',
  TASK_IMPORT: 'system:collection:task:import',
  SKILL_LIST: 'system:collection:skill:list',
  SKILL_CREATE: 'system:collection:skill:create',
  SKILL_UPDATE: 'system:collection:skill:update',
  DASHBOARD: 'system:collection:dashboard',
  RECORD_LIST: 'system:collection:record:list',
} as const

export type CollectionPermission = (typeof COLLECTION_PERMISSIONS)[keyof typeof COLLECTION_PERMISSIONS]

export const collectionModes = ['MANUAL', 'AUTO'] as const
export type CollectionMode = (typeof collectionModes)[number]

/** Backend 任务状态。PENDING/RUNNING 在业务 UI 中统一显示为「采集中」。 */
export const collectionTaskStatuses = [
  'PENDING',
  'RUNNING',
  'WAITING_CONFIRM',
  'COMPLETED',
  'FAILED',
] as const
export type CollectionTaskStatus = (typeof collectionTaskStatuses)[number]

/** 业务 UI 状态：采集中 / 待确认 / 已入库 / 采集失败 */
export const collectionUiStatuses = [
  'COLLECTING',
  'WAITING_CONFIRM',
  'COMPLETED',
  'FAILED',
] as const
export type CollectionUiStatus = (typeof collectionUiStatuses)[number]

export interface CollectionSource {
  id: string
  name: string
  sourceUrl: string
  mode: 'AUTO'
  enabled: boolean
  skillId: string | null
  lastCollectedAt: string | null
  lastRunAt: string | null
  createdById: string | null
  createdAt: string
  updatedAt: string
}

export interface CollectionSourceInput {
  name: string
  sourceUrl: string
  skillId?: string | null
  enabled?: boolean
}

export interface CollectionSkill {
  id: string
  name: string
  keywordsJson: string[]
  instruction: string | null
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface CollectionSkillInput {
  name: string
  keywordsJson?: string[]
  instruction?: string
  enabled?: boolean
}

export interface CollectionDashboardSummary {
  total: number
  today: number
  thisMonth: number
  thisYear: number
}

export type CollectionTrendGranularity = 'day' | 'month' | 'year'

export interface CollectionTrendPoint {
  period: string
  count: number
}

export interface CollectionTrendResult {
  granularity: CollectionTrendGranularity
  items: CollectionTrendPoint[]
}

export interface CollectionRecord {
  id: string
  sourceId: string | null
  skillId: string | null
  taskId: string | null
  runId: string | null
  title: string
  url: string
  publishedAt: string | null
  collectedAt: string
  keywordsJson: string[] | null
  summary: string | null
  createdAt: string
}

export interface CollectionRecordQuery extends PageQuery {
  sourceId?: string
  keyword?: string
}

export interface CollectionTask {
  id: string
  sourceId: string | null
  name: string
  sourceUrl: string
  mode: CollectionMode
  status: CollectionTaskStatus
  resultFileId: string | null
  resultMeta: Record<string, unknown> | null
  errorMessage: string | null
  createdById: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  importedKnowledgeDocumentId: string | null
}

export interface ManualCollectionInput {
  name: string
  sourceUrl: string
  remark?: string
}

export interface CollectionTaskQuery extends PageQuery {
  mode?: CollectionMode
  status?: CollectionTaskStatus
  keyword?: string
}

export interface CollectionImportResult {
  taskId: string
  knowledgeDocumentId: string
  versionId: string
  versionStatus: string
  published: boolean
}

export type CollectionTaskPage = PageResult<CollectionTask>

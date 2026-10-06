import type { ProjectItem, ProjectVisibility } from '@/types/project'
import type { AppStatus } from '@/components/ui/AppStatusTag.vue'

export type ProjectDetailTabKey = 'overview' | 'conversations' | 'reports' | 'memory' | 'audit'

export interface ProjectDetailTab {
  key: ProjectDetailTabKey
  label: string
}

/** 详情页可用 Tab：仅保留有真实接口的模块。 */
export const PROJECT_DETAIL_TABS: readonly ProjectDetailTab[] = [
  { key: 'overview', label: '基本信息' },
  { key: 'conversations', label: 'AI 对话' },
  { key: 'reports', label: '报告' },
  { key: 'memory', label: 'AI记忆' },
  { key: 'audit', label: '操作记录' },
] as const

export interface ProjectDetailTabAccess {
  canViewAuditLogs: boolean
  canViewAiMemory: boolean
  canViewReports?: boolean
}

export function projectDetailTabs(access: boolean | ProjectDetailTabAccess): ProjectDetailTab[] {
  const canViewAuditLogs = typeof access === 'boolean' ? access : access.canViewAuditLogs
  const canViewAiMemory = typeof access === 'boolean' ? false : access.canViewAiMemory
  const canViewReports = typeof access === 'boolean' ? true : access.canViewReports !== false
  return PROJECT_DETAIL_TABS.filter((tab) => {
    if (tab.key === 'audit') {
      return canViewAuditLogs
    }
    if (tab.key === 'memory') {
      return canViewAiMemory
    }
    if (tab.key === 'reports') {
      return canViewReports
    }
    return true
  })
}

/** 行级管理权限：项目创建者和超级管理员。 */
export function isProjectManager(
  project: Pick<ProjectItem, 'createdById'>,
  currentUserId: string | null,
  isSuperAdmin: boolean,
): boolean {
  return isSuperAdmin || project.createdById === currentUserId
}

export interface ProjectVisibilityMeta {
  label: string
  status: AppStatus
}

export function projectVisibilityMeta(visibility: ProjectVisibility): ProjectVisibilityMeta {
  if (visibility === 'PUBLIC') {
    return { label: '公开', status: 'success' }
  }
  if (visibility === 'DEPARTMENT') {
    return { label: '部门可见', status: 'info' }
  }
  return { label: '私有', status: 'default' }
}

/** 公开范围：私有，或「技术部（包含子部门）」。 */
export function formatProjectVisibilityScope(project: Pick<
  ProjectItem,
  'visibility' | 'includeChildDepartments' | 'ownerDepartmentName'
>): string {
  if (project.visibility === 'PRIVATE') {
    return '私有'
  }
  if (project.visibility === 'PUBLIC') {
    return '公开'
  }
  const departmentName = project.ownerDepartmentName?.trim() || '部门'
  return project.includeChildDepartments === false
    ? departmentName
    : `${departmentName}（包含子部门）`
}

export interface ProjectStatusMeta {
  label: string
  status: AppStatus
}

export function projectStatusMeta(status: ProjectItem['status']): ProjectStatusMeta {
  return status === 'active'
    ? { label: '正常', status: 'success' }
    : { label: '已删除', status: 'disabled' }
}

/** 全部项目视图的可见性筛选选项（后端仅 platform 列表支持 visibility 参数）。 */
export const PROJECT_VISIBILITY_FILTER_OPTIONS = [
  { label: '全部可见范围', value: '' },
  { label: '公开', value: 'PUBLIC' },
  { label: '私有', value: 'PRIVATE' },
  { label: '部门可见', value: 'DEPARTMENT' },
] as const

export function normalizeVisibilityFilter(value: string): ProjectVisibility | undefined {
  return value === 'PUBLIC' || value === 'PRIVATE' || value === 'DEPARTMENT' ? value : undefined
}

export interface ProjectTaskEntry {
  key: string
  label: string
  description: string
  permissions: string[]
  route: string | null
  tabKey?: ProjectDetailTabKey
}

export function projectTaskEntries(
  project: Pick<ProjectItem, 'id' | 'region'>,
): ProjectTaskEntry[] {
  const projectId = encodeURIComponent(project.id)
  return [
    {
      key: 'overview',
      label: '基本信息',
      description: '项目概况、创建用户、部门与可见范围',
      permissions: [],
      route: null,
      tabKey: 'overview',
    },
    {
      key: 'conversations',
      label: 'AI 对话',
      description: '查看该项目下的 AI 会话',
      permissions: [],
      route: null,
      tabKey: 'conversations',
    },
    {
      key: 'reports',
      label: '报告',
      description: '项目报告成果：预览、发布与下载',
      permissions: ['system:report:generate'],
      route: `/reports?projectId=${projectId}`,
    },
    {
      key: 'calc',
      label: '热工计算',
      description: '由热工引擎执行计算，页面只展示过程与结果',
      permissions: ['system:thermal:list'],
      route: `/thermal/calc?projectId=${projectId}`,
    },
  ]
}

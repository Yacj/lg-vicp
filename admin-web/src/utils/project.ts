import type { ProjectItem, ProjectVisibility } from '@/types/project'
import type { AppStatus } from '@/components/ui/AppStatusTag.vue'

export type ProjectDetailTabKey = 'overview' | 'files' | 'conversations' | 'audit'

export interface ProjectDetailTab {
  key: ProjectDetailTabKey
  label: string
}

/** 详情页可用 Tab：仅保留有真实接口的模块，无数据源的 Tab 不进入投影。 */
export const PROJECT_DETAIL_TABS: readonly ProjectDetailTab[] = [
  { key: 'overview', label: '项目概况' },
  { key: 'files', label: '资料文件' },
  { key: 'conversations', label: 'AI 会话' },
  { key: 'audit', label: '操作记录' },
] as const

/** 操作记录 Tab 需要平台审计权限，其余 Tab 登录可见。 */
export function projectDetailTabs(canViewAuditLogs: boolean): ProjectDetailTab[] {
  return PROJECT_DETAIL_TABS.filter((tab) => tab.key !== 'audit' || canViewAuditLogs)
}

/** 行级管理权限：仅项目创建者或超级管理员（与后端 canManageProject 对齐）。 */
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
  return visibility === 'PUBLIC'
    ? { label: '公开', status: 'success' }
    : { label: '私有', status: 'default' }
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
  { label: '全部可见性', value: '' },
  { label: '公开', value: 'PUBLIC' },
  { label: '私有', value: 'PRIVATE' },
] as const

export function normalizeVisibilityFilter(value: string): ProjectVisibility | undefined {
  return value === 'PUBLIC' || value === 'PRIVATE' ? value : undefined
}
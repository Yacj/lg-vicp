import type { ProjectItem, ProjectVisibility } from '@/types/project'
import type { AppStatus } from '@/components/ui/AppStatusTag.vue'

export type ProjectDetailTabKey = 'overview' | 'conversations' | 'audit'

export interface ProjectDetailTab {
  key: ProjectDetailTabKey
  label: string
}

/** 详情页可用 Tab：仅保留有真实接口的模块，无数据源的 Tab 不进入投影。 */
export const PROJECT_DETAIL_TABS: readonly ProjectDetailTab[] = [
  { key: 'overview', label: '基本信息' },
  { key: 'conversations', label: 'AI 会话' },
  { key: 'audit', label: '操作记录' },
] as const

/** 操作记录 Tab 需要平台审计权限，其余 Tab 登录可见。 */
export function projectDetailTabs(canViewAuditLogs: boolean): ProjectDetailTab[] {
  return PROJECT_DETAIL_TABS.filter((tab) => tab.key !== 'audit' || canViewAuditLogs)
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

/** 项目详情任务入口：tabKey 指向详情页内 Tab，route 指向跨页面任务。 */
export interface ProjectTaskEntry {
  key: string
  label: string
  description: string
  permissions: string[]
  route: string | null
  tabKey?: ProjectDetailTabKey
}

/**
 * 项目详情任务入口投影（纯函数）。
 * 只映射真实存在的页面与权限码：无正式后端契约的能力（如项目内独立的项目条件表单）
 * 以受权限控制的相邻能力入口承载，不伪造业务数据。
 */
export function projectTaskEntries(
  project: Pick<ProjectItem, 'id' | 'region'>,
): ProjectTaskEntry[] {
  const projectId = encodeURIComponent(project.id)
  const region = project.region?.trim()
  return [
    {
      key: 'overview',
      label: '基本信息',
      description: '项目概况、可见性与状态',
      permissions: [],
      route: null,
      tabKey: 'overview',
    },
    {
      key: 'conditions',
      label: '项目条件',
      description: region
        ? `以项目地区「${region}」预填的候选方案试算条件`
        : '候选方案试算条件（可在试算页补充地区）',
      permissions: ['system:thermal:list'],
      route: region
        ? `/thermal/candidates?regionCode=${encodeURIComponent(region)}`
        : '/thermal/candidates',
    },
    {
      key: 'calc',
      label: '智能计算',
      description: '按目标 K 值查询满足条件的保温构造候选方案',
      permissions: ['system:thermal:list'],
      route: '/thermal/candidates',
    },
    {
      key: 'schemes',
      label: '方案选择',
      description: '项目历史计算记录与已选方案结果',
      permissions: ['system:thermal:list'],
      route: `/thermal/calc-records?projectId=${projectId}`,
    },
    {
      key: 'comparison',
      label: '材料对比',
      description: '材料对比规则与版本配置',
      permissions: ['system:comparison:list'],
      route: '/comparison/versions',
    },
    {
      key: 'nodes',
      label: '节点方案',
      description: '节点大样图库',
      permissions: ['system:node:list'],
      route: '/nodes/drawings',
    },
    {
      key: 'reports',
      label: '报告',
      description: '项目报告成果：预览、发布与下载',
      permissions: ['system:report:generate'],
      route: `/reports?projectId=${projectId}`,
    },
  ]
}
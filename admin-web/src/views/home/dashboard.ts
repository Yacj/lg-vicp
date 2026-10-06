import type { AttentionPriority, DashboardAttentionItem } from '@/types/dashboard'

/** 从候选路径中选择第一个真实可导航的路由，没有则返回 null */
export function resolveFirstNavigable(
  candidates: readonly string[],
  canNavigate: (path: string) => boolean,
): string | null {
  return candidates.find(path => canNavigate(path)) ?? null
}

export type Greeting = '上午好' | '下午好' | '晚上好'

export function getGreeting(hour: number): Greeting {
  if (hour < 12) {
    return '上午好'
  }
  if (hour < 18) {
    return '下午好'
  }
  return '晚上好'
}

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'] as const

export function formatToday(date: Date = new Date()): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 星期${WEEKDAY_NAMES[date.getDay()]}`
}

// ===== 核心指标卡投影：数据来自既有列表/统计接口，无权限或路由不可达时不渲染 =====

export type DashboardMetricStatus = 'default' | 'warning' | 'error'

export interface DashboardMetricInput {
  id: string
  label: string
  /** 候选路由，按可达性取第一个；全部不可达（未授权）时整卡隐藏 */
  paths: readonly string[]
  /** 真实计数；null 表示暂无数据（加载失败或接口缺失） */
  count: number | null
  secondaryText?: string
  /** count > 0 时的语义强调状态 */
  activeStatus?: Exclude<DashboardMetricStatus, 'default'>
}

export interface DashboardMetricCard {
  id: string
  label: string
  value: number | null
  secondaryText: string
  status: DashboardMetricStatus
  path: string
}

export function projectMetricCards(
  inputs: readonly DashboardMetricInput[],
  canNavigate: (path: string) => boolean,
): DashboardMetricCard[] {
  return inputs.flatMap((input) => {
    const path = resolveFirstNavigable(input.paths, canNavigate)
    if (!path) {
      return []
    }
    const active = input.count !== null && input.count > 0
    return [{
      id: input.id,
      label: input.label,
      value: input.count,
      secondaryText: input.secondaryText ?? '',
      status: active ? (input.activeStatus ?? 'default') : 'default',
      path,
    }]
  })
}

// ===== 待处理事项投影：仅展示有真实计数且大于 0 的事项，按优先级与数量排序 =====

export interface DashboardAttentionInput {
  id: string
  title: string
  description: string
  priority: AttentionPriority
  /** 候选路由，按可达性取第一个；全部不可达（未授权）时不展示 */
  paths: readonly string[]
  /** 真实计数；null 或 0 表示无待处理，不进入列表 */
  count: number | null
}

const ATTENTION_PRIORITY_ORDER: Record<AttentionPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export function projectAttentionItems(
  inputs: readonly DashboardAttentionInput[],
  canNavigate: (path: string) => boolean,
): DashboardAttentionItem[] {
  return inputs
    .filter(input => input.count !== null && input.count > 0)
    .flatMap((input) => {
      const route = resolveFirstNavigable(input.paths, canNavigate)
      if (!route) {
        return []
      }
      return [{
        id: input.id,
        priority: input.priority,
        type: 'todo',
        title: input.title,
        description: input.description,
        count: input.count ?? undefined,
        route,
      }]
    })
    .sort((a, b) =>
      ATTENTION_PRIORITY_ORDER[a.priority] - ATTENTION_PRIORITY_ORDER[b.priority]
      || (b.count ?? 0) - (a.count ?? 0))
}

// ===== 快捷入口投影：固定高频入口，按权限码与路由可达性双重裁剪 =====

export type DashboardQuickIcon = 'add' | 'book' | 'chat' | 'check' | 'file' | 'user'

export interface DashboardQuickAction {
  id: string
  title: string
  description: string
  icon: DashboardQuickIcon
  path: string
  permissions: readonly string[]
}

export const QUICK_ACTION_DEFINITIONS: readonly DashboardQuickAction[] = [
  {
    id: 'project-view',
    title: '项目管理',
    description: '查看全平台项目',
    icon: 'file',
    path: '/projects',
    permissions: ['project.view'],
  },
  {
    id: 'knowledge-documents',
    title: '知识库',
    description: '资料文档与解析',
    icon: 'book',
    path: '/knowledge/documents',
    permissions: ['system:knowledge:doc:list'],
  },
  {
    id: 'ai-conversations',
    title: 'AI 会话',
    description: '会话运营与追溯',
    icon: 'chat',
    path: '/ai-ops/conversations',
    permissions: ['system:ai:conversation:list'],
  },
  {
    id: 'review-center',
    title: '统一审核',
    description: '数据与报告审核',
    icon: 'check',
    path: '/review-center/queue',
    permissions: ['system:review:list'],
  },
  {
    id: 'reports',
    title: '报告中心',
    description: '报告成果与模板',
    icon: 'file',
    path: '/reports',
    permissions: ['system:report:generate'],
  },
  {
    id: 'system-user',
    title: '用户管理',
    description: '用户与多端访问权限',
    icon: 'user',
    path: '/system/user',
    permissions: ['system:user:list'],
  },
]

export function projectQuickActions(
  definitions: readonly DashboardQuickAction[],
  canAccess: (permissions: readonly string[]) => boolean,
  canNavigate: (path: string) => boolean,
): DashboardQuickAction[] {
  return definitions.filter(definition =>
    canAccess(definition.permissions) && canNavigate(definition.path))
}

// ===== 最近报告（复用既有列表接口，不新增聚合 API） =====

/** 最近报告输入：平台报告成果聚合行的最小展示字段。 */
export interface RecentReportInput {
  id: string
  reportType: string
  status: string
  publishedAt: string | null
  updatedAt: string
  conversationTitle: string | null
  projectName: string
}

/** 多项目报告聚合：按更新时间倒序取最近 limit 条。 */
export function pickRecentReports<T extends RecentReportInput>(
  rows: readonly T[],
  limit = 6,
): T[] {
  return [...rows]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
}

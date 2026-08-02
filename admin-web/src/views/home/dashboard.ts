import type { MenuNavigationTarget, SidebarMenuItem } from '@/types/menu'

export interface DashboardShortcut {
  id: string
  title: string
  description: string
  path: string | null
  target: MenuNavigationTarget | null
  enabled: boolean
}

export function collectMenuLeaves(menus: readonly SidebarMenuItem[]): SidebarMenuItem[] {
  return menus.flatMap(menu => menu.children.length > 0
    ? collectMenuLeaves(menu.children)
    : [menu])
}

/** 从权限裁剪后的菜单投影真实可导航的快捷入口，不发明路由 */
export function projectAvailableShortcuts(
  menus: readonly SidebarMenuItem[],
  canNavigate: (path: string) => boolean,
): DashboardShortcut[] {
  const seenTargets = new Set<string>()

  return collectMenuLeaves(menus).flatMap((menu): DashboardShortcut[] => {
    const target = menu.target ?? (menu.path ? { kind: 'internal' as const, path: menu.path } : null)
    if (!target) {
      return []
    }

    if (target.kind === 'internal') {
      if (target.path === '/' || seenTargets.has(target.path) || !canNavigate(target.path)) {
        return []
      }
      seenTargets.add(target.path)
      return [{
        description: '进入已授权功能',
        enabled: true,
        id: menu.id,
        path: target.path,
        target,
        title: menu.title,
      }]
    }

    if (seenTargets.has(target.href)) {
      return []
    }
    seenTargets.add(target.href)
    return [{
      description: '在新窗口打开外部资源',
      enabled: true,
      id: menu.id,
      path: null,
      target,
      title: menu.title,
    }]
  })
}

export function limitShortcuts(
  shortcuts: readonly DashboardShortcut[],
  limit = 3,
): DashboardShortcut[] {
  return [...shortcuts].slice(0, limit)
}

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
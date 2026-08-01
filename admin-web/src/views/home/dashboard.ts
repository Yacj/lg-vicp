import type { SidebarMenuItem } from '@/types/menu'

export interface DashboardShortcut {
  id: string
  title: string
  description: string
  path: string | null
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
  const seenPaths = new Set<string>()

  return collectMenuLeaves(menus).flatMap((menu): DashboardShortcut[] => {
    if (!menu.path || menu.path === '/' || seenPaths.has(menu.path) || !canNavigate(menu.path)) {
      return []
    }

    seenPaths.add(menu.path)
    return [{
      id: menu.id,
      title: menu.title,
      description: '进入已授权功能',
      path: menu.path,
      enabled: true,
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
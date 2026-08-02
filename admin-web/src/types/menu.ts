export type BackendMenuType = 'BUTTON' | 'DIRECTORY' | 'MENU'

export interface BackendMenuNode {
  id: string
  parentId: string | null
  menuType: BackendMenuType
  name: string
  routePath: string | null
  component: string | null
  icon: string | null
  sortOrder: number
  isExternal: boolean
  visible: boolean
  permissionCode: string | null
  children: BackendMenuNode[]
}

export interface RouterMenuResult {
  routers: BackendMenuNode[]
  permissions: string[]
}

export type MenuNavigationTarget =
  | { kind: 'internal'; path: string }
  | { kind: 'external'; href: string }

export interface SidebarMenuItem {
  id: string
  title: string
  path: string | null
  target?: MenuNavigationTarget | null
  icon: string | null
  type: Exclude<BackendMenuType, 'BUTTON'>
  children: SidebarMenuItem[]
}

export type MenuProjectionIssueReason =
  | 'DUPLICATE_PATH'
  | 'DUPLICATE_ROUTE_NAME'
  | 'EXTERNAL_ROUTE'
  | 'INVALID_EXTERNAL_URL'
  | 'INVALID_PATH'
  | 'MISSING_COMPONENT'
  | 'MISSING_PATH'
  | 'UNKNOWN_COMPONENT'

export interface MenuProjectionIssue {
  menuId: string
  menuName: string
  component: string | null
  reason: MenuProjectionIssueReason
}
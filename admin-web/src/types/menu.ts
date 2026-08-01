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

export interface SidebarMenuItem {
  id: string
  title: string
  path: string | null
  icon: string | null
  type: Exclude<BackendMenuType, 'BUTTON'>
  children: SidebarMenuItem[]
}

export interface MenuProjectionIssue {
  menuId: string
  menuName: string
  component: string | null
  reason: 'EXTERNAL_ROUTE' | 'INVALID_PATH' | 'MISSING_COMPONENT' | 'UNKNOWN_COMPONENT'
}

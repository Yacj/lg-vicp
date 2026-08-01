import type { AuthClient, ChannelType, FixedUserRole } from './auth'

export type UserStatus = 'ACTIVE' | 'DISABLED'
export type DataScope = 'ALL' | 'CUSTOM' | 'DEPT' | 'DEPT_AND_CHILDREN' | 'PROJECT_OWNER' | 'SELF'

export interface CurrentUser {
  id: string
  displayName: string
  phone: string | null
  email: string | null
  role: FixedUserRole
  channelType: ChannelType | null
  status: UserStatus
  clientType: AuthClient
}

export interface UserDepartment {
  id: string
  code: string
  name: string
  isPrimary: boolean
}

export interface UserDataScope {
  roleCode: string
  dataScope: DataScope
  departmentIds?: string[]
}

export interface CurrentUserInfo {
  user: CurrentUser
  departments: UserDepartment[]
  permissions: string[]
  roles: string[]
  dataScopes: UserDataScope[]
}

export interface PermissionCapabilities {
  canCreateProject: boolean
  canReadPublicProjects: boolean
  canManagePlatform: boolean
}

export interface CurrentPermissionInfo {
  user: CurrentUser
  roles: string[]
  permissions: string[]
  capabilities: PermissionCapabilities
}

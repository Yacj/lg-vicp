import type { PageQuery } from './api'

export interface SystemRecord {
  id: string
  createdAt: string
  updatedAt: string
}

export interface SystemDepartment extends SystemRecord {
  parentId: string | null
  code: string
  name: string
  leader: string | null
  phone: string | null
  email: string | null
  sortOrder: number
  enabled: boolean
  deletedAt: string | null
}

export interface SystemDepartmentTreeNode extends SystemDepartment {
  children: SystemDepartmentTreeNode[]
}

export interface CreateSystemDepartmentInput {
  parentId?: string | null
  code: string
  name: string
  sortOrder: number
  enabled: boolean
}

export interface UpdateSystemDepartmentInput {
  parentId?: string | null
  code?: string
  name?: string
  leader?: string | null
  phone?: string | null
  email?: string | null
  sortOrder?: number
  enabled?: boolean
}

export interface SystemPost extends SystemRecord {
  name: string
  code: string
  sortOrder: number
  enabled: boolean
  remark: string | null
}

export interface SystemPostInput {
  name: string
  code: string
  sortOrder: number
  enabled: boolean
  remark?: string | null
}

export type SystemPostPageQuery = PageQuery

export interface SystemDictionary extends SystemRecord {
  code: string
  name: string
  description: string | null
  enabled: boolean
}

export interface CreateSystemDictionaryInput {
  code: string
  name: string
  description?: string
  enabled: boolean
}

export interface UpdateSystemDictionaryInput {
  name?: string
  description?: string | null
  enabled?: boolean
}

export interface SystemDictionaryItem extends SystemRecord {
  dictionaryId: string
  value: string
  label: string
  sortOrder: number
  enabled: boolean
  metadata: Record<string, unknown> | null
}

export interface SystemMenu extends SystemRecord {
  parentId: string | null
  menuType: SystemMenuType
  name: string
  routePath: string | null
  component: string | null
  icon: string | null
  sortOrder: number
  isExternal: boolean
  visible: boolean
  enabled: boolean
  permissionCode: string | null
}

export type SystemMenuType = 'DIRECTORY' | 'MENU' | 'BUTTON'

export interface SystemMenuTreeNode extends SystemMenu {
  children: SystemMenuTreeNode[]
}

export interface SystemPermissionResource extends SystemRecord {
  code: string
  name: string
  resource: string
  action: string
  description: string | null
}

export interface SystemMenuInput {
  parentId: string | null
  menuType: SystemMenuType
  name: string
  routePath: string | null
  component: string | null
  icon: string | null
  sortOrder: number
  isExternal: boolean
  visible: boolean
  enabled: boolean
  permissionCode: string | null
}

export type CreateSystemMenuInput = SystemMenuInput
export type UpdateSystemMenuInput = Partial<SystemMenuInput>


export interface SystemDictionaryItemInput {
  value: string
  label: string
  sortOrder: number
  enabled: boolean
  metadata?: Record<string, unknown>
}

export type SystemUserStatus = 'ACTIVE' | 'DISABLED'
export type SystemUserRole = 'SUPER_ADMIN' | 'CHANNEL_USER' | 'NORMAL_USER'
export type SystemUserGender = 'UNKNOWN' | 'MALE' | 'FEMALE'
export type SystemChannelType = 'DEALER' | 'SALESPERSON'
/** 端访问身份，对齐后端 APP_CODES。与登录端 AUTH_CLIENTS 正交。 */
export type SystemAppCode = 'ADMIN' | 'CLIENT'
export type SystemAppRole = 'SUPER_ADMIN' | 'NORMAL_USER'
export type SystemAppAccessStatus = 'ACTIVE' | 'DISABLED'
export type SystemIdentityType = 'USERNAME' | 'PHONE' | 'WECHAT' | 'WECHAT_OPENID' | 'WECHAT_UNIONID'

/** GET /platform/users 与详情返回的分端访问；同一 User 可同时拥有 ADMIN 与 CLIENT。 */
export interface UserAppAccessPublic {
  app: SystemAppCode
  role: SystemAppRole
  status: SystemAppAccessStatus
}

/** 登录身份公开投影。详情接口未返回时按手机号等字段回退，不把身份类型当成账号类型。 */
export interface SystemUserIdentityPublic {
  type: SystemIdentityType
  identifier?: string | null
  hasPassword?: boolean
}

/**
 * 角色数据范围枚举，严格对齐后端 data_scope 枚举
 * （见 backend/src/db/schema.ts 的 dataScopeEnum）。
 */
export type SystemDataScope = 'ALL' | 'DEPT' | 'DEPT_AND_CHILDREN' | 'SELF' | 'CUSTOM' | 'PROJECT_OWNER'

export interface SystemRole extends SystemRecord {
  code: string
  name: string
  description: string | null
  dataScope: SystemDataScope
  enabled: boolean
}

export interface SystemRoleInput {
  code: string
  name: string
  description?: string
  dataScope: SystemDataScope
  enabled: boolean
  /** 创建时一次性分配的权限 ID（后端 POST /roles 支持）。 */
  permissionIds?: string[]
}

export type UpdateSystemRoleInput = Partial<Pick<SystemRoleInput, 'name' | 'description' | 'dataScope' | 'enabled' | 'permissionIds'>>

export interface RoleMutationResult extends MutationMessage {
  role: SystemRole
}

export interface RolePageQuery extends PageQuery {
  keyword?: string
  status?: SystemUserStatus
}

export interface SystemRoleUser extends SystemRecord {
  displayName: string
  phone: string | null
  status: SystemUserStatus
}

export interface RolePermissionMutationResult extends MutationMessage {
  permissionIds?: string[]
}

/** 角色已分配权限回显（GET /roles/:id/permissions）。 */
export interface RolePermissionIdsResult {
  permissionIds: string[]
}

/** 角色自定义部门回显（GET /roles/:id/departments）。 */
export interface RoleDepartmentIdsResult {
  departmentIds: string[]
}

export interface SystemDepartmentMember extends SystemRecord {
  /** 登录账号（后端从 user_identities 取最早一条 identifier）。 */
  loginIdentifier: string | null
  phone: string | null
  email: string | null
  displayName: string
  gender: SystemUserGender
  remark: string | null
  role: SystemUserRole
  channelType: SystemChannelType | null
  /** 是否允许登录 B 端管理后台；仅普通用户可能为 false。兼容字段，分端真源是 appAccess。 */
  adminLoginEnabled: boolean
  status: SystemUserStatus
  deletedAt: string | null
  /** 最近登录时间；后端未返回时不展示。 */
  lastLoginAt?: string | null
  /** 分端访问；列表与详情接口均返回。缺省时按 users.role 回退。 */
  appAccess?: UserAppAccessPublic[]
  /** 登录身份；详情接口未返回时不展示微信/密码细节。 */
  identities?: SystemUserIdentityPublic[]
}

/** GET /platform/departments/:id/members 单项，与用户列表结构不同。 */
export interface DepartmentMemberItem {
  userId: string
  displayName: string
  phone: string | null
  role: SystemUserRole
  status: SystemUserStatus
  isPrimary: boolean
  joinedAt: string
}

export interface AddDepartmentMemberInput {
  userId: string
  isPrimary?: boolean
}

export interface DepartmentMemberMutationResult extends MutationMessage {
  member: {
    userId: string
    departmentId: string
    isPrimary: boolean
  }
}

export interface SystemDepartmentMemberQuery extends PageQuery {
  departmentId: string
  keyword?: string
  status?: SystemUserStatus
  includeDeleted?: boolean
}

/**
 * 平台用户分页查询，对齐后端 /platform/users 的 listQuerySchema。
 * 访问端筛选映射到已有 role 参数，不另造 app 查询字段。
 */
export interface SystemUserQuery extends PageQuery {
  keyword?: string
  departmentId?: string
  roleId?: string
  role?: SystemUserRole
  status?: SystemUserStatus
  includeDeleted?: boolean
}

export interface SystemUserRoleBrief {
  id: string
  name: string
  code: string
}

export interface SystemUserDetail {
  user: SystemDepartmentMember
  departments: Array<{ id: string; isPrimary: boolean }>
  posts: SystemUserRoleBrief[]
  roles: SystemUserRoleBrief[]
  /** 登录身份；与 GET /users/:id 现有字段并列，后端未返回时按 user 字段回退。 */
  identities?: SystemUserIdentityPublic[]
  /** 名下项目数量；后端未返回时不展示。 */
  projectCount?: number
}

/** 创建用户及其组织/动态角色配置；后端在同一事务中保存。 */
export interface CreateSystemUserInput {
  identifier: string
  password: string
  displayName: string
  gender: SystemUserGender
  email?: string
  remark?: string
  role: SystemUserRole
  channelType?: SystemChannelType | null
  adminLoginEnabled?: boolean
  phone?: string
  status?: SystemUserStatus
  departmentIds?: string[]
  postIds?: string[]
  roleIds?: string[]
}

/** 编辑用户资料及可选的组织/动态角色配置；同一次提交在后端事务中保存。 */
export interface UpdateSystemUserInput {
  displayName?: string
  gender?: SystemUserGender
  email?: string | null
  remark?: string | null
  role?: SystemUserRole
  channelType?: SystemChannelType | null
  adminLoginEnabled?: boolean
  phone?: string | null
  status?: SystemUserStatus
  departmentIds?: string[]
  postIds?: string[]
  roleIds?: string[]
}

export interface UserMutationResult extends MutationMessage {
  user: SystemDepartmentMember
}

export interface UserImportRowError {
  row: number
  message: string
}

/** 导入结果：imported 为成功行数，errors 为失败行明细（行号从 2 开始）。 */
export interface UserImportResult extends MutationMessage {
  imported: number
  errors: UserImportRowError[]
  dryRun: boolean
}

export interface ItemListResult<T> {
  items: T[]
}

export interface MutationMessage {
  message: string
}

export interface DepartmentMutationResult extends MutationMessage {
  department: SystemDepartment
}

export interface PostMutationResult extends MutationMessage {
  post: SystemPost
}

export interface DictionaryMutationResult extends MutationMessage {
  dictionary: SystemDictionary
}

export interface DictionaryItemMutationResult extends MutationMessage {
  item: SystemDictionaryItem
}

export interface MenuMutationResult extends MutationMessage {
  menu: SystemMenu
}

export interface PermissionResourceListResult {
  items: SystemPermissionResource[]
}


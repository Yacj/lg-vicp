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

export type UpdateSystemRoleInput = Partial<Pick<SystemRoleInput, 'name' | 'description' | 'dataScope' | 'enabled'>>

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
  phone: string | null
  email: string | null
  displayName: string
  gender: SystemUserGender
  remark: string | null
  role: SystemUserRole
  channelType: SystemChannelType | null
  status: SystemUserStatus
  deletedAt: string | null
}

export interface SystemDepartmentMemberQuery extends PageQuery {
  departmentId: string
  keyword?: string
  status?: SystemUserStatus
  includeDeleted?: boolean
}

/**
 * 平台用户分页查询，对齐后端 /platform/users 的 listQuerySchema。
 * 后端不支持账号类型（role）与渠道类型（channelType）筛选参数。
 */
export interface SystemUserQuery extends PageQuery {
  keyword?: string
  departmentId?: string
  roleId?: string
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
}

/** 创建用户：identifier 为用户名或手机号，后端按格式自动识别；role/channelType 组合有服务端校验。 */
export interface CreateSystemUserInput {
  identifier: string
  password: string
  displayName: string
  gender: SystemUserGender
  email?: string
  remark?: string
  role: SystemUserRole
  channelType?: SystemChannelType | null
}

/** 编辑用户：后端仅允许更新资料字段；部门/岗位/角色通过独立分配接口维护。 */
export interface UpdateSystemUserInput {
  displayName?: string
  gender?: SystemUserGender
  email?: string | null
  remark?: string | null
  role?: SystemUserRole
  channelType?: SystemChannelType | null
  phone?: string | null
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


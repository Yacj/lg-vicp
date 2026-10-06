import type {
  SystemAppCode,
  SystemChannelType,
  SystemIdentityType,
  SystemUserGender,
  SystemUserIdentityPublic,
  SystemUserRole,
  SystemUserStatus,
  UserAppAccessPublic,
} from '@/types/system-management'

/**
 * 账号类型是 users.role 的固定业务枚举（后端 user_role 枚举），
 * 与可动态创建的权限角色（roles 表）相互独立，不要混用。
 * 用户列表的展示真源是 appAccess，不再把 role 当成账号类型列。
 */
export const userRoleLabels: Record<SystemUserRole, string> = {
  CHANNEL_USER: '渠道用户',
  NORMAL_USER: '普通用户',
  SUPER_ADMIN: '超级管理员',
}

/** TDesign 选项数据；账号类型与权限角色相互独立，不要混用。 */
export const userRoleOptions: Array<{ label: string; value: SystemUserRole }> = [
  { label: userRoleLabels.SUPER_ADMIN, value: 'SUPER_ADMIN' },
  { label: userRoleLabels.CHANNEL_USER, value: 'CHANNEL_USER' },
  { label: userRoleLabels.NORMAL_USER, value: 'NORMAL_USER' },
]

/**
 * 按操作者角色投影可分配的账号类型：
 * 仅超级管理员可创建/编辑超级管理员，其余操作者不出现 SUPER_ADMIN 选项。
 */
export function userRoleOptionsFor(
  actorRole: SystemUserRole,
): Array<{ label: string; value: SystemUserRole }> {
  return actorRole === 'SUPER_ADMIN'
    ? userRoleOptions
    : userRoleOptions.filter(option => option.value !== 'SUPER_ADMIN')
}

/** 渠道类型仅对渠道用户有意义，非渠道用户后端强制为 null。 */
export const channelTypeLabels: Record<SystemChannelType, string> = {
  DEALER: '经销商',
  SALESPERSON: '业务员',
}

export const channelTypeOptions: Array<{ label: string; value: SystemChannelType }> = [
  { label: channelTypeLabels.DEALER, value: 'DEALER' },
  { label: channelTypeLabels.SALESPERSON, value: 'SALESPERSON' },
]

export const userGenderLabels: Record<SystemUserGender, string> = {
  FEMALE: '女',
  MALE: '男',
  UNKNOWN: '未知',
}

export const userGenderOptions: Array<{ label: string; value: SystemUserGender }> = [
  { label: userGenderLabels.UNKNOWN, value: 'UNKNOWN' },
  { label: userGenderLabels.MALE, value: 'MALE' },
  { label: userGenderLabels.FEMALE, value: 'FEMALE' },
]

export const userStatusLabels: Record<SystemUserStatus, string> = {
  ACTIVE: '正常',
  DISABLED: '已禁用',
}

export function isChannelUserRole(role: SystemUserRole): boolean {
  return role === 'CHANNEL_USER'
}

export function isNormalUserRole(role: SystemUserRole): boolean {
  return role === 'NORMAL_USER'
}

/** C 端注册用户：普通用户与渠道用户，不是 B 端登录入口。 */
export function isCEndUserRole(role: SystemUserRole): boolean {
  return role === 'NORMAL_USER' || role === 'CHANNEL_USER'
}

export function isSuperAdminRole(role: SystemUserRole): boolean {
  return role === 'SUPER_ADMIN'
}

/** 用户管理页的用户类型筛选，不含超级管理员。 */
export const cEndUserTypeOptions: Array<{ label: string, value: SystemUserRole }> = [
  { label: userRoleLabels.NORMAL_USER, value: 'NORMAL_USER' },
  { label: userRoleLabels.CHANNEL_USER, value: 'CHANNEL_USER' },
]

export type UserAccessAppFilter = 'all' | SystemAppCode

export const appCodeLabels: Record<SystemAppCode, string> = {
  ADMIN: '管理后台',
  CLIENT: '客户端',
}

export const appRoleLabels: Record<'SUPER_ADMIN' | 'NORMAL_USER', string> = {
  NORMAL_USER: '普通用户',
  SUPER_ADMIN: '超级管理员',
}

/** 访问端筛选：全部 / 管理后台 / 客户端。不出现「微信用户」「手机号用户」。 */
export const accessAppFilterOptions: Array<{ label: string, value: UserAccessAppFilter }> = [
  { label: '全部', value: 'all' },
  { label: appCodeLabels.ADMIN, value: 'ADMIN' },
  { label: appCodeLabels.CLIENT, value: 'CLIENT' },
]

/**
 * 访问端筛选映射到后端已有 role 参数。
 * ADMIN → SUPER_ADMIN；CLIENT → NORMAL_USER；双端用户 role 仍为 SUPER_ADMIN，
 * 会出现在「全部」与「管理后台」，列表 Tag 仍可同时显示两端。
 */
export function accessAppToRoleFilter(accessApp: UserAccessAppFilter): SystemUserRole | undefined {
  if (accessApp === 'ADMIN') {
    return 'SUPER_ADMIN'
  }
  if (accessApp === 'CLIENT') {
    return 'NORMAL_USER'
  }
  return undefined
}

export interface UserAccessSource {
  role: SystemUserRole
  appAccess?: readonly UserAppAccessPublic[] | null
}

function fallbackAppAccess(role: SystemUserRole): UserAppAccessPublic[] {
  if (role === 'SUPER_ADMIN') {
    return [{ app: 'ADMIN', role: 'SUPER_ADMIN', status: 'ACTIVE' }]
  }
  return [{ app: 'CLIENT', role: 'NORMAL_USER', status: 'ACTIVE' }]
}

/** 分端访问真源；缺省时按 users.role 兼容回退，不把登录方式当成账号类型。 */
export function resolveAppAccess(user: UserAccessSource): UserAppAccessPublic[] {
  if (user.appAccess && user.appAccess.length > 0) {
    return [...user.appAccess]
  }
  return fallbackAppAccess(user.role)
}

export function hasAppAccess(user: UserAccessSource, app: SystemAppCode): boolean {
  return resolveAppAccess(user).some(item => item.app === app)
}

export function hasAdminAccess(user: UserAccessSource): boolean {
  return hasAppAccess(user, 'ADMIN')
}

/** 仅 CLIENT、无 ADMIN：C 端普通用户，不可在 B 端改资料或提升为管理员。 */
export function isClientOnlyUser(user: UserAccessSource): boolean {
  return hasAppAccess(user, 'CLIENT') && !hasAppAccess(user, 'ADMIN')
}

export interface UserAccessTag {
  app: SystemAppCode
  label: string
}

/** 列表访问权限 Tag，ADMIN 在前；同一用户可同时显示两个。 */
export function accessTagsForUser(user: UserAccessSource): UserAccessTag[] {
  const tags: UserAccessTag[] = []
  if (hasAppAccess(user, 'ADMIN')) {
    tags.push({ app: 'ADMIN', label: appCodeLabels.ADMIN })
  }
  if (hasAppAccess(user, 'CLIENT')) {
    tags.push({ app: 'CLIENT', label: appCodeLabels.CLIENT })
  }
  return tags
}

export interface UserAccessDetailRow {
  app: SystemAppCode
  label: string
  roleLabel: string
  opened: boolean
  statusLabel: '已开通' | '未开通'
}

/** 详情：管理后台固定超级管理员，客户端固定普通用户。 */
export function accessDetailRowsForUser(user: UserAccessSource): UserAccessDetailRow[] {
  const access = resolveAppAccess(user)
  const admin = access.find(item => item.app === 'ADMIN')
  const client = access.find(item => item.app === 'CLIENT')
  return [
    {
      app: 'ADMIN',
      label: appCodeLabels.ADMIN,
      opened: Boolean(admin),
      roleLabel: appRoleLabels.SUPER_ADMIN,
      statusLabel: admin ? '已开通' : '未开通',
    },
    {
      app: 'CLIENT',
      label: appCodeLabels.CLIENT,
      opened: Boolean(client),
      roleLabel: appRoleLabels.NORMAL_USER,
      statusLabel: client ? '已开通' : '未开通',
    },
  ]
}

export type LoginMethodKey = 'phone' | 'wechat' | 'password'

export interface LoginMethodView {
  key: LoginMethodKey
  label: string
  /** true 已绑定/已设置，false 未绑定/未设置，null 接口未返回时不臆造。 */
  bound: boolean | null
  value: string
}

function isWechatIdentityType(type: SystemIdentityType): boolean {
  return type === 'WECHAT' || type === 'WECHAT_OPENID' || type === 'WECHAT_UNIONID'
}

function isPasswordIdentityType(type: SystemIdentityType): boolean {
  return type === 'USERNAME' || type === 'PHONE'
}

export interface LoginMethodSource {
  phone: string | null
  loginIdentifier: string | null
  role: SystemUserRole
  identities?: readonly SystemUserIdentityPublic[] | null
}

function unknownMethodValue(): string {
  return '—'
}

/** 登录方式与访问权限分开展示：手机号 / 微信小程序 / 密码，不是账号类型。 */
export function projectLoginMethods(source: LoginMethodSource): LoginMethodView[] {
  const identities = source.identities ?? []
  const hasIdentities = identities.length > 0

  const phoneIdentity = identities.find(item => item.type === 'PHONE')
  const phoneBound = hasIdentities ? Boolean(phoneIdentity) || Boolean(source.phone) : Boolean(source.phone)
  const phoneValue = source.phone?.trim() || phoneIdentity?.identifier?.trim() || ''

  const wechatBound = hasIdentities
    ? identities.some(item => isWechatIdentityType(item.type))
    : null

  const passwordIdentities = identities.filter(item => isPasswordIdentityType(item.type))
  let passwordBound: boolean | null
  if (hasIdentities) {
    if (passwordIdentities.some(item => item.hasPassword === true)) {
      passwordBound = true
    }
    else if (passwordIdentities.length > 0 && passwordIdentities.every(item => item.hasPassword === false)) {
      passwordBound = false
    }
    else if (passwordIdentities.length > 0) {
      passwordBound = source.role === 'SUPER_ADMIN' ? true : null
    }
    else {
      passwordBound = false
    }
  }
  else if (source.role === 'SUPER_ADMIN' && source.loginIdentifier) {
    passwordBound = true
  }
  else {
    passwordBound = null
  }

  return [
    {
      bound: phoneBound,
      key: 'phone',
      label: '手机号',
      value: phoneBound && phoneValue ? phoneValue : (phoneBound ? '已绑定' : '未绑定'),
    },
    {
      bound: wechatBound,
      key: 'wechat',
      label: '微信小程序',
      value: wechatBound == null ? unknownMethodValue() : (wechatBound ? '已绑定' : '未绑定'),
    },
    {
      bound: passwordBound,
      key: 'password',
      label: '密码',
      value: passwordBound == null ? unknownMethodValue() : (passwordBound ? '已设置' : '未设置'),
    },
  ]
}

export const USER_DISABLE_BOTH_ENDS_HINT = '禁用后该用户将无法登录管理后台和客户端。'

/** 资料编辑仅管理后台身份可在 B 端进行；CLIENT-only 资料由 C 端维护。 */
export function canEditManagedUserProfile(user: UserAccessSource): boolean {
  return hasAdminAccess(user)
}

/** 重置密码仅对已开通管理后台的用户开放。 */
export function canResetManagedUserPassword(user: UserAccessSource): boolean {
  return hasAdminAccess(user)
}

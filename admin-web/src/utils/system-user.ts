import type {
  SystemChannelType,
  SystemUserGender,
  SystemUserRole,
  SystemUserStatus,
} from '@/types/system-management'

/**
 * 账号类型是 users.role 的固定业务枚举（后端 user_role 枚举），
 * 与可动态创建的权限角色（roles 表）相互独立，不要混用。
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
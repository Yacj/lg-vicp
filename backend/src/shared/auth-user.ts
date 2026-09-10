import type { AUTH_CLIENTS, CHANNEL_TYPES, USER_ROLES } from "./constants.js";

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];
export type ChannelType = (typeof CHANNEL_TYPES)[keyof typeof CHANNEL_TYPES] | null;
export type AuthClient = (typeof AUTH_CLIENTS)[keyof typeof AUTH_CLIENTS];

export interface AuthUser {
  id: string;
  role: UserRole;
  channelType: ChannelType;
  /** 是否允许登录 B 端管理后台；仅普通用户可能为 false。 */
  adminLoginEnabled: boolean;
  clientType: AuthClient;
  permissionCodes?: string[];
  /** 生效的数据范围；由动态角色权限计算后写入当前请求。 */
  dataScope?: string;
  departmentIds?: string[];
  /** 预计算的统一登录账号数据范围；null 表示全量。 */
  accessibleUserIds?: string[] | null;
}

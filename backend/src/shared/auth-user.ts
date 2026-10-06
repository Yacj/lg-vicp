import type { APP_ACCESS_STATUSES, APP_CODES, APP_ROLES, AUTH_CLIENTS, CHANNEL_TYPES, TOKEN_AUDIENCES, USER_ROLES } from "./constants.js";

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];
export type ChannelType = (typeof CHANNEL_TYPES)[keyof typeof CHANNEL_TYPES] | null;
export type AuthClient = (typeof AUTH_CLIENTS)[keyof typeof AUTH_CLIENTS];
export type AppCode = (typeof APP_CODES)[keyof typeof APP_CODES];
export type AppRole = (typeof APP_ROLES)[keyof typeof APP_ROLES];
export type AppAccessStatus = (typeof APP_ACCESS_STATUSES)[keyof typeof APP_ACCESS_STATUSES];
export type TokenAudience = (typeof TOKEN_AUDIENCES)[keyof typeof TOKEN_AUDIENCES];

export interface UserAppAccessPublic {
  app: AppCode;
  role: AppRole;
  status: AppAccessStatus;
}

export interface AuthUser {
  id: string;
  role: UserRole;
  channelType: ChannelType;
  /** 是否允许登录 B 端管理后台；仅普通用户可能为 false。 */
  adminLoginEnabled: boolean;
  clientType: AuthClient;
  /** JWT aud：admin=B 端，client=C / PC AI 端。 */
  audience?: TokenAudience;
  /** 当前令牌对应的端访问。 */
  app?: AppCode;
  permissionCodes?: string[];
  /** 生效的数据范围；由动态角色权限计算后写入当前请求。 */
  dataScope?: string;
  departmentIds?: string[];
  /** 所属部门及其祖先，用于 DEPARTMENT 可见性（含子部门）。 */
  departmentScopeIds?: string[];
  /** 预计算的统一登录账号数据范围；null 表示全量。 */
  accessibleUserIds?: string[] | null;
}

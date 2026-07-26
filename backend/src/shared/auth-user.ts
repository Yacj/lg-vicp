import type { AUTH_CLIENTS, CHANNEL_TYPES, USER_ROLES } from "./constants.js";

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];
export type ChannelType = (typeof CHANNEL_TYPES)[keyof typeof CHANNEL_TYPES] | null;
export type AuthClient = (typeof AUTH_CLIENTS)[keyof typeof AUTH_CLIENTS];

export interface AuthUser {
  id: string;
  role: UserRole;
  channelType: ChannelType;
  clientType: AuthClient;
  permissionCodes?: string[];
}

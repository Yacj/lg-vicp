import type { Project } from "../db/schema.js";
import type { AuthUser } from "./auth-user.js";
import { AUTH_CLIENTS, PROJECT_VISIBILITY, USER_ROLES } from "./constants.js";

const projectCreationClients = new Set([
  AUTH_CLIENTS.B_ADMIN,
  AUTH_CLIENTS.C_APP,
  AUTH_CLIENTS.PC_AI
]);

export function isSuperAdmin(user: AuthUser): boolean {
  return user.role === USER_ROLES.SUPER_ADMIN;
}

export function isChannelUser(user: AuthUser): boolean {
  return user.role === USER_ROLES.CHANNEL_USER;
}

export function canCreateProject(user: AuthUser): boolean {
  return isChannelUser(user) || isSuperAdmin(user);
}

export function canCreateProjectFromClient(user: AuthUser): boolean {
  return projectCreationClients.has(user.clientType) && canCreateProject(user);
}

export function canViewProject(user: AuthUser, project: Pick<Project, "createdById" | "visibility">): boolean {
  if (isSuperAdmin(user)) return true;
  // 私有项目只对创建者开放；公开项目对所有已认证账号可读。
  return project.createdById === user.id || project.visibility === PROJECT_VISIBILITY.PUBLIC;
}

export function canManageProject(user: AuthUser, project: Pick<Project, "createdById">): boolean {
  return isSuperAdmin(user) || project.createdById === user.id;
}

import type { Project } from "../db/schema.js";
import type { AuthUser } from "./auth-user.js";
import { AUTH_CLIENTS, PROJECT_VISIBILITY, USER_ROLES } from "./constants.js";
import { isDepartmentVisibleToUser } from "./department-tree.js";

export type ProjectVisibilityFields = Pick<Project, "createdById" | "visibility"> & {
  visibleDepartmentId?: string | null;
  includeChildDepartments?: boolean | null;
};

export function isSuperAdmin(user: AuthUser): boolean {
  return user.role === USER_ROLES.SUPER_ADMIN;
}

export function isChannelUser(user: AuthUser): boolean {
  return user.role === USER_ROLES.CHANNEL_USER;
}

export function isNormalUser(user: AuthUser): boolean {
  return user.role === USER_ROLES.NORMAL_USER;
}

/** P0：仅 C 端 / PC AI 端普通用户可新建项目；B 端超级管理员不能新增。渠道入口隐藏。 */
export function canCreateProject(user: AuthUser): boolean {
  return isNormalUser(user);
}

export function canCreateProjectFromClient(user: AuthUser): boolean {
  return (user.clientType === AUTH_CLIENTS.C_APP || user.clientType === AUTH_CLIENTS.PC_AI) && canCreateProject(user);
}

export function canViewProject(user: AuthUser, project: ProjectVisibilityFields): boolean {
  if (isSuperAdmin(user) && user.clientType === AUTH_CLIENTS.B_ADMIN) return true;
  if (project.createdById === user.id) return true;
  if (project.visibility === PROJECT_VISIBILITY.PRIVATE) return false;
  if (project.visibility === PROJECT_VISIBILITY.PUBLIC) return true;
  if (project.visibility === PROJECT_VISIBILITY.DEPARTMENT) {
    return isDepartmentVisibleToUser({
      visibleDepartmentId: project.visibleDepartmentId,
      includeChildDepartments: project.includeChildDepartments !== false,
      userDepartmentIds: user.departmentIds ?? [],
      userDepartmentScopeIds: user.departmentScopeIds ?? user.departmentIds ?? []
    });
  }
  return false;
}

/** 编辑项目信息 / 可见性：仅创建者。B 端超级管理员不能改他人项目内容。 */
export function canEditProject(user: AuthUser, project: Pick<Project, "createdById">): boolean {
  return project.createdById === user.id;
}

/** 删除项目：创建者或 B 端超级管理员。 */
export function canDeleteProject(user: AuthUser, project: Pick<Project, "createdById">): boolean {
  return project.createdById === user.id || (isSuperAdmin(user) && user.clientType === AUTH_CLIENTS.B_ADMIN);
}

/** 管理（删文件等）：创建者，或 B 端超级管理员。C 端令牌上的超级管理员不能绕过归属。 */
export function canManageProject(user: AuthUser, project: Pick<Project, "createdById">): boolean {
  return project.createdById === user.id || (isSuperAdmin(user) && user.clientType === AUTH_CLIENTS.B_ADMIN);
}

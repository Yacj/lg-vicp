import type { Project } from "../db/schema.js";
import type { AuthUser } from "./auth-user.js";
import { PROJECT_VISIBILITY, USER_ROLES } from "./constants.js";

export function isSuperAdmin(user: AuthUser): boolean {
  return user.role === USER_ROLES.SUPER_ADMIN;
}

export function isChannelUser(user: AuthUser): boolean {
  return user.role === USER_ROLES.CHANNEL_USER;
}

export function canCreateProject(user: AuthUser): boolean {
  return isChannelUser(user) || isSuperAdmin(user);
}

export function canViewProject(user: AuthUser, project: Pick<Project, "createdById" | "visibility">): boolean {
  if (isSuperAdmin(user)) {
    return true;
  }

  if (project.createdById === user.id) {
    return true;
  }

  return project.visibility === PROJECT_VISIBILITY.PUBLIC;
}

export function canManageProject(user: AuthUser, project: Pick<Project, "createdById">): boolean {
  return isSuperAdmin(user) || project.createdById === user.id;
}

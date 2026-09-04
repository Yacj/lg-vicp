import type { AuthUser } from "../../shared/auth-user.js";
import { canManageProject, canViewProject } from "../../shared/permissions.js";
import type { FileRecord } from "../../db/schema.js";

export function canAccessSourceFile(user: AuthUser, file: Pick<FileRecord, "ownerUserId">): boolean {
  return user.role === "SUPER_ADMIN" || file.ownerUserId === user.id;
}

/** 项目资料与项目详情保持一致：公开项目的资料对 C/PC 登录用户可读，B 端遵循项目范围。 */
export function canReadProjectFile(
  user: AuthUser,
  file: Pick<FileRecord, "ownerUserId" | "projectId">,
  project?: { id: string; createdById: string; visibility: "PUBLIC" | "PRIVATE" },
): boolean {
  if (!file.projectId || !project || project.id !== file.projectId) return false;
  return canViewProject(user, project);
}

export function canDeleteProjectFile(user: AuthUser, file: Pick<FileRecord, "ownerUserId" | "projectId">, project?: { id: string; createdById: string; visibility: "PUBLIC" | "PRIVATE" }): boolean {
  if (!file.projectId) return canAccessSourceFile(user, file);
  return Boolean(project && file.projectId === project.id && canManageProject(user, project));
}

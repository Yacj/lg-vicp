import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { departments, permissions, posts, roleDepartments, rolePermissions, roles, userDepartments, users } from "../db/schema.js";
import type { AuthUser } from "./auth-user.js";
import { getPermissionCodes, getRoleScopes } from "../modules/menus/menu.service.js";
import { ForbiddenError, NotFoundError } from "./errors.js";

const BUILT_IN_ROLE_CODES = new Set(["platform_admin", "channel_operator", "normal_user"]);
export type DataScope = "ALL" | "DEPT" | "DEPT_AND_CHILDREN" | "SELF" | "CUSTOM" | "PROJECT_OWNER";

export function assertCanModifyRoleDefinition(actor: AuthUser, roleCode: string): void {
  if (actor.role !== "SUPER_ADMIN" && BUILT_IN_ROLE_CODES.has(roleCode)) {
    throw new ForbiddenError("只有超级管理员可以修改内置角色");
  }
}

function scopeCovers(actorScope: DataScope, targetScope: DataScope): boolean {
  if (actorScope === "ALL" || targetScope === "SELF" || actorScope === targetScope) return true;
  if (actorScope === "DEPT_AND_CHILDREN" && targetScope === "DEPT") return true;
  return false;
}

async function activeDepartmentRows(app: FastifyInstance) {
  return app.db.select({ id: departments.id, parentId: departments.parentId })
    .from(departments)
    .where(isNull(departments.deletedAt))
    .orderBy(asc(departments.createdAt));
}

function expandDepartmentIds(rows: readonly { id: string; parentId: string | null }[], roots: readonly string[], descendants: boolean) {
  const result = new Set(roots);
  if (!descendants) return result;
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (row.parentId && result.has(row.parentId) && !result.has(row.id)) {
        result.add(row.id);
        changed = true;
      }
    }
  }
  return result;
}

/** 判断部门是否落在操作者的有效角色数据范围内。 */
export async function getDepartmentIdsWithinActor(app: FastifyInstance, actor: AuthUser): Promise<Set<string> | null> {
  if (actor.role === "SUPER_ADMIN") return null;
  const scopes = await getRoleScopes(app, actor);
  if (scopes.some((scope) => scope.dataScope === "ALL")) return null;
  const rows = await activeDepartmentRows(app);
  const allowed = new Set<string>();
  for (const scope of scopes) {
    if (scope.dataScope === "DEPT" || scope.dataScope === "DEPT_AND_CHILDREN") {
      for (const id of expandDepartmentIds(rows, actor.departmentIds ?? [], scope.dataScope === "DEPT_AND_CHILDREN")) allowed.add(id);
    } else if (scope.dataScope === "CUSTOM") {
      for (const id of (scope as { departmentIds?: string[] }).departmentIds ?? []) allowed.add(id);
    }
  }
  return allowed;
}

export async function assertDepartmentIdsWithinActor(app: FastifyInstance, actor: AuthUser, departmentIds: readonly string[]): Promise<void> {
  if (actor.role === "SUPER_ADMIN" || departmentIds.length === 0) return;
  const uniqueIds = [...new Set(departmentIds)];
  const existing = await app.db.select({ id: departments.id }).from(departments)
    .where(and(inArray(departments.id, uniqueIds), isNull(departments.deletedAt)));
  if (existing.length !== uniqueIds.length) throw new NotFoundError("部分部门不存在或已删除");
  const allowed = await getDepartmentIdsWithinActor(app, actor);
  if (allowed === null) return;
  if (uniqueIds.some((id) => !allowed.has(id))) {
    throw new ForbiddenError("不能将用户绑定到当前账号范围外的部门");
  }
}

export async function assertDepartmentInActorScope(app: FastifyInstance, actor: AuthUser, departmentId: string | null | undefined): Promise<void> {
  if (!departmentId || actor.role === "SUPER_ADMIN") return;
  await assertDepartmentIdsWithinActor(app, actor, [departmentId]);
}

export async function assertDepartmentParentChange(
  app: FastifyInstance,
  actor: AuthUser,
  departmentId: string,
  parentId: string | null | undefined,
): Promise<void> {
  const [department] = await app.db.select({ id: departments.id }).from(departments)
    .where(and(eq(departments.id, departmentId), isNull(departments.deletedAt))).limit(1);
  if (!department) throw new NotFoundError("部门不存在");
  await assertDepartmentInActorScope(app, actor, department.id);
  if (!parentId) return;
  if (parentId === departmentId) throw new ForbiddenError("部门不能设置自身为上级部门");
  let current: string | null = parentId;
  for (let depth = 0; current && depth < 100; depth += 1) {
    const [parent] = await app.db.select({ id: departments.id, parentId: departments.parentId }).from(departments)
      .where(and(eq(departments.id, current), isNull(departments.deletedAt))).limit(1);
    if (!parent) throw new NotFoundError("上级部门不存在或已删除");
    if (parent.id === departmentId) throw new ForbiddenError("部门层级不能形成循环");
    current = parent.parentId;
  }
  if (current) throw new ForbiddenError("部门层级过深");
  await assertDepartmentInActorScope(app, actor, parentId);
}

/** 岗位没有独立的部门归属字段，启用状态是当前模型下唯一可使用边界。 */
export async function assertPostIdsAssignable(app: FastifyInstance, actor: AuthUser, postIds: readonly string[]): Promise<void> {
  if (actor.role === "SUPER_ADMIN" || postIds.length === 0) return;
  const uniqueIds = [...new Set(postIds)];
  const rows = await app.db.select({ id: posts.id, enabled: posts.enabled }).from(posts).where(inArray(posts.id, uniqueIds));
  if (rows.length !== uniqueIds.length) throw new NotFoundError("部分岗位不存在");
  if (rows.some((row) => !row.enabled)) throw new ForbiddenError("不能绑定已停用的岗位");
}

export async function assertUserIdsWithinActor(actor: AuthUser, userIds: readonly string[]): Promise<void> {
  if (actor.role === "SUPER_ADMIN" || actor.accessibleUserIds === null) return;
  const allowed = new Set([actor.id, ...(actor.accessibleUserIds ?? [])]);
  if (userIds.some((id) => !allowed.has(id))) throw new ForbiddenError("无权操作该范围外的用户");
}

export async function assertDataScopeWithinActor(
  app: FastifyInstance,
  actor: AuthUser,
  targetScope: string,
  targetDepartmentIds: readonly string[] = [],
): Promise<void> {
  if (actor.role === "SUPER_ADMIN") return;
  const normalizedTarget = targetScope as DataScope;
  const scopes = await getRoleScopes(app, actor);
  if (!scopes.some((scope) => scopeCovers(scope.dataScope as DataScope, normalizedTarget))) {
    throw new ForbiddenError("不能授予超出当前账号范围的数据权限");
  }
  if (normalizedTarget === "CUSTOM" && targetDepartmentIds.length > 0) {
    await assertDepartmentIdsWithinActor(app, actor, targetDepartmentIds);
  }
}

export async function assertPermissionCodesWithinActor(
  app: FastifyInstance,
  actor: AuthUser,
  permissionCodes: readonly string[],
): Promise<void> {
  if (actor.role === "SUPER_ADMIN" || permissionCodes.length === 0) return;
  const actorPermissions = actor.permissionCodes
    ? new Set(actor.permissionCodes)
    : await getPermissionCodes(app, actor);
  if (permissionCodes.some((code) => !actorPermissions.has(code))) {
    throw new ForbiddenError("不能授予当前账号自身未拥有的权限");
  }
}

export async function assertPermissionIdsWithinActor(
  app: FastifyInstance,
  actor: AuthUser,
  permissionIds: readonly string[],
): Promise<void> {
  if (actor.role === "SUPER_ADMIN" || permissionIds.length === 0) return;
  const uniqueIds = [...new Set(permissionIds)];
  const rows = await app.db.select({ code: permissions.code }).from(permissions).where(inArray(permissions.id, uniqueIds));
  if (rows.length !== uniqueIds.length) throw new NotFoundError("部分权限不存在");
  await assertPermissionCodesWithinActor(app, actor, rows.map((row) => row.code));
}

export async function assertRoleIdsAssignable(
  app: FastifyInstance,
  actor: AuthUser,
  roleIds: readonly string[],
  targetUserRole?: string,
): Promise<void> {
  if (actor.role !== "SUPER_ADMIN" && targetUserRole === "SUPER_ADMIN") {
    throw new ForbiddenError("只有超级管理员可以修改超级管理员账号");
  }
  if (actor.role === "SUPER_ADMIN" || roleIds.length === 0) return;

  const uniqueIds = [...new Set(roleIds)];
  const roleRows = await app.db.select({ id: roles.id, code: roles.code, dataScope: roles.dataScope, enabled: roles.enabled })
    .from(roles).where(inArray(roles.id, uniqueIds));
  if (roleRows.length !== uniqueIds.length) throw new NotFoundError("部分角色不存在");
  if (roleRows.some((role) => !role.enabled)) throw new ForbiddenError("不能分配已停用的角色");

  for (const role of roleRows) {
    assertCanModifyRoleDefinition(actor, role.code);
    const departmentIds = role.dataScope === "CUSTOM"
      ? (await app.db.select({ departmentId: roleDepartments.departmentId }).from(roleDepartments).where(eq(roleDepartments.roleId, role.id))).map((row) => row.departmentId)
      : [];
    await assertDataScopeWithinActor(app, actor, role.dataScope, departmentIds);
  }

  const permissionRows = await app.db.select({ permissionCode: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(inArray(rolePermissions.roleId, uniqueIds));
  await assertPermissionCodesWithinActor(app, actor, permissionRows.map((row) => row.permissionCode));
}

export { BUILT_IN_ROLE_CODES };

import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray } from "drizzle-orm";
import { menus, permissions, roleDepartments, rolePermissions, roles, userRoles } from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";

export type MenuTreeItem = {
  id: string;
  parentId: string | null;
  menuType: "DIRECTORY" | "MENU" | "BUTTON";
  name: string;
  routePath: string | null;
  component: string | null;
  icon: string | null;
  sortOrder: number;
  isExternal: boolean;
  visible: boolean;
  permissionCode: string | null;
  children: MenuTreeItem[];
};

export async function getPermissionCodes(app: FastifyInstance, user: AuthUser) {
  if (user.role === "SUPER_ADMIN") {
    const rows = await app.db.select({ permissionCode: permissions.code }).from(permissions);
    return new Set(rows.map((row) => row.permissionCode));
  }
  const rows = await app.db.select({ permissionCode: permissions.code })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(userRoles.userId, user.id), eq(roles.enabled, true)));
  if (rows.length > 0) return new Set(rows.map((row) => row.permissionCode));
  const fallbackRoleCode = user.role === "CHANNEL_USER" ? "channel_operator" : "normal_user";
  const [fallbackRole] = await app.db.select({ id: roles.id }).from(roles).where(and(eq(roles.code, fallbackRoleCode), eq(roles.enabled, true))).limit(1);
  if (!fallbackRole) return new Set<string>();
  const fallback = await app.db.select({ permissionCode: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(rolePermissions.roleId, fallbackRole.id));
  return new Set(fallback.map((row) => row.permissionCode));
}

export async function getRoleCodes(app: FastifyInstance, user: AuthUser) {
  const rows = await app.db.select({ roleCode: roles.code }).from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(userRoles.userId, user.id), eq(roles.enabled, true)));
  return rows.length > 0 ? rows.map((row) => row.roleCode) : [user.role];
}

export async function getRoleScopes(app: FastifyInstance, user: AuthUser) {
  const rows = await app.db.select({ roleCode: roles.code, dataScope: roles.dataScope }).from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(userRoles.userId, user.id), eq(roles.enabled, true)));
  const scopes = rows.length > 0 ? rows : [{
    roleCode: user.role,
    dataScope: user.role === "SUPER_ADMIN" ? "ALL" as const : user.role === "CHANNEL_USER" ? "PROJECT_OWNER" as const : "SELF" as const
  }];
  const customRoleCodes = scopes.filter((scope) => scope.dataScope === "CUSTOM").map((scope) => scope.roleCode);
  if (customRoleCodes.length === 0) return scopes;
  const customRoles = await app.db.select({ roleId: roles.id, roleCode: roles.code, departmentId: roleDepartments.departmentId })
    .from(roles).leftJoin(roleDepartments, eq(roleDepartments.roleId, roles.id)).where(inArray(roles.code, customRoleCodes));
  return scopes.map((scope) => ({ ...scope, departmentIds: customRoles.filter((row) => row.roleCode === scope.roleCode && row.departmentId).map((row) => row.departmentId) }));
}

export async function getMenuTree(app: FastifyInstance, user: AuthUser) {
  const permissionCodes = await getPermissionCodes(app, user);
  const rows = await app.db.select().from(menus)
    .where(and(eq(menus.enabled, true), eq(menus.visible, true)))
    .orderBy(asc(menus.sortOrder), asc(menus.name));
  const allowed = rows.filter((row) => !row.permissionCode || permissionCodes.has(row.permissionCode));
  const allowedIds = new Set(allowed.map((row) => row.id));
  const byParent = new Map<string | null, MenuTreeItem[]>();
  for (const row of allowed) {
    if (row.parentId !== null && !allowedIds.has(row.parentId)) continue;
    const item: MenuTreeItem = {
      id: row.id,
      parentId: row.parentId,
      menuType: row.menuType,
      name: row.name,
      routePath: row.routePath,
      component: row.component,
      icon: row.icon,
      sortOrder: row.sortOrder,
      isExternal: row.isExternal,
      visible: row.visible,
      permissionCode: row.permissionCode,
      children: []
    };
    const children = byParent.get(row.parentId) ?? [];
    children.push(item);
    byParent.set(row.parentId, children);
  }
  const roots = byParent.get(null) ?? [];
  const attach = (items: MenuTreeItem[]) => {
    for (const item of items) {
      item.children = byParent.get(item.id) ?? [];
      attach(item.children);
    }
    return items;
  };
  return attach(roots);
}

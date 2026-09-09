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
  const assignedRoles = await app.db.select({ roleId: userRoles.roleId })
    .from(userRoles)
    .where(eq(userRoles.userId, user.id));
  const rows = await app.db.select({ permissionCode: permissions.code })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(eq(userRoles.userId, user.id), eq(roles.enabled, true)));
  // 只有从未分配动态角色时才使用账号类型默认权限；已分配但全部停用时必须立即失权。
  if (rows.length > 0 || assignedRoles.length > 0) return new Set(rows.map((row) => row.permissionCode));
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
    // 渠道账号未配置动态角色时，默认管理自身渠道及其下级渠道，
    // 使渠道归属的客户、项目和成员候选项保持一致。
    dataScope: user.role === "SUPER_ADMIN" ? "ALL" as const : "PROJECT_OWNER" as const
  }];
  const customRoleCodes = scopes.filter((scope) => scope.dataScope === "CUSTOM").map((scope) => scope.roleCode);
  if (customRoleCodes.length === 0) return scopes;
  const customRoles = await app.db.select({ roleId: roles.id, roleCode: roles.code, departmentId: roleDepartments.departmentId })
    .from(roles).leftJoin(roleDepartments, eq(roleDepartments.roleId, roles.id)).where(and(inArray(roles.code, customRoleCodes), eq(roles.enabled, true)));
  return scopes.map((scope) => ({ ...scope, departmentIds: customRoles.filter((row) => row.roleCode === scope.roleCode && row.departmentId).map((row) => row.departmentId) }));
}

export type MenuTreeRow = Pick<typeof menus.$inferSelect,
  "id" | "parentId" | "menuType" | "name" | "routePath" | "component" | "icon" | "sortOrder" | "isExternal" | "permissionCode">;

/**
 * 按权限码过滤菜单行并构建树：无权限码或命中权限码的行保留，
 * 父级被过滤或悬空的子行跳过，最后裁剪空目录（BUTTON 不构成路由）。
 */
export function buildMenuTreeForPermissions(rows: ReadonlyArray<MenuTreeRow>, permissionCodes: ReadonlySet<string>): MenuTreeItem[] {
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
      visible: true,
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
  return pruneMenuTree(attach(roots));
}

export async function getMenuTree(app: FastifyInstance, user: AuthUser) {
  const permissionCodes = await getPermissionCodes(app, user);
  const rows = await app.db.select().from(menus)
    .where(and(eq(menus.enabled, true), eq(menus.visible, true)))
    .orderBy(asc(menus.sortOrder), asc(menus.name));
  return buildMenuTreeForPermissions(rows, permissionCodes);
}

/**
 * 裁剪无可导航 MENU 的目录（BUTTON 不构成路由）。
 * 目录的子树中（含嵌套目录）只要存在 MENU 即保留，支持任意深度的目录嵌套；
 * 权限过滤后目录下没有任何可达 MENU 时整体隐藏，避免返回空壳目录。
 * 可见目录下的 BUTTON 保留，供前端做按钮级控制；按钮权限码仍以 /b/getInfo 的 permissions 为准。
 */
export function pruneMenuTree(items: MenuTreeItem[]): MenuTreeItem[] {
  const subtreeHasMenu = (item: MenuTreeItem): boolean =>
    item.menuType === "MENU" || item.children.some(subtreeHasMenu);
  return items.flatMap((item) => {
    item.children = pruneMenuTree(item.children);
    if (item.menuType === "DIRECTORY" && !item.children.some(subtreeHasMenu)) return [];
    return [item];
  });
}

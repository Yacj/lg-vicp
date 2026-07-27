import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  departments,
  dictionaries,
  dictionaryItems,
  menus,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users
} from "../../db/schema.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { ok } from "../../shared/response.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";

const idParamsSchema = z.object({ id: z.uuid("ID 格式不正确") });
const roleBodySchema = z.object({
  code: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,79}$/, "角色编码格式不正确"),
  name: z.string().trim().min(1, "请输入角色名称").max(120),
  description: z.string().max(1000).optional(),
  dataScope: z.enum(["ALL", "DEPT", "DEPT_AND_CHILDREN", "SELF", "CUSTOM", "PROJECT_OWNER"]).default("SELF"),
  enabled: z.boolean().default(true)
});
const permissionBodySchema = z.object({
  code: z.string().trim().regex(/^[a-z][a-z0-9_.-]{2,119}$/, "权限编码格式不正确"),
  name: z.string().trim().min(1, "请输入权限名称").max(120),
  resource: z.string().trim().min(1).max(80),
  action: z.string().trim().min(1).max(40),
  description: z.string().max(1000).optional()
});
const rolePermissionBodySchema = z.object({ permissionIds: z.array(z.uuid("权限 ID 格式不正确")).max(500) });
const userRoleBodySchema = z.object({ roleIds: z.array(z.uuid("角色 ID 格式不正确")).max(100) });
const departmentBodySchema = z.object({
  parentId: z.uuid("上级部门 ID 格式不正确").nullable().optional(),
  code: z.string().trim().min(2).max(80),
  name: z.string().trim().min(1, "请输入部门名称").max(120),
  sortOrder: z.number().int().default(0),
  enabled: z.boolean().default(true)
});
const dictionaryBodySchema = z.object({
  code: z.string().trim().regex(/^[a-z][a-z0-9_.-]{1,79}$/, "字典编码格式不正确"),
  name: z.string().trim().min(1, "请输入字典名称").max(120),
  description: z.string().max(1000).optional(),
  enabled: z.boolean().default(true)
});
const dictionaryItemBodySchema = z.object({
  value: z.string().trim().min(1, "请输入字典值").max(120),
  label: z.string().trim().min(1, "请输入字典标签").max(120),
  sortOrder: z.number().int().default(0),
  enabled: z.boolean().default(true),
  metadata: z.record(z.string(), z.unknown()).optional()
});
const menuBodySchema = z.object({
  parentId: z.uuid("上级菜单 ID 格式不正确").nullable().optional(),
  menuType: z.enum(["DIRECTORY", "MENU", "BUTTON"]),
  name: z.string().trim().min(1, "请输入菜单名称").max(120),
  routePath: z.string().trim().max(255).refine((value) => value.startsWith("/") || /^https?:\/\//.test(value), "路由地址格式不正确").nullable().optional(),
  component: z.string().trim().max(255).regex(/^[a-zA-Z0-9_\-/]+$/, "组件标识格式不正确").nullable().optional(),
  icon: z.string().trim().max(120).nullable().optional(),
  sortOrder: z.number().int().default(0),
  isExternal: z.boolean().default(false),
  visible: z.boolean().default(true),
  enabled: z.boolean().default(true),
  permissionCode: z.string().trim().max(120).nullable().optional()
});

function requireAdmin(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && (user.permissionCodes ?? []).includes(permissionCode)) return user;
  if (user.role !== "SUPER_ADMIN") throw new ForbiddenError(`缺少权限：${permissionCode}`);
  return user;
}

async function ensureMenuParent(app: FastifyInstance, menuId: string | undefined, parentId: string | null | undefined) {
  let current = parentId;
  for (let depth = 0; current && depth < 100; depth += 1) {
    if (current === menuId) throw new ForbiddenError("菜单层级不能形成循环");
    const [parent] = await app.db.select({ id: menus.id, parentId: menus.parentId }).from(menus).where(eq(menus.id, current)).limit(1);
    if (!parent) throw new NotFoundError("上级菜单不存在");
    current = parent.parentId;
  }
  if (current) throw new ForbiddenError("菜单层级过深");
}

async function ensurePermissionCode(app: FastifyInstance, permissionCode: string | null | undefined) {
  if (!permissionCode) return;
  const [permission] = await app.db.select({ code: permissions.code }).from(permissions).where(eq(permissions.code, permissionCode)).limit(1);
  if (!permission) throw new NotFoundError("菜单绑定的权限不存在");
}

export async function systemManagementRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/menus", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / 菜单管理"], summary: "获取菜单列表" }
  }, async (request) => {
    requireAdmin(request, "system:menu:list");
    return ok(request, { items: await app.db.select().from(menus).orderBy(asc(menus.sortOrder), asc(menus.name)) });
  });

  route.post("/menus", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / 菜单管理"], summary: "创建菜单", body: menuBodySchema }
  }, async (request) => {
    const actor = requireAdmin(request, "system:menu:add");
    await ensureMenuParent(app, undefined, request.body.parentId);
    await ensurePermissionCode(app, request.body.permissionCode);
    const [menu] = await app.db.transaction(async (tx) => {
      const [created] = await tx.insert(menus).values(request.body).returning();
      await writeAuditLog({ db: tx, request, actor, action: AUDIT_ACTIONS.MENU_CREATED, targetType: "menu", targetId: created!.id, afterJson: created });
      return [created] as const;
    });
    return ok(request, { message: "菜单创建成功", menu });
  });

  route.patch("/menus/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / 菜单管理"], summary: "修改菜单", params: idParamsSchema, body: menuBodySchema.partial() }
  }, async (request) => {
    const actor = requireAdmin(request, "system:menu:edit");
    const [before] = await app.db.select().from(menus).where(eq(menus.id, request.params.id)).limit(1);
    if (!before) throw new NotFoundError("菜单不存在");
    await ensureMenuParent(app, request.params.id, request.body.parentId);
    await ensurePermissionCode(app, request.body.permissionCode);
    const [menu] = await app.db.transaction(async (tx) => {
      const [updated] = await tx.update(menus).set({ ...request.body, updatedAt: new Date() }).where(eq(menus.id, before.id)).returning();
      await writeAuditLog({ db: tx, request, actor, action: AUDIT_ACTIONS.MENU_UPDATED, targetType: "menu", targetId: before.id, beforeJson: before, afterJson: updated });
      return [updated] as const;
    });
    return ok(request, { message: "菜单修改成功", menu });
  });

  route.delete("/menus/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / 菜单管理"], summary: "删除菜单", params: idParamsSchema }
  }, async (request) => {
    const actor = requireAdmin(request, "system:menu:remove");
    const [menu] = await app.db.select().from(menus).where(eq(menus.id, request.params.id)).limit(1);
    if (!menu) throw new NotFoundError("菜单不存在");
    const [child] = await app.db.select({ id: menus.id }).from(menus).where(eq(menus.parentId, menu.id)).limit(1);
    if (child) throw new ForbiddenError("请先删除或移动下级菜单");
    await app.db.transaction(async (tx) => {
      await tx.delete(menus).where(eq(menus.id, menu.id));
      await writeAuditLog({ db: tx, request, actor, action: AUDIT_ACTIONS.MENU_DELETED, targetType: "menu", targetId: menu.id, beforeJson: menu });
    });
    return ok(request, { message: "菜单删除成功" });
  });

  route.get("/roles", {
    preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 角色权限"], summary: "获取角色列表" }
  }, async (request) => {
    requireAdmin(request, "system:role:list");
    return ok(request, { items: await app.db.select().from(roles).orderBy(asc(roles.code)) });
  });

  route.post("/roles", {
    preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 角色权限"], summary: "创建角色", body: roleBodySchema }
  }, async (request) => {
    const actor = requireAdmin(request, "system:role:add");
    const [role] = await app.db.insert(roles).values(request.body).returning();
    await writeAuditLog({ db: app.db, request, actor, action: AUDIT_ACTIONS.RBAC_ROLE_CREATED, targetType: "role", targetId: role!.id, afterJson: role });
    return ok(request, { message: "角色创建成功", role });
  });

  route.get("/permissions", {
    preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 角色权限"], summary: "获取权限列表" }
  }, async (request) => {
    requireAdmin(request, "system:permission:list");
    return ok(request, { items: await app.db.select().from(permissions).orderBy(asc(permissions.code)) });
  });

  route.post("/permissions", {
    preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 角色权限"], summary: "创建权限", body: permissionBodySchema }
  }, async (request) => {
    const actor = requireAdmin(request, "system:permission:add");
    const [permission] = await app.db.insert(permissions).values(request.body).returning();
    await writeAuditLog({ db: app.db, request, actor, action: AUDIT_ACTIONS.RBAC_PERMISSION_CREATED, targetType: "permission", targetId: permission!.id, afterJson: permission });
    return ok(request, { message: "权限创建成功", permission });
  });

  route.put("/roles/:id/permissions", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / 角色权限"], summary: "设置角色权限", params: idParamsSchema, body: rolePermissionBodySchema }
  }, async (request) => {
    const actor = requireAdmin(request, "system:role:permission");
    const [role] = await app.db.select().from(roles).where(eq(roles.id, request.params.id)).limit(1);
    if (!role) throw new NotFoundError("角色不存在");
    const uniqueIds = [...new Set(request.body.permissionIds)];
    if (uniqueIds.length > 0) {
      const existing = await app.db.select({ id: permissions.id }).from(permissions).where(inArray(permissions.id, uniqueIds));
      if (existing.length !== uniqueIds.length) throw new NotFoundError("部分权限不存在");
    }
    await app.db.transaction(async (tx) => {
      const before = await tx.select({ permissionId: rolePermissions.permissionId }).from(rolePermissions)
        .where(eq(rolePermissions.roleId, role.id));
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
      if (uniqueIds.length > 0) await tx.insert(rolePermissions).values(uniqueIds.map((permissionId) => ({ roleId: role.id, permissionId })));
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.RBAC_ROLE_PERMISSIONS_CHANGED,
        targetType: "role", targetId: role.id,
        beforeJson: { permissionIds: before.map((item) => item.permissionId) }, afterJson: { permissionIds: uniqueIds }
      });
    });
    return ok(request, { message: "角色权限设置成功" });
  });

  route.put("/users/:id/roles", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / 角色权限"], summary: "设置用户角色", params: idParamsSchema, body: userRoleBodySchema }
  }, async (request) => {
    const actor = requireAdmin(request, "system:user:role");
    const [user] = await app.db.select({ id: users.id }).from(users).where(eq(users.id, request.params.id)).limit(1);
    if (!user) throw new NotFoundError("用户不存在");
    const uniqueIds = [...new Set(request.body.roleIds)];
    if (uniqueIds.length > 0) {
      const existing = await app.db.select({ id: roles.id }).from(roles).where(inArray(roles.id, uniqueIds));
      if (existing.length !== uniqueIds.length) throw new NotFoundError("部分角色不存在");
    }
    await app.db.transaction(async (tx) => {
      const before = await tx.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, user.id));
      await tx.delete(userRoles).where(eq(userRoles.userId, user.id));
      if (uniqueIds.length > 0) await tx.insert(userRoles).values(uniqueIds.map((roleId) => ({ userId: user.id, roleId })));
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.USER_ROLE_CHANGED,
        targetType: "user", targetId: user.id,
        beforeJson: { roleIds: before.map((item) => item.roleId) }, afterJson: { roleIds: uniqueIds }
      });
    });
    return ok(request, { message: "用户角色设置成功" });
  });

  route.get("/departments", {
    preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 部门管理"], summary: "获取部门列表" }
  }, async (request) => {
    requireAdmin(request, "system:dept:list");
    return ok(request, { items: await app.db.select().from(departments).orderBy(asc(departments.sortOrder), asc(departments.name)) });
  });

  route.post("/departments", {
    preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 部门管理"], summary: "创建部门", body: departmentBodySchema }
  }, async (request) => {
    const actor = requireAdmin(request, "system:dept:add");
    if (request.body.parentId) {
      const [parent] = await app.db.select({ id: departments.id }).from(departments).where(eq(departments.id, request.body.parentId)).limit(1);
      if (!parent) throw new NotFoundError("上级部门不存在");
    }
    const [department] = await app.db.insert(departments).values(request.body).returning();
    await writeAuditLog({ db: app.db, request, actor, action: AUDIT_ACTIONS.DEPARTMENT_CREATED, targetType: "department", targetId: department!.id, afterJson: department });
    return ok(request, { message: "部门创建成功", department });
  });

  route.get("/dictionaries", {
    preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 基础数据"], summary: "获取动态字典列表" }
  }, async (request) => {
    requireAdmin(request, "system:dict:list");
    return ok(request, { items: await app.db.select().from(dictionaries).orderBy(asc(dictionaries.code)) });
  });

  route.post("/dictionaries", {
    preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 基础数据"], summary: "创建动态字典", body: dictionaryBodySchema }
  }, async (request) => {
    const actor = requireAdmin(request, "system:dict:add");
    const [dictionary] = await app.db.insert(dictionaries).values(request.body).returning();
    await writeAuditLog({ db: app.db, request, actor, action: AUDIT_ACTIONS.DICTIONARY_CREATED, targetType: "dictionary", targetId: dictionary!.id, afterJson: dictionary });
    return ok(request, { message: "字典创建成功", dictionary });
  });

  route.post("/dictionaries/:id/items", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / 基础数据"], summary: "创建字典项", params: idParamsSchema, body: dictionaryItemBodySchema }
  }, async (request) => {
    const actor = requireAdmin(request, "system:dict:item:add");
    const [dictionary] = await app.db.select({ id: dictionaries.id }).from(dictionaries).where(eq(dictionaries.id, request.params.id)).limit(1);
    if (!dictionary) throw new NotFoundError("字典不存在");
    const [item] = await app.db.insert(dictionaryItems).values({ dictionaryId: dictionary.id, ...request.body }).returning();
    await writeAuditLog({ db: app.db, request, actor, action: AUDIT_ACTIONS.DICTIONARY_ITEM_CREATED, targetType: "dictionary_item", targetId: item!.id, afterJson: item });
    return ok(request, { message: "字典项创建成功", item });
  });
}

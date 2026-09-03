import * as argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, count, desc, eq, ilike, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { departments, posts, roles, userDepartments, userIdentities, userPosts, userRoles, users } from "../../db/schema.js";
import { AUDIT_ACTIONS, CHANNEL_TYPES, USER_ROLES } from "../../shared/constants.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { getPagination, paginationQuerySchema } from "../../shared/pagination.js";
import { ok } from "../../shared/response.js";
import { assertPermission } from "../../shared/permission-guard.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";

/**
 * 登录账号：取该用户最早一条身份凭证的 identifier（创建时仅写入一条），
 * 列表与详情共用，保证展示与登录账号一致。
 */
const loginIdentifierExpr = sql<string>`(
  select ui.identifier
  from ${userIdentities} ui
  where ui.user_id = "users"."id"
  order by ui.created_at asc
  limit 1
)`.as("loginIdentifier");

const userParamsSchema = z.object({ id: z.uuid("用户 ID 格式不正确") });
const roleEnum = z.enum([USER_ROLES.SUPER_ADMIN, USER_ROLES.CHANNEL_USER, USER_ROLES.NORMAL_USER]);
const channelEnum = z.enum([CHANNEL_TYPES.DEALER, CHANNEL_TYPES.SALESPERSON]);
const userFields = z.object({
  displayName: z.string().trim().min(1, "请输入用户昵称").max(120),
  gender: z.enum(["UNKNOWN", "MALE", "FEMALE"]).default("UNKNOWN"),
  email: z.string().email("邮箱格式不正确").max(255).nullable().optional(),
  remark: z.string().max(1000).nullable().optional(),
  role: roleEnum,
  channelType: channelEnum.nullable().optional()
});
const assignmentFields = {
  departmentIds: z.array(z.uuid("部门 ID 格式不正确")).max(100).optional(),
  postIds: z.array(z.uuid("岗位 ID 格式不正确")).max(100).optional(),
  roleIds: z.array(z.uuid("角色 ID 格式不正确")).max(100).optional(),
};
const createUserBodySchema = userFields.extend({
  identifier: z.string().trim().min(1, "请输入登录账号").max(255),
  password: z.string().min(5, "密码至少需要 5 个字符").max(128),
  phone: z.string().trim().regex(/^\+?[0-9]{6,20}$/, "手机号格式不正确").nullable().optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE")
}).extend(assignmentFields).superRefine((value, context) => {
  if (value.role === USER_ROLES.CHANNEL_USER && !value.channelType) context.addIssue({ code: "custom", path: ["channelType"], message: "渠道用户必须选择经销商或业务员" });
  if (value.role !== USER_ROLES.CHANNEL_USER && value.channelType) context.addIssue({ code: "custom", path: ["channelType"], message: "只有渠道用户可以设置渠道类型" });
});
const updateUserBodySchema = userFields.partial().extend({ phone: z.string().trim().regex(/^\+?[0-9]{6,20}$/, "手机号格式不正确").nullable().optional(), status: z.enum(["ACTIVE", "DISABLED"]).optional() }).extend(assignmentFields).refine((v) => Object.keys(v).length > 0, "至少需要修改一个字段");
const updateStatusBodySchema = z.object({ status: z.enum(["ACTIVE", "DISABLED"]) });
const listQuerySchema = paginationQuerySchema.extend({
  keyword: z.string().trim().max(120).optional(),
  departmentId: z.uuid("部门 ID 格式不正确").optional(),
  // 为 true 时部门筛选包含全部下级部门；默认只匹配直属部门，保持向后兼容
  includeDescendants: z.coerce.boolean().default(false),
  roleId: z.uuid("角色 ID 格式不正确").optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  includeDeleted: z.coerce.boolean().default(false)
});
const idsBodySchema = z.object({ ids: z.array(z.uuid()).max(1000) });
const resetPasswordSchema = z.object({ password: z.string().min(5, "密码至少需要 5 个字符").max(128) });
const importBodySchema = z.object({ csv: z.string().min(1, "请提供 CSV 内容").max(5_000_000), dryRun: z.boolean().default(false) });

function requireUserPermission(request: Parameters<typeof getCurrentUser>[0], permission: string) {
  return assertPermission(request, permission);
}

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// 收集部门 ID 集合：includeDescendants 为 true 时在内存 BFS 展开全部后代部门
async function collectDepartmentIds(db: FastifyInstance["db"], rootId: string, includeDescendants: boolean) {
  const ids = [rootId];
  if (!includeDescendants) return ids;
  const rows = await db.select({ id: departments.id, parentId: departments.parentId }).from(departments).where(isNull(departments.deletedAt));
  const childrenByParent = new Map<string | null, string[]>();
  for (const row of rows) {
    const list = childrenByParent.get(row.parentId) ?? [];
    list.push(row.id);
    childrenByParent.set(row.parentId, list);
  }
  const seen = new Set(ids);
  const queue = [...ids];
  while (queue.length) {
    const parentId = queue.shift()!;
    for (const childId of childrenByParent.get(parentId) ?? []) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      queue.push(childId);
    }
  }
  return [...seen];
}

async function validateAssignments(
  app: FastifyInstance,
  request: Parameters<typeof getCurrentUser>[0],
  assignments: { departmentIds?: string[]; postIds?: string[]; roleIds?: string[] },
) {
  const departmentIds = assignments.departmentIds === undefined ? undefined : [...new Set(assignments.departmentIds)];
  const postIds = assignments.postIds === undefined ? undefined : [...new Set(assignments.postIds)];
  const roleIds = assignments.roleIds === undefined ? undefined : [...new Set(assignments.roleIds)];
  if (departmentIds !== undefined) {
    await assertPermission(request, "system:user:dept");
    const rows = departmentIds.length === 0 ? [] : await app.db.select({ id: departments.id }).from(departments).where(and(inArray(departments.id, departmentIds), isNull(departments.deletedAt)));
    if (rows.length !== departmentIds.length) throw new NotFoundError("部分部门不存在或已删除");
  }
  if (postIds !== undefined) {
    await assertPermission(request, "system:user:post");
    const rows = postIds.length === 0 ? [] : await app.db.select({ id: posts.id }).from(posts).where(inArray(posts.id, postIds));
    if (rows.length !== postIds.length) throw new NotFoundError("部分岗位不存在");
  }
  if (roleIds !== undefined) {
    await assertPermission(request, "system:user:role");
    const rows = roleIds.length === 0 ? [] : await app.db.select({ id: roles.id }).from(roles).where(inArray(roles.id, roleIds));
    if (rows.length !== roleIds.length) throw new NotFoundError("部分角色不存在");
  }
  return { departmentIds, postIds, roleIds };
}

export async function userRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/users", { preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 用户管理"], summary: "获取用户列表（支持包含下级部门筛选）", querystring: listQuerySchema } }, async (request) => {
    await requireUserPermission(request, "system:user:list");
    const { skip, take } = getPagination(request.query.page, request.query.pageSize);
    const departmentUserIds = request.query.departmentId ? (await app.db.select({ userId: userDepartments.userId }).from(userDepartments).where(inArray(userDepartments.departmentId, await collectDepartmentIds(app.db, request.query.departmentId, request.query.includeDescendants)))).map((row) => row.userId) : undefined;
    const roleUserIds = request.query.roleId ? (await app.db.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, request.query.roleId))).map((row) => row.userId) : undefined;
    const filters = [request.query.includeDeleted ? undefined : isNull(users.deletedAt), request.query.status ? eq(users.status, request.query.status) : undefined, request.query.keyword ? ilike(users.displayName, `%${request.query.keyword}%`) : undefined, departmentUserIds ? inArray(users.id, departmentUserIds) : undefined, roleUserIds ? inArray(users.id, roleUserIds) : undefined];
    const base = app.db.select({ id: users.id, loginIdentifier: loginIdentifierExpr, phone: users.phone, email: users.email, displayName: users.displayName, gender: users.gender, remark: users.remark, role: users.role, channelType: users.channelType, status: users.status, deletedAt: users.deletedAt, createdAt: users.createdAt, updatedAt: users.updatedAt }).from(users).where(and(...filters));
    const rows = await base.orderBy(desc(users.createdAt)).offset(skip).limit(take);
    const [totalRow] = await app.db.select({ value: count() }).from(users).where(and(...filters));
    return ok(request, { items: rows, total: totalRow?.value ?? 0, page: request.query.page, pageSize: request.query.pageSize });
  });

  route.get("/users/export", { preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 用户管理"], summary: "导出用户 CSV", querystring: listQuerySchema } }, async (request, reply) => {
    await requireUserPermission(request, "system:user:export");
    const rows = await app.db.select({ displayName: users.displayName, phone: users.phone, email: users.email, role: users.role, channelType: users.channelType, status: users.status, createdAt: users.createdAt }).from(users).where(isNull(users.deletedAt)).orderBy(desc(users.createdAt));
    const csv = ["用户昵称,手机号,邮箱,角色,渠道类型,状态,创建时间", ...rows.map((r) => [r.displayName, r.phone, r.email, r.role, r.channelType, r.status, r.createdAt.toISOString()].map(csvEscape).join(","))].join("\n");
    return reply.type("text/csv; charset=utf-8").send(`\uFEFF${csv}`);
  });

  route.post("/users/import", { preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 用户管理"], summary: "导入用户 CSV", body: importBodySchema } }, async (request) => {
    const actor = await requireUserPermission(request, "system:user:import");
    const lines = request.body.csv.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) throw new ForbiddenError("CSV 至少需要包含表头和一条数据");
    const headers = lines.shift()!.split(",").map((item) => item.trim());
    const required = ["identifier", "password", "displayName", "role"];
    if (required.some((header) => !headers.includes(header))) throw new ForbiddenError(`CSV 必须包含字段：${required.join(",")}`);
    const imported: string[] = []; const errors: Array<{ row: number; message: string }> = [];
    if (!request.body.dryRun) {
      await app.db.transaction(async (tx) => {
        for (const [index, line] of lines.entries()) {
          const values = line.split(",").map((item) => item.trim().replace(/^"|"$/g, "")); const row = Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]));
          const parsed = createUserBodySchema.safeParse({ ...row, email: row.email || undefined, channelType: row.channelType || undefined, gender: row.gender || "UNKNOWN", remark: row.remark || undefined });
          if (!parsed.success) { errors.push({ row: index + 2, message: parsed.error.issues[0]?.message ?? "数据格式不正确" }); continue; }
          try {
            const isPhone = /^\+?[0-9]{6,20}$/.test(parsed.data.identifier); const [user] = await tx.insert(users).values({ displayName: parsed.data.displayName, gender: parsed.data.gender, email: parsed.data.email, remark: parsed.data.remark, phone: parsed.data.phone ?? (isPhone ? parsed.data.identifier : undefined), role: parsed.data.role, channelType: parsed.data.role === USER_ROLES.CHANNEL_USER ? parsed.data.channelType : null }).returning();
            await tx.insert(userIdentities).values({ userId: user!.id, type: isPhone ? "PHONE" : "USERNAME", identifier: parsed.data.identifier, passwordHash: await argon2.hash(parsed.data.password, { type: argon2.argon2id }), verifiedAt: new Date() }); imported.push(parsed.data.identifier);
          } catch { errors.push({ row: index + 2, message: "用户名或手机号已存在" }); }
        }
        if (imported.length > 0) await writeAuditLog({ db: tx, request, actor, action: "user.imported", targetType: "user", afterJson: { count: imported.length } });
      });
    }
    return ok(request, { message: request.body.dryRun ? "CSV 校验完成" : "CSV 导入完成", imported: imported.length, errors, dryRun: request.body.dryRun });
  });

  route.post("/users", { preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 用户管理"], summary: "创建用户", body: createUserBodySchema } }, async (request) => {
    const actor = await requireUserPermission(request, "system:user:add");
    const { departmentIds, postIds, roleIds, ...userValues } = request.body;
    const assignments = await validateAssignments(app, request, { departmentIds, postIds, roleIds });
    const passwordHash = await argon2.hash(request.body.password, { type: argon2.argon2id });
    const isPhone = /^\+?[0-9]{6,20}$/.test(request.body.identifier);
    const phone = request.body.phone ?? (isPhone ? request.body.identifier : undefined);
    if (request.body.role === USER_ROLES.NORMAL_USER && !phone) throw new ForbiddenError("普通用户必须填写手机号码");
    const created = await app.db.transaction(async (tx) => {
      // 登录账号全局唯一：登录按 identifier 匹配（不区分身份类型），故跨身份类型判重；
      // 软删除用户已释放该标识，判重时排除已删除用户及其身份凭证。
      const [identityTaken] = await tx.select({ id: userIdentities.id }).from(userIdentities).innerJoin(users, eq(users.id, userIdentities.userId)).where(and(eq(userIdentities.identifier, request.body.identifier), isNull(users.deletedAt), isNull(userIdentities.deletedAt))).limit(1);
      if (identityTaken) throw new ConflictError("登录账号已存在");
      if (phone) {
        const [phoneTaken] = await tx.select({ id: users.id }).from(users).where(and(eq(users.phone, phone), isNull(users.deletedAt))).limit(1);
        if (phoneTaken) throw new ConflictError("手机号已存在");
      }
      const [user] = await tx.insert(users).values({ displayName: userValues.displayName, gender: userValues.gender, email: userValues.email, remark: userValues.remark, phone, role: userValues.role, channelType: userValues.role === USER_ROLES.CHANNEL_USER ? userValues.channelType : null, status: userValues.status }).returning();
      await tx.insert(userIdentities).values({ userId: user!.id, type: isPhone ? "PHONE" : "USERNAME", identifier: request.body.identifier, passwordHash, verifiedAt: new Date() });
      if (assignments.departmentIds !== undefined && assignments.departmentIds.length > 0) await tx.insert(userDepartments).values(assignments.departmentIds.map((departmentId, index) => ({ userId: user!.id, departmentId, isPrimary: index === 0 })));
      if (assignments.postIds !== undefined && assignments.postIds.length > 0) await tx.insert(userPosts).values(assignments.postIds.map((postId) => ({ userId: user!.id, postId })));
      if (assignments.roleIds !== undefined && assignments.roleIds.length > 0) await tx.insert(userRoles).values(assignments.roleIds.map((roleId) => ({ userId: user!.id, roleId })));
      await writeAuditLog({ db: tx, request, actor, action: AUDIT_ACTIONS.USER_CREATED, targetType: "user", targetId: user!.id, afterJson: { ...user, identifier: request.body.identifier, departmentIds: assignments.departmentIds ?? [], postIds: assignments.postIds ?? [], roleIds: assignments.roleIds ?? [] } });
      return user!;
    });
    return ok(request, { message: "用户创建成功", user: created });
  });

  route.get("/users/:id", { preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 用户管理"], summary: "获取用户详情", params: userParamsSchema } }, async (request) => {
    await requireUserPermission(request, "system:user:list");
    const [user] = await app.db.select({ id: users.id, loginIdentifier: loginIdentifierExpr, phone: users.phone, email: users.email, displayName: users.displayName, gender: users.gender, remark: users.remark, role: users.role, channelType: users.channelType, status: users.status, deletedAt: users.deletedAt, createdAt: users.createdAt, updatedAt: users.updatedAt }).from(users).where(eq(users.id, request.params.id)).limit(1);
    if (!user) throw new NotFoundError("用户不存在");
    const [departmentRows, postRows, roleRows] = await Promise.all([
      app.db.select({ id: userDepartments.departmentId, isPrimary: userDepartments.isPrimary }).from(userDepartments).where(eq(userDepartments.userId, user.id)),
      app.db.select({ id: posts.id, name: posts.name, code: posts.code }).from(userPosts).innerJoin(posts, eq(posts.id, userPosts.postId)).where(eq(userPosts.userId, user.id)),
      app.db.select({ id: roles.id, name: roles.name, code: roles.code }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, user.id))
    ]);
    return ok(request, { user, departments: departmentRows, posts: postRows, roles: roleRows });
  });

  route.patch("/users/:id", { preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 用户管理"], summary: "修改用户资料及关联配置", params: userParamsSchema, body: updateUserBodySchema } }, async (request) => {
    const actor = await requireUserPermission(request, "system:user:edit");
    const { departmentIds, postIds, roleIds, status, ...profileValues } = request.body;
    const assignments = await validateAssignments(app, request, { departmentIds, postIds, roleIds });
    if (status === "DISABLED" && actor.id === request.params.id) throw new ForbiddenError("不能禁用当前登录账号");
    const [before] = await app.db.select().from(users).where(and(eq(users.id, request.params.id), isNull(users.deletedAt))).limit(1);
    if (!before) throw new NotFoundError("用户不存在");
    const nextRole = profileValues.role ?? before.role;
    const nextChannelType = nextRole === USER_ROLES.CHANNEL_USER ? profileValues.channelType ?? before.channelType : null;
    if (nextRole === USER_ROLES.CHANNEL_USER && !nextChannelType) throw new ForbiddenError("渠道用户必须选择渠道类型");
    const nextPhone = "phone" in profileValues ? profileValues.phone : before.phone;
    if (nextRole === USER_ROLES.NORMAL_USER && !nextPhone) throw new ForbiddenError("普通用户必须填写手机号码");
    const [updated] = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(users).set({ ...profileValues, role: nextRole, channelType: nextChannelType, ...(status ? { status } : {}), updatedAt: new Date() }).where(eq(users.id, before.id)).returning();
      if (assignments.departmentIds !== undefined) {
        await tx.delete(userDepartments).where(eq(userDepartments.userId, before.id));
        if (assignments.departmentIds.length > 0) await tx.insert(userDepartments).values(assignments.departmentIds.map((departmentId, index) => ({ userId: before.id, departmentId, isPrimary: index === 0 })));
      }
      if (assignments.postIds !== undefined) {
        await tx.delete(userPosts).where(eq(userPosts.userId, before.id));
        if (assignments.postIds.length > 0) await tx.insert(userPosts).values(assignments.postIds.map((postId) => ({ userId: before.id, postId })));
      }
      if (assignments.roleIds !== undefined) {
        await tx.delete(userRoles).where(eq(userRoles.userId, before.id));
        if (assignments.roleIds.length > 0) await tx.insert(userRoles).values(assignments.roleIds.map((roleId) => ({ userId: before.id, roleId })));
      }
      await writeAuditLog({ db: tx, request, actor, action: AUDIT_ACTIONS.USER_UPDATED, targetType: "user", targetId: before.id, beforeJson: before, afterJson: { ...row, departmentIds: assignments.departmentIds, postIds: assignments.postIds, roleIds: assignments.roleIds } });
      return [row] as const;
    });
    return ok(request, { message: "用户资料修改成功", user: updated });
  });

  route.patch("/users/:id/status", { preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 用户管理"], summary: "修改用户状态", params: userParamsSchema, body: updateStatusBodySchema } }, async (request) => {
    const actor = await requireUserPermission(request, "system:user:edit");
    if (actor.id === request.params.id && request.body.status === "DISABLED") throw new ForbiddenError("不能禁用当前登录账号");
    const [before] = await app.db.select().from(users).where(and(eq(users.id, request.params.id), isNull(users.deletedAt))).limit(1);
    if (!before) throw new NotFoundError("用户不存在");
    const [updated] = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(users).set({ status: request.body.status, updatedAt: new Date() }).where(eq(users.id, before.id)).returning();
      await writeAuditLog({ db: tx, request, actor, action: AUDIT_ACTIONS.USER_STATUS_CHANGED, targetType: "user", targetId: before.id, beforeJson: { status: before.status }, afterJson: { status: row!.status } });
      return [row] as const;
    });
    return ok(request, { message: "用户状态修改成功", user: updated });
  });

  route.delete("/users/:id", { preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 用户管理"], summary: "删除用户", params: userParamsSchema } }, async (request) => {
    const actor = await requireUserPermission(request, "system:user:remove");
    if (actor.id === request.params.id) throw new ForbiddenError("不能删除当前登录账号");
    const [before] = await app.db.select().from(users).where(and(eq(users.id, request.params.id), isNull(users.deletedAt))).limit(1);
    if (!before) throw new NotFoundError("用户不存在");
    await app.db.transaction(async (tx) => {
      const deletedAt = new Date();
      await tx.update(users).set({ deletedAt, status: "DISABLED", updatedAt: new Date() }).where(eq(users.id, before.id));
      await tx.update(userIdentities).set({ deletedAt, updatedAt: new Date() }).where(eq(userIdentities.userId, before.id));
      await writeAuditLog({ db: tx, request, actor, action: AUDIT_ACTIONS.USER_DELETED, targetType: "user", targetId: before.id, beforeJson: before });
    });
    return ok(request, { message: "用户删除成功" });
  });

  route.post("/users/:id/restore", { preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 用户管理"], summary: "恢复用户", params: userParamsSchema } }, async (request) => {
    const actor = await requireUserPermission(request, "system:user:edit");
    const [before] = await app.db.select().from(users).where(eq(users.id, request.params.id)).limit(1);
    if (!before) throw new NotFoundError("用户不存在");

    // 软删除期间标识可能被其他有效用户重新使用，恢复前必须重新判重。
    if (before.phone) {
      const [phoneTaken] = await app.db.select({ id: users.id }).from(users).where(and(eq(users.phone, before.phone), isNull(users.deletedAt), ne(users.id, before.id))).limit(1);
      if (phoneTaken) throw new ConflictError("该手机号已被其他用户使用，无法恢复");
    }
    if (before.email) {
      const [emailTaken] = await app.db.select({ id: users.id }).from(users).where(and(eq(users.email, before.email), isNull(users.deletedAt), ne(users.id, before.id))).limit(1);
      if (emailTaken) throw new ConflictError("该邮箱已被其他用户使用，无法恢复");
    }
    const identityRows = await app.db.select({ identifier: userIdentities.identifier }).from(userIdentities).where(eq(userIdentities.userId, before.id));
    for (const identity of identityRows) {
      const [taken] = await app.db.select({ id: userIdentities.id }).from(userIdentities).innerJoin(users, eq(users.id, userIdentities.userId)).where(and(eq(userIdentities.identifier, identity.identifier), isNull(userIdentities.deletedAt), isNull(users.deletedAt), ne(users.id, before.id))).limit(1);
      if (taken) throw new ConflictError("该登录账号已被其他用户使用，无法恢复");
    }

    const [user] = await app.db.transaction(async (tx) => {
      const restoredAt = new Date();
      const [row] = await tx.update(users).set({ deletedAt: null, status: "ACTIVE", updatedAt: restoredAt }).where(eq(users.id, before.id)).returning();
      await tx.update(userIdentities).set({ deletedAt: null, updatedAt: restoredAt }).where(eq(userIdentities.userId, before.id));
      await writeAuditLog({ db: tx, request, actor, action: AUDIT_ACTIONS.USER_RESTORED, targetType: "user", targetId: before.id });
      return [row] as const;
    });
    return ok(request, { message: "用户恢复成功", user });
  });

  route.post("/users/:id/reset-password", { preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 用户管理"], summary: "重置用户密码", params: userParamsSchema, body: resetPasswordSchema } }, async (request) => {
    const actor = await requireUserPermission(request, "system:user:reset-password");
    const [identity] = await app.db.select().from(userIdentities).where(and(eq(userIdentities.userId, request.params.id), inArray(userIdentities.type, ["USERNAME", "PHONE"]), isNull(userIdentities.deletedAt))).limit(1);
    if (!identity) throw new NotFoundError("用户登录身份不存在");
    await app.db.update(userIdentities).set({ passwordHash: await argon2.hash(request.body.password, { type: argon2.argon2id }), updatedAt: new Date() }).where(eq(userIdentities.id, identity.id));
    await writeAuditLog({ db: app.db, request, actor, action: AUDIT_ACTIONS.USER_PASSWORD_RESET, targetType: "user", targetId: request.params.id });
    return ok(request, { message: "用户密码重置成功" });
  });

  route.put("/users/:id/posts", { preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 用户管理"], summary: "分配用户岗位", params: userParamsSchema, body: idsBodySchema } }, async (request) => {
    const actor = await requireUserPermission(request, "system:user:post");
    const existing = request.body.ids.length ? await app.db.select({ id: posts.id }).from(posts).where(inArray(posts.id, request.body.ids)) : [];
    if (existing.length !== request.body.ids.length) throw new NotFoundError("部分岗位不存在");
    await app.db.transaction(async (tx) => { await tx.delete(userPosts).where(eq(userPosts.userId, request.params.id)); if (request.body.ids.length) await tx.insert(userPosts).values(request.body.ids.map((postId) => ({ userId: request.params.id, postId }))); await writeAuditLog({ db: tx, request, actor, action: AUDIT_ACTIONS.USER_POST_CHANGED, targetType: "user", targetId: request.params.id, afterJson: { postIds: request.body.ids } }); });
    return ok(request, { message: "用户岗位分配成功" });
  });

  route.put("/users/:id/departments", { preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 用户管理"], summary: "分配用户部门", params: userParamsSchema, body: idsBodySchema } }, async (request) => {
    const actor = await requireUserPermission(request, "system:user:dept");
    const existing = request.body.ids.length ? await app.db.select({ id: departments.id }).from(departments).where(and(inArray(departments.id, request.body.ids), isNull(departments.deletedAt))) : [];
    if (existing.length !== request.body.ids.length) throw new NotFoundError("部分部门不存在或已删除");
    await app.db.transaction(async (tx) => { await tx.delete(userDepartments).where(eq(userDepartments.userId, request.params.id)); if (request.body.ids.length) await tx.insert(userDepartments).values(request.body.ids.map((departmentId, index) => ({ userId: request.params.id, departmentId, isPrimary: index === 0 }))); await writeAuditLog({ db: tx, request, actor, action: AUDIT_ACTIONS.USER_DEPARTMENT_CHANGED, targetType: "user", targetId: request.params.id, afterJson: { departmentIds: request.body.ids } }); });
    return ok(request, { message: "用户部门分配成功" });
  });
}

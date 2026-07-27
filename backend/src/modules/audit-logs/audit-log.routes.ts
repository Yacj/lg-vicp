import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, count, desc, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import { auditLogs } from "../../db/schema.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError } from "../../shared/errors.js";
import { getPagination, paginationQuerySchema } from "../../shared/pagination.js";
import { ok } from "../../shared/response.js";

function requireAuditPermission(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && !(user.permissionCodes ?? []).includes(permissionCode)) {
    throw new ForbiddenError("当前账号没有审计日志权限");
  }
  return user;
}

export async function auditLogRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();
  const querySchema = paginationQuerySchema.extend({
    projectId: z.uuid("项目 ID 格式不正确").optional(),
    action: z.string().max(120).optional(),
    actorUserId: z.uuid("用户 ID 格式不正确").optional(),
    targetType: z.string().max(80).optional(),
    keyword: z.string().trim().max(120).optional()
  });

  route.get("/audit-logs", { preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 审计监控"], summary: "查询审计日志", querystring: querySchema } }, async (request) => {
    requireAuditPermission(request, "monitor:audit:list");
    const { skip, take } = getPagination(request.query.page, request.query.pageSize);
    const where = and(
      request.query.projectId ? eq(auditLogs.projectId, request.query.projectId) : undefined,
      request.query.action ? eq(auditLogs.action, request.query.action) : undefined,
      request.query.actorUserId ? eq(auditLogs.actorUserId, request.query.actorUserId) : undefined,
      request.query.targetType ? eq(auditLogs.targetType, request.query.targetType) : undefined,
      request.query.keyword ? ilike(auditLogs.action, `%${request.query.keyword}%`) : undefined
    );
    const [items, [totalRow]] = await Promise.all([
      app.db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).offset(skip).limit(take),
      app.db.select({ value: count() }).from(auditLogs).where(where)
    ]);
    return ok(request, { items, total: totalRow?.value ?? 0, page: request.query.page, pageSize: request.query.pageSize });
  });

  route.get("/audit-logs/export", { preHandler: [app.authenticate], schema: { tags: ["B端 / 平台 / 审计监控"], summary: "导出操作日志", querystring: paginationQuerySchema } }, async (request, reply) => {
    requireAuditPermission(request, "monitor:audit:export");
    const rows = await app.db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(10000);
    const escape = (value: unknown) => { const text = value == null ? "" : String(value); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
    const csv = ["时间,用户,动作,目标类型,目标 ID,请求 IP", ...rows.map((row) => [row.createdAt.toISOString(), row.actorUserId, row.action, row.targetType, row.targetId, row.ip].map(escape).join(","))].join("\n");
    return reply.type("text/csv; charset=utf-8").send(`\uFEFF${csv}`);
  });
}

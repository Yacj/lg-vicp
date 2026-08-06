/**
 * B 端 AI 对话围栏（敏感词）管理路由：/api/v1/platform/ai/filters。
 * 按 system:ai:filter:* 权限码授权，超级管理员直通；所有写入与审计同事务。
 */
import { and, count, desc, eq, ilike } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { aiContentFilters } from "../../db/schema.js";
import { AI_SCENES } from "../../shared/constants.js";
import { AI_PERMISSIONS } from "../../shared/ai-permissions.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { getPagination, paginationQuerySchema } from "../../shared/pagination.js";
import { ok } from "../../shared/response.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { CONTENT_FILTER_MATCH_TYPES } from "../ai/ai-content-filter.service.js";

const filterParamsSchema = z.object({ id: z.uuid("词条 ID 格式不正确") });

const sceneCodesSchema = z.array(z.enum(Object.values(AI_SCENES) as [string, ...string[]]))
  .max(20, "生效场景不能超过 20 个")
  .optional();

const filterBodySchema = z.object({
  keyword: z.string().trim().min(1, "请输入关键词").max(100, "关键词不能超过 100 个字符"),
  matchType: z.enum(CONTENT_FILTER_MATCH_TYPES).default("CONTAINS"),
  sceneCodes: sceneCodesSchema,
  hitMessage: z.string().trim().max(200, "提示语不能超过 200 个字符").optional(),
  enabled: z.boolean().default(true)
}).superRefine((value, context) => {
  if (value.matchType === "REGEX") {
    try {
      new RegExp(value.keyword, "iu");
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["keyword"], message: "正则表达式格式不正确" });
    }
  }
});

const filterListQuerySchema = paginationQuerySchema.extend({
  keyword: z.string().trim().max(100).optional(),
  matchType: z.enum(CONTENT_FILTER_MATCH_TYPES).optional(),
  enabled: z.stringbool().optional()
});

function requireFilterAdmin(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && (user.permissionCodes ?? []).includes(permissionCode)) return user;
  if (user.role !== "SUPER_ADMIN") throw new ForbiddenError("当前账号没有对话围栏管理权限");
  return user;
}

export async function aiFilterRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/ai/filters", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI配置"],
      summary: "获取 AI 对话围栏词条列表",
      querystring: filterListQuerySchema
    }
  }, async (request) => {
    requireFilterAdmin(request, AI_PERMISSIONS.FILTER_LIST);
    const { skip, take } = getPagination(request.query.page, request.query.pageSize);
    const keyword = request.query.keyword?.replace(/[\\%_]/g, (value) => `\\${value}`);
    const where = and(
      request.query.keyword ? ilike(aiContentFilters.keyword, `%${keyword}%`) : undefined,
      request.query.matchType ? eq(aiContentFilters.matchType, request.query.matchType) : undefined,
      request.query.enabled === undefined ? undefined : eq(aiContentFilters.enabled, request.query.enabled)
    );
    const [rows, [totalRow]] = await Promise.all([
      app.db.select().from(aiContentFilters)
        .where(where)
        .orderBy(desc(aiContentFilters.createdAt))
        .offset(skip)
        .limit(take),
      app.db.select({ value: count() }).from(aiContentFilters).where(where)
    ]);
    return ok(request, {
      items: rows,
      total: totalRow?.value ?? 0,
      page: request.query.page,
      pageSize: request.query.pageSize
    });
  });

  route.post("/ai/filters", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI配置"],
      summary: "新增 AI 对话围栏词条",
      body: filterBodySchema
    }
  }, async (request) => {
    const actor = requireFilterAdmin(request, AI_PERMISSIONS.FILTER_CREATE);
    const [duplicate] = await app.db.select({ id: aiContentFilters.id }).from(aiContentFilters)
      .where(eq(aiContentFilters.keyword, request.body.keyword)).limit(1);
    if (duplicate) throw new ConflictError("相同关键词的词条已存在，请修改关键词或编辑原词条");

    const created = await app.db.transaction(async (tx) => {
      const [row] = await tx.insert(aiContentFilters).values({
        keyword: request.body.keyword,
        matchType: request.body.matchType,
        sceneCodes: request.body.sceneCodes?.length ? request.body.sceneCodes : null,
        hitMessage: request.body.hitMessage,
        enabled: request.body.enabled,
        createdById: actor.id,
        updatedById: actor.id
      }).returning();
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_FILTER_CREATED,
        targetType: "ai_content_filter", targetId: row!.id, afterJson: row
      });
      return row!;
    });
    return ok(request, { message: "对话围栏词条创建成功", filter: created });
  });

  route.patch("/ai/filters/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI配置"],
      summary: "修改 AI 对话围栏词条",
      params: filterParamsSchema,
      body: filterBodySchema.partial().refine((value) => Object.keys(value).length > 0, "至少需要修改一个字段")
    }
  }, async (request) => {
    const actor = requireFilterAdmin(request, AI_PERMISSIONS.FILTER_UPDATE);
    const [before] = await app.db.select().from(aiContentFilters)
      .where(eq(aiContentFilters.id, request.params.id)).limit(1);
    if (!before) throw new NotFoundError("对话围栏词条不存在");
    if (request.body.keyword && request.body.keyword !== before.keyword) {
      const [duplicate] = await app.db.select({ id: aiContentFilters.id }).from(aiContentFilters)
        .where(and(eq(aiContentFilters.keyword, request.body.keyword), eq(aiContentFilters.enabled, true)))
        .limit(1);
      if (duplicate && duplicate.id !== before.id) throw new ConflictError("相同关键词的词条已存在");
    }

    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(aiContentFilters).set({
        keyword: request.body.keyword ?? before.keyword,
        matchType: request.body.matchType ?? before.matchType,
        sceneCodes: request.body.sceneCodes !== undefined
          ? (request.body.sceneCodes.length ? request.body.sceneCodes : null)
          : before.sceneCodes,
        hitMessage: request.body.hitMessage !== undefined ? request.body.hitMessage : before.hitMessage,
        enabled: request.body.enabled ?? before.enabled,
        updatedById: actor.id,
        updatedAt: new Date()
      }).where(eq(aiContentFilters.id, before.id)).returning();
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_FILTER_UPDATED,
        targetType: "ai_content_filter", targetId: before.id,
        beforeJson: before, afterJson: row
      });
      return row!;
    });
    return ok(request, { message: "对话围栏词条修改成功", filter: updated });
  });

  route.delete("/ai/filters/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI配置"],
      summary: "删除 AI 对话围栏词条",
      params: filterParamsSchema
    }
  }, async (request) => {
    const actor = requireFilterAdmin(request, AI_PERMISSIONS.FILTER_DELETE);
    const [before] = await app.db.select().from(aiContentFilters)
      .where(eq(aiContentFilters.id, request.params.id)).limit(1);
    if (!before) throw new NotFoundError("对话围栏词条不存在");
    await app.db.transaction(async (tx) => {
      await tx.delete(aiContentFilters).where(eq(aiContentFilters.id, before.id));
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_FILTER_DELETED,
        targetType: "ai_content_filter", targetId: before.id, beforeJson: before
      });
    });
    return ok(request, { message: "对话围栏词条已删除" });
  });
}
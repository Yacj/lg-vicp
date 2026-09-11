/**
 * B 端快捷提问管理：/api/v1/platform/ai/quick-prompts
 * 按 system:ai:quick-prompt:* 授权，超级管理员直通；写入与审计同事务，并清 C 端缓存。
 */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { aiQuickPrompts } from "../../db/schema.js";
import { AI_PERMISSIONS } from "../../shared/ai-permissions.js";
import {
  AI_QUICK_PROMPT_ACTION_TYPES,
  AI_QUICK_PROMPT_ICONS,
  AI_QUICK_PROMPT_POSITIONS,
  AUDIT_ACTIONS
} from "../../shared/constants.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError } from "../../shared/errors.js";
import { paginationQuerySchema } from "../../shared/pagination.js";
import { ok } from "../../shared/response.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import {
  assertQuickPromptTitleAvailable,
  getQuickPrompt,
  invalidateQuickPromptCache,
  listAdminQuickPrompts,
  type QuickPromptWriteInput
} from "./ai-quick-prompt.service.js";

const positionValues = [
  AI_QUICK_PROMPT_POSITIONS.AI_HOME,
  AI_QUICK_PROMPT_POSITIONS.PROJECT_AI
] as const;
const actionTypeValues = [
  AI_QUICK_PROMPT_ACTION_TYPES.AUTO,
  AI_QUICK_PROMPT_ACTION_TYPES.KNOWLEDGE,
  AI_QUICK_PROMPT_ACTION_TYPES.PROJECT,
  AI_QUICK_PROMPT_ACTION_TYPES.THERMAL,
  AI_QUICK_PROMPT_ACTION_TYPES.REPORT
] as const;

const idParamsSchema = z.object({ id: z.uuid("快捷提问 ID 格式不正确") });
const listQuerySchema = paginationQuerySchema.extend({
  keyword: z.string().trim().max(80).optional(),
  position: z.enum(positionValues).optional(),
  enabled: z.stringbool().optional()
});
const writeBodySchema = z.object({
  title: z.string().trim().min(1, "请输入标题").max(80, "标题不能超过 80 个字符"),
  description: z.string().trim().max(200, "说明不能超过 200 个字符").nullable().optional(),
  content: z.string().trim().min(1, "请输入发送给 AI 的文本").max(2000, "提问内容不能超过 2000 个字符"),
  position: z.enum(positionValues).default(AI_QUICK_PROMPT_POSITIONS.AI_HOME),
  icon: z.enum(AI_QUICK_PROMPT_ICONS).default("book"),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  enabled: z.boolean().default(true),
  actionType: z.enum(actionTypeValues).default(AI_QUICK_PROMPT_ACTION_TYPES.AUTO)
});
const patchBodySchema = writeBodySchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "至少需要修改一个字段"
);

function requireQuickPromptAdmin(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && (user.permissionCodes ?? []).includes(permissionCode)) return user;
  if (user.role !== "SUPER_ADMIN") throw new ForbiddenError("当前账号没有快捷提问管理权限");
  return user;
}

function toWriteInput(body: z.infer<typeof writeBodySchema>): QuickPromptWriteInput {
  return {
    title: body.title,
    description: body.description ?? null,
    content: body.content,
    position: body.position,
    icon: body.icon,
    sortOrder: body.sortOrder,
    enabled: body.enabled,
    actionType: body.actionType
  };
}

export async function aiQuickPromptAdminRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/ai/quick-prompts", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI配置"],
      summary: "获取 AI 快捷提问列表",
      querystring: listQuerySchema
    }
  }, async (request) => {
    requireQuickPromptAdmin(request, AI_PERMISSIONS.QUICK_PROMPT_LIST);
    const result = await listAdminQuickPrompts(app, request.query);
    return ok(request, result);
  });

  route.post("/ai/quick-prompts", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI配置"],
      summary: "新增 AI 快捷提问",
      body: writeBodySchema
    }
  }, async (request) => {
    const actor = requireQuickPromptAdmin(request, AI_PERMISSIONS.QUICK_PROMPT_CREATE);
    const input = toWriteInput(request.body);
    await assertQuickPromptTitleAvailable(app, input.position, input.title);
    const created = await app.db.transaction(async (tx) => {
      const [row] = await tx.insert(aiQuickPrompts).values({
        ...input,
        createdById: actor.id,
        updatedById: actor.id
      }).returning();
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_QUICK_PROMPT_CREATED,
        targetType: "ai_quick_prompt", targetId: row!.id, afterJson: row
      });
      return row!;
    });
    await invalidateQuickPromptCache(app);
    return ok(request, { message: "快捷提问创建成功", quickPrompt: created });
  });

  route.put("/ai/quick-prompts/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI配置"],
      summary: "修改 AI 快捷提问",
      params: idParamsSchema,
      body: patchBodySchema
    }
  }, async (request) => {
    const actor = requireQuickPromptAdmin(request, AI_PERMISSIONS.QUICK_PROMPT_UPDATE);
    const before = await getQuickPrompt(app, request.params.id);
    const nextPosition = request.body.position ?? before.position;
    const nextTitle = request.body.title ?? before.title;
    if (nextPosition !== before.position || nextTitle !== before.title) {
      await assertQuickPromptTitleAvailable(app, nextPosition, nextTitle, before.id);
    }
    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(aiQuickPrompts).set({
        title: nextTitle,
        description: request.body.description !== undefined ? request.body.description : before.description,
        content: request.body.content ?? before.content,
        position: nextPosition,
        icon: request.body.icon ?? before.icon,
        sortOrder: request.body.sortOrder ?? before.sortOrder,
        enabled: request.body.enabled ?? before.enabled,
        actionType: request.body.actionType ?? before.actionType,
        updatedById: actor.id,
        updatedAt: new Date()
      }).where(eq(aiQuickPrompts.id, before.id)).returning();
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_QUICK_PROMPT_UPDATED,
        targetType: "ai_quick_prompt", targetId: before.id,
        beforeJson: before, afterJson: row
      });
      return row!;
    });
    await invalidateQuickPromptCache(app);
    return ok(request, { message: "快捷提问修改成功", quickPrompt: updated });
  });

  route.delete("/ai/quick-prompts/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI配置"],
      summary: "删除 AI 快捷提问",
      params: idParamsSchema
    }
  }, async (request) => {
    const actor = requireQuickPromptAdmin(request, AI_PERMISSIONS.QUICK_PROMPT_DELETE);
    const before = await getQuickPrompt(app, request.params.id);
    await app.db.transaction(async (tx) => {
      await tx.delete(aiQuickPrompts).where(eq(aiQuickPrompts.id, before.id));
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_QUICK_PROMPT_DELETED,
        targetType: "ai_quick_prompt", targetId: before.id, beforeJson: before
      });
    });
    await invalidateQuickPromptCache(app);
    return ok(request, { message: "快捷提问已删除" });
  });

  route.post("/ai/quick-prompts/:id/enable", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI配置"],
      summary: "启用 AI 快捷提问",
      params: idParamsSchema
    }
  }, async (request) => {
    const actor = requireQuickPromptAdmin(request, AI_PERMISSIONS.QUICK_PROMPT_UPDATE);
    const before = await getQuickPrompt(app, request.params.id);
    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(aiQuickPrompts).set({
        enabled: true, updatedById: actor.id, updatedAt: new Date()
      }).where(eq(aiQuickPrompts.id, before.id)).returning();
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_QUICK_PROMPT_ENABLED,
        targetType: "ai_quick_prompt", targetId: before.id,
        beforeJson: { enabled: before.enabled }, afterJson: { enabled: true }
      });
      return row!;
    });
    await invalidateQuickPromptCache(app);
    return ok(request, { message: "快捷提问已启用", quickPrompt: updated });
  });

  route.post("/ai/quick-prompts/:id/disable", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI配置"],
      summary: "停用 AI 快捷提问",
      params: idParamsSchema
    }
  }, async (request) => {
    const actor = requireQuickPromptAdmin(request, AI_PERMISSIONS.QUICK_PROMPT_UPDATE);
    const before = await getQuickPrompt(app, request.params.id);
    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(aiQuickPrompts).set({
        enabled: false, updatedById: actor.id, updatedAt: new Date()
      }).where(eq(aiQuickPrompts.id, before.id)).returning();
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_QUICK_PROMPT_DISABLED,
        targetType: "ai_quick_prompt", targetId: before.id,
        beforeJson: { enabled: before.enabled }, afterJson: { enabled: false }
      });
      return row!;
    });
    await invalidateQuickPromptCache(app);
    return ok(request, { message: "快捷提问已停用", quickPrompt: updated });
  });
}

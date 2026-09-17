import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getCurrentUser } from "../../shared/current-user.js";
import { ok } from "../../shared/response.js";
import { projectParamsSchema } from "../projects/project.schemas.js";
import {
  MEMORY_TYPES,
  assertProjectMemoryAccess,
  confirmProjectMemory,
  deleteProjectMemory,
  listProjectMemories,
  refreshProjectMemoryFromConversation,
  rejectProjectMemory,
  updateProjectMemory
} from "./ai-project-memory.service.js";
import { aiConversations } from "../../db/schema.js";
import { and, desc, eq } from "drizzle-orm";
import { NotFoundError } from "../../shared/errors.js";

const memoryParamsSchema = projectParamsSchema.extend({
  memoryId: z.uuid("记忆 ID 格式不正确")
});
const memoryQuerySchema = z.object({
  view: z.enum(["active", "pending", "history"]).default("active")
});
const updateMemoryBodySchema = z.object({
  title: z.string().trim().max(160).nullable().optional(),
  content: z.string().trim().min(1).max(4000).optional(),
  memoryType: z.enum(MEMORY_TYPES).optional()
}).refine((value) => Object.keys(value).length > 0, "至少需要修改一个字段");
const refreshMemoryBodySchema = z.object({
  conversationId: z.uuid("会话 ID 格式不正确").optional()
});

export async function projectAiMemoryRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/projects/:id/ai-memories", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / 项目"],
      summary: "获取项目 AI 长期记忆",
      params: projectParamsSchema,
      querystring: memoryQuerySchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    await assertProjectMemoryAccess(app, user, request.params.id, "view");
    const items = await listProjectMemories(app, request.params.id, { view: request.query.view });
    return ok(request, { items, view: request.query.view });
  });

  route.post("/projects/:id/ai-memories/refresh", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / 项目"],
      summary: "从会话手动刷新项目记忆候选",
      params: projectParamsSchema,
      body: refreshMemoryBodySchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    await assertProjectMemoryAccess(app, user, request.params.id, "manage");
    const conversationId = request.body.conversationId ?? (await app.db.select({ id: aiConversations.id })
      .from(aiConversations)
      .where(and(eq(aiConversations.projectId, request.params.id), eq(aiConversations.userId, user.id)))
      .orderBy(desc(aiConversations.updatedAt))
      .limit(1))[0]?.id;
    if (!conversationId) throw new NotFoundError("没有可用于整理记忆的会话");
    const items = await refreshProjectMemoryFromConversation(app, conversationId, user, request);
    return ok(request, { message: "项目记忆已刷新", items });
  });

  route.put("/projects/:id/ai-memories/:memoryId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / 项目"],
      summary: "更新项目记忆",
      params: memoryParamsSchema,
      body: updateMemoryBodySchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const memory = await updateProjectMemory(app, request, user, request.params.memoryId, request.body);
    if (memory.projectId !== request.params.id) throw new NotFoundError("项目记忆不存在");
    return ok(request, { message: "项目记忆已更新", memory });
  });

  route.post("/projects/:id/ai-memories/:memoryId/confirm", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / 项目"],
      summary: "确认项目记忆",
      params: memoryParamsSchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const memory = await confirmProjectMemory(app, request, user, request.params.memoryId);
    if (memory.projectId !== request.params.id) throw new NotFoundError("项目记忆不存在");
    return ok(request, { message: "项目记忆已确认", memory });
  });

  route.post("/projects/:id/ai-memories/:memoryId/reject", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / 项目"],
      summary: "驳回项目记忆",
      params: memoryParamsSchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const memory = await rejectProjectMemory(app, request, user, request.params.memoryId);
    if (memory.projectId !== request.params.id) throw new NotFoundError("项目记忆不存在");
    return ok(request, { message: "项目记忆已驳回", memory });
  });

  route.delete("/projects/:id/ai-memories/:memoryId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / 项目"],
      summary: "删除项目记忆（软状态 REJECTED，保留审计）",
      params: memoryParamsSchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const memory = await deleteProjectMemory(app, request, user, request.params.memoryId);
    if (memory.projectId !== request.params.id) throw new NotFoundError("项目记忆不存在");
    return ok(request, { message: "项目记忆已删除", memory });
  });
}

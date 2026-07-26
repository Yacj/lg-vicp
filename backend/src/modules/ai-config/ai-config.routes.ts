import { generateText } from "ai";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { aiModels, aiProviders, aiSceneBindings, promptTemplates } from "../../db/schema.js";
import { AI_SCENES, AUDIT_ACTIONS } from "../../shared/constants.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { ok } from "../../shared/response.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { encryptSecret } from "./ai-config.crypto.js";
import { resolveModelById } from "./ai-config.service.js";

const providerBodySchema = z.object({
  name: z.string().trim().min(1, "请输入服务商名称").max(120),
  baseUrl: z.url("Base URL 格式不正确"),
  apiKey: z.string().min(1, "请输入 API Key").optional(),
  enabled: z.boolean().default(true)
});
const providerParamsSchema = z.object({ id: z.uuid("服务商 ID 格式不正确") });
const modelParamsSchema = z.object({ id: z.uuid("模型 ID 格式不正确") });
const modelBodySchema = z.object({
  providerId: z.uuid("服务商 ID 格式不正确"),
  displayName: z.string().trim().min(1, "请输入模型显示名称").max(120),
  modelId: z.string().trim().min(1, "请输入模型标识").max(160),
  capabilities: z.record(z.string(), z.boolean()).default({ text: true, streaming: true }),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  defaultTemperature: z.number().min(0).max(2).optional(),
  timeoutMs: z.number().int().min(1000).max(300000).default(60000),
  enabled: z.boolean().default(true)
});
const sceneSchema = z.enum([
  AI_SCENES.GENERAL_CHAT,
  AI_SCENES.PROJECT_DESIGN,
  AI_SCENES.MATERIAL_COMPARE,
  AI_SCENES.STANDARD_QA,
  AI_SCENES.REPORT_GENERATE,
  AI_SCENES.INFORMATION_EXTRACT
]);
const sceneBindingBodySchema = z.object({
  scene: sceneSchema,
  primaryModelId: z.uuid("主模型 ID 格式不正确"),
  fallbackModelId: z.uuid("备用模型 ID 格式不正确").nullable().optional(),
  promptTemplateId: z.uuid("提示词模板 ID 格式不正确").nullable().optional(),
  settings: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true)
});
const promptBodySchema = z.object({
  scene: sceneSchema,
  name: z.string().trim().min(1, "请输入提示词名称").max(120),
  version: z.number().int().positive(),
  systemPrompt: z.string().trim().min(10, "系统提示词至少需要 10 个字符"),
  enabled: z.boolean().default(true)
});

function requireAdmin(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && (user.permissionCodes ?? []).includes(permissionCode)) return user;
  if (user.role !== "SUPER_ADMIN") throw new ForbiddenError("当前账号没有 AI 配置权限");
  return user;
}

function publicProvider(provider: typeof aiProviders.$inferSelect) {
  const { apiKeyCiphertext, apiKeyIv, apiKeyTag, ...safe } = provider;
  return { ...safe, hasApiKey: Boolean(apiKeyCiphertext && apiKeyIv && apiKeyTag) };
}

export async function aiConfigRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/ai/providers", {
    preHandler: [app.authenticate],
    schema: { tags: ["AI 配置"], summary: "获取 AI 服务商列表" }
  }, async (request) => {
    requireAdmin(request, "system:ai:provider:list");
    const items = await app.db.select().from(aiProviders).orderBy(desc(aiProviders.createdAt));
    return ok(request, { items: items.map(publicProvider) });
  });

  route.post("/ai/providers", {
    preHandler: [app.authenticate],
    schema: { tags: ["AI 配置"], summary: "创建 AI 服务商", body: providerBodySchema }
  }, async (request) => {
    const actor = requireAdmin(request, "system:ai:provider:add");
    const encrypted = request.body.apiKey ? encryptSecret(request.body.apiKey) : undefined;
    const provider = await app.db.transaction(async (tx) => {
      const [created] = await tx.insert(aiProviders).values({
        name: request.body.name,
        baseUrl: request.body.baseUrl,
        enabled: request.body.enabled,
        apiKeyCiphertext: encrypted?.ciphertext,
        apiKeyIv: encrypted?.iv,
        apiKeyTag: encrypted?.tag,
        createdById: actor.id,
        updatedById: actor.id
      }).returning();
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_PROVIDER_CREATED,
        targetType: "ai_provider", targetId: created!.id,
        afterJson: { ...publicProvider(created!), apiKey: undefined }
      });
      return created!;
    });
    return ok(request, { message: "AI 服务商创建成功", provider: publicProvider(provider) });
  });

  route.patch("/ai/providers/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["AI 配置"], summary: "修改 AI 服务商", params: providerParamsSchema, body: providerBodySchema.partial() }
  }, async (request) => {
    const actor = requireAdmin(request, "system:ai:provider:edit");
    const [before] = await app.db.select().from(aiProviders).where(eq(aiProviders.id, request.params.id)).limit(1);
    if (!before) throw new NotFoundError("AI 服务商不存在");
    const encrypted = request.body.apiKey ? encryptSecret(request.body.apiKey) : undefined;
    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(aiProviders).set({
        name: request.body.name,
        baseUrl: request.body.baseUrl,
        enabled: request.body.enabled,
        apiKeyCiphertext: encrypted?.ciphertext ?? before.apiKeyCiphertext,
        apiKeyIv: encrypted?.iv ?? before.apiKeyIv,
        apiKeyTag: encrypted?.tag ?? before.apiKeyTag,
        updatedById: actor.id,
        updatedAt: new Date()
      }).where(eq(aiProviders.id, before.id)).returning();
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_PROVIDER_UPDATED,
        targetType: "ai_provider", targetId: before.id,
        beforeJson: publicProvider(before), afterJson: publicProvider(row!)
      });
      return row!;
    });
    return ok(request, { message: "AI 服务商修改成功", provider: publicProvider(updated) });
  });

  route.delete("/ai/providers/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["AI 配置"], summary: "删除 AI 服务商", params: providerParamsSchema }
  }, async (request) => {
    const actor = requireAdmin(request, "system:ai:provider:remove");
    const [provider] = await app.db.delete(aiProviders).where(eq(aiProviders.id, request.params.id)).returning();
    if (!provider) throw new NotFoundError("AI 服务商不存在");
    await writeAuditLog({ db: app.db, request, actor, action: "ai.provider_deleted", targetType: "ai_provider", targetId: provider.id, beforeJson: publicProvider(provider) });
    return ok(request, { message: "AI 服务商删除成功" });
  });

  route.get("/ai/models", {
    preHandler: [app.authenticate],
    schema: { tags: ["AI 配置"], summary: "获取 AI 模型列表" }
  }, async (request) => {
    requireAdmin(request, "system:ai:model:list");
    const items = await app.db.select().from(aiModels).orderBy(desc(aiModels.createdAt));
    return ok(request, { items });
  });

  route.post("/ai/models", {
    preHandler: [app.authenticate],
    schema: { tags: ["AI 配置"], summary: "创建 AI 模型", body: modelBodySchema }
  }, async (request) => {
    const actor = requireAdmin(request, "system:ai:model:add");
    const [provider] = await app.db.select({ id: aiProviders.id }).from(aiProviders).where(eq(aiProviders.id, request.body.providerId)).limit(1);
    if (!provider) throw new NotFoundError("关联的 AI 服务商不存在");
    const model = await app.db.transaction(async (tx) => {
      const [created] = await tx.insert(aiModels).values(request.body).returning();
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_MODEL_CREATED,
        targetType: "ai_model", targetId: created!.id, afterJson: created
      });
      return created!;
    });
    return ok(request, { message: "AI 模型创建成功", model });
  });

  route.patch("/ai/models/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["AI 配置"],
      summary: "修改 AI 模型",
      params: modelParamsSchema,
      body: modelBodySchema.partial().refine((value) => Object.keys(value).length > 0, "至少需要修改一个字段")
    }
  }, async (request) => {
    const actor = requireAdmin(request, "system:ai:model:edit");
    const [before] = await app.db.select().from(aiModels).where(eq(aiModels.id, request.params.id)).limit(1);
    if (!before) throw new NotFoundError("AI 模型不存在");
    if (request.body.providerId) {
      const [provider] = await app.db.select({ id: aiProviders.id }).from(aiProviders)
        .where(eq(aiProviders.id, request.body.providerId)).limit(1);
      if (!provider) throw new NotFoundError("关联的 AI 服务商不存在");
    }
    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(aiModels).set({ ...request.body, updatedAt: new Date() })
        .where(eq(aiModels.id, before.id)).returning();
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_MODEL_UPDATED,
        targetType: "ai_model", targetId: before.id, beforeJson: before, afterJson: row
      });
      return row!;
    });
    return ok(request, { message: "AI 模型修改成功", model: updated });
  });

  route.delete("/ai/models/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["AI 配置"], summary: "删除 AI 模型", params: modelParamsSchema }
  }, async (request) => {
    const actor = requireAdmin(request, "system:ai:model:remove");
    const [model] = await app.db.delete(aiModels).where(eq(aiModels.id, request.params.id)).returning();
    if (!model) throw new NotFoundError("AI 模型不存在");
    await writeAuditLog({ db: app.db, request, actor, action: "ai.model_deleted", targetType: "ai_model", targetId: model.id, beforeJson: model });
    return ok(request, { message: "AI 模型删除成功" });
  });

  route.post("/ai/models/:id/test-connection", {
    preHandler: [app.authenticate],
    schema: { tags: ["AI 配置"], summary: "测试 AI 模型连接", params: modelParamsSchema }
  }, async (request) => {
    const actor = requireAdmin(request, "system:ai:model:test");
    const [model] = await app.db.select().from(aiModels).where(eq(aiModels.id, request.params.id)).limit(1);
    if (!model) throw new NotFoundError("AI 模型不存在");
    try {
      const resolved = await resolveModelById(app.db, model.id);
      const result = await generateText({
        model: resolved.languageModel,
        prompt: "这是一次连接测试。请只回复：连接成功。",
        maxOutputTokens: 16,
        temperature: 0
      });
      await writeAuditLog({
        db: app.db, request, actor, action: AUDIT_ACTIONS.AI_CONNECTION_TESTED,
        targetType: "ai_model", targetId: model.id, afterJson: { success: true }
      });
      return ok(request, { message: "模型连接测试成功", response: result.text });
    } catch (error) {
      await writeAuditLog({
        db: app.db, request, actor, action: AUDIT_ACTIONS.AI_CONNECTION_TESTED,
        targetType: "ai_model", targetId: model.id, afterJson: { success: false }
      });
      throw error;
    }
  });

  route.get("/ai/scene-bindings", {
    preHandler: [app.authenticate],
    schema: { tags: ["AI 配置"], summary: "获取 AI 场景绑定" }
  }, async (request) => {
    requireAdmin(request, "system:ai:scene:list");
    return ok(request, { items: await app.db.select().from(aiSceneBindings).orderBy(aiSceneBindings.scene) });
  });

  route.put("/ai/scene-bindings", {
    preHandler: [app.authenticate],
    schema: { tags: ["AI 配置"], summary: "设置 AI 场景主模型", body: sceneBindingBodySchema }
  }, async (request) => {
    const actor = requireAdmin(request, "system:ai:scene:edit");
    const binding = await app.db.transaction(async (tx) => {
      const [row] = await tx.insert(aiSceneBindings).values(request.body).onConflictDoUpdate({
        target: aiSceneBindings.scene,
        set: { ...request.body, updatedAt: new Date() }
      }).returning();
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_SCENE_BOUND,
        targetType: "ai_scene_binding", targetId: row!.id, afterJson: row
      });
      return row!;
    });
    return ok(request, { message: "AI 场景绑定成功", binding });
  });

  route.get("/ai/prompts", {
    preHandler: [app.authenticate],
    schema: { tags: ["AI 配置"], summary: "获取提示词版本" }
  }, async (request) => {
    requireAdmin(request, "system:ai:prompt:list");
    return ok(request, { items: await app.db.select().from(promptTemplates).orderBy(desc(promptTemplates.createdAt)) });
  });

  route.post("/ai/prompts", {
    preHandler: [app.authenticate],
    schema: { tags: ["AI 配置"], summary: "创建提示词版本", body: promptBodySchema }
  }, async (request) => {
    const actor = requireAdmin(request, "system:ai:prompt:add");
    const [prompt] = await app.db.insert(promptTemplates).values({ ...request.body, createdById: actor.id }).returning();
    return ok(request, { message: "提示词版本创建成功", prompt });
  });

  route.delete("/ai/prompts/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["AI 配置"], summary: "删除提示词版本", params: providerParamsSchema }
  }, async (request) => {
    const actor = requireAdmin(request, "system:ai:prompt:remove");
    const [prompt] = await app.db.delete(promptTemplates).where(eq(promptTemplates.id, request.params.id)).returning();
    if (!prompt) throw new NotFoundError("提示词版本不存在");
    await writeAuditLog({ db: app.db, request, actor, action: "ai.prompt_deleted", targetType: "prompt_template", targetId: prompt.id, beforeJson: prompt });
    return ok(request, { message: "提示词版本删除成功" });
  });
}

import { and, count, desc, eq, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { aiModels, aiProviders, aiScenes, prompts, promptVersions } from "../../db/schema.js";
import { AI_PERMISSIONS } from "../../shared/ai-permissions.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { ok } from "../../shared/response.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { decryptSecret, encryptSecret, maskSecret } from "./ai-config.crypto.js";
import {
  assertSceneModelUsable,
  clearOtherDefaultModels,
  createPromptDraft,
  deletePromptDraftVersion,
  deletePromptIfUnpublished,
  disablePrompt,
  invalidateModelsForProvider,
  listScenes,
  publishPromptVersion,
  rollbackPromptVersion,
  testProviderConnection,
  toPublicModelAudit,
  toPublicModelConfig,
  updatePromptDraft
} from "./ai-config.service.js";
import { testModelAdmission } from "./ai-model-test.service.js";
import { assertCanEnableOrDefault, shouldInvalidateAdmission, invalidatedAdmissionPatch } from "./ai-model-runtime.js";
import { REASONING_LEVELS } from "./ai-reasoning.js";

const optionalString = z.preprocess((value) => (value === "" ? undefined : value), z.string().optional());

const providerBodySchema = z.object({
  code: z.string().trim().min(1, "请输入服务商编码").max(80).optional(),
  name: z.string().trim().min(1, "请输入服务商名称").max(120),
  description: z.string().trim().max(500).optional(),
  baseUrl: z.url("Base URL 格式不正确"),
  apiKey: optionalString,
  timeoutMs: z.number().int().min(1000).max(300000).optional(),
  priority: z.number().int().min(0).max(9999).optional(),
  enabled: z.boolean().default(true)
});
const providerParamsSchema = z.object({ id: z.uuid("服务商 ID 格式不正确") });
const modelParamsSchema = z.object({ id: z.uuid("模型 ID 格式不正确") });

const modelBodySchema = z.object({
  providerId: z.uuid("服务商 ID 格式不正确"),
  name: z.string().trim().min(1, "请输入模型名称").max(120).optional(),
  displayName: z.string().trim().min(1, "请输入模型显示名称").max(120).optional(),
  modelId: z.string().trim().min(1, "请输入模型标识").max(160),
  description: z.string().trim().max(500).optional(),
  supportsVision: z.boolean().default(false),
  reasoningLevel: z.enum(REASONING_LEVELS).default("HIGH"),
  enabled: z.boolean().default(false),
  isDefault: z.boolean().default(false)
}).superRefine((value, ctx) => {
  if (!value.name && !value.displayName) {
    ctx.addIssue({ code: "custom", message: "请输入模型名称", path: ["name"] });
  }
});
const modelPatchBodySchema = z.object({
  providerId: z.uuid("服务商 ID 格式不正确").optional(),
  name: z.string().trim().min(1, "请输入模型名称").max(120).optional(),
  displayName: z.string().trim().min(1, "请输入模型显示名称").max(120).optional(),
  modelId: z.string().trim().min(1, "请输入模型标识").max(160).optional(),
  description: z.string().trim().max(500).optional(),
  supportsVision: z.boolean().optional(),
  reasoningLevel: z.enum(REASONING_LEVELS).optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, "至少需要修改一个字段");

const sceneBodySchema = z.object({
  scene: z.string().trim().min(1, "请输入场景编码").max(80),
  name: z.string().trim().min(1, "请输入场景名称").max(120).optional(),
  description: z.string().trim().max(500).optional(),
  primaryModelId: z.uuid("主模型 ID 格式不正确").nullable().optional(),
  reasoningModelId: z.uuid("推理模型 ID 格式不正确").nullable().optional(),
  fallbackModelId: z.uuid("备用模型 ID 格式不正确").nullable().optional(),
  promptTemplateId: z.uuid("提示词 ID 格式不正确").nullable().optional(),
  allowReasoning: z.boolean().optional(),
  requireProject: z.boolean().optional(),
  allowFileUpload: z.boolean().optional(),
  allowKnowledgeSearch: z.boolean().optional(),
  allowTools: z.boolean().optional(),
  sort: z.number().int().min(0).max(9999).optional(),
  visibility: z.enum(["USER", "INTERNAL", "ADMIN"]).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional()
});

const promptCreateBodySchema = z.object({
  scene: z.string().trim().min(1, "请输入场景编码").max(80),
  name: z.string().trim().min(1, "请输入提示词名称").max(120),
  description: z.string().trim().max(500).optional(),
  systemPrompt: z.string().trim().min(10, "系统提示词至少需要 10 个字符"),
  changeNote: z.string().trim().max(500).optional()
});
const promptDraftBodySchema = z.object({
  name: z.string().trim().min(1, "请输入提示词名称").max(120).optional(),
  description: z.string().trim().max(500).optional(),
  systemPrompt: z.string().trim().min(10, "系统提示词至少需要 10 个字符"),
  changeNote: z.string().trim().max(500).optional()
});
const promptParamsSchema = z.object({ id: z.uuid("提示词 ID 格式不正确") });
const promptVersionParamsSchema = z.object({ id: z.uuid("提示词 ID 格式不正确"), versionId: z.uuid("版本 ID 格式不正确") });
const compareQuerySchema = z.object({
  from: z.uuid("版本 ID 格式不正确"),
  to: z.uuid("版本 ID 格式不正确")
});

function requireAdmin(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && (user.permissionCodes ?? []).includes(permissionCode)) return user;
  if (user.role !== "SUPER_ADMIN") throw new ForbiddenError("当前账号没有 AI 配置权限");
  return user;
}

function requireModelAdmin(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = requireAdmin(request, permissionCode);
  if (user.role !== "SUPER_ADMIN") {
    throw new ForbiddenError("仅超级管理员可以新增、编辑、测试、启停或设默认 AI 模型");
  }
  return user;
}

/** B 端安全的服务商视图：剔除密钥密文，仅返回脱敏值与 hasApiKey */
function publicProvider(provider: typeof aiProviders.$inferSelect) {
  const { apiKeyCiphertext, apiKeyIv, apiKeyTag, ...safe } = provider;
  let maskedApiKey = "";
  if (apiKeyCiphertext && apiKeyIv && apiKeyTag) {
    try {
      maskedApiKey = maskSecret(decryptSecret(apiKeyCiphertext, apiKeyIv, apiKeyTag));
    } catch {
      maskedApiKey = "";
    }
  }
  return { ...safe, hasApiKey: Boolean(maskedApiKey), apiKeyMasked: maskedApiKey };
}

/** 场景配置的兼容视图：保留旧字段名，同时输出完整新字段 */
function publicScene(row: Awaited<ReturnType<typeof listScenes>>[number]) {
  return {
    id: row.scene.id,
    scene: row.scene.code,
    name: row.scene.name,
    description: row.scene.description,
    primaryModelId: row.scene.defaultModelId,
    defaultModelId: row.scene.defaultModelId,
    defaultModelName: row.defaultModel?.displayName ?? null,
    reasoningModelId: row.scene.reasoningModelId,
    reasoningModelName: row.reasoningModel?.displayName ?? null,
    fallbackModelId: row.scene.fallbackModelId,
    fallbackModelName: row.fallbackModel?.displayName ?? null,
    promptTemplateId: row.scene.promptId,
    promptId: row.scene.promptId,
    allowReasoning: row.scene.allowReasoning,
    requireProject: row.scene.requireProject,
    allowFileUpload: row.scene.allowFileUpload,
    allowKnowledgeSearch: row.scene.allowKnowledgeSearch,
    allowTools: row.scene.allowTools,
    temperature: row.scene.temperature,
    maxOutputTokens: row.scene.maxOutputTokens,
    visibility: row.scene.visibility,
    enabled: row.scene.enabled,
    sort: row.scene.sort,
    settings: {},
    activePromptVersionId: row.prompt?.activeVersionId ?? null,
    activePromptVersion: row.activeVersion?.version ?? null
  };
}

export async function aiConfigRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // ============ Provider ============

  route.get("/ai/providers", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "获取 AI 服务商列表" }
  }, async (request) => {
    requireAdmin(request, AI_PERMISSIONS.PROVIDER_LIST);
    const items = await app.db.select().from(aiProviders).orderBy(desc(aiProviders.priority), desc(aiProviders.createdAt));
    return ok(request, { items: items.map(publicProvider) });
  });

  route.post("/ai/providers", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "创建 AI 服务商", body: providerBodySchema }
  }, async (request) => {
    const actor = requireAdmin(request, AI_PERMISSIONS.PROVIDER_CREATE);
    const encrypted = request.body.apiKey ? encryptSecret(request.body.apiKey) : undefined;
    const provider = await app.db.transaction(async (tx) => {
      const [created] = await tx.insert(aiProviders).values({
        code: request.body.code,
        name: request.body.name,
        description: request.body.description,
        baseUrl: request.body.baseUrl,
        enabled: request.body.enabled,
        timeoutMs: request.body.timeoutMs,
        priority: request.body.priority,
        apiKeyCiphertext: encrypted?.ciphertext,
        apiKeyIv: encrypted?.iv,
        apiKeyTag: encrypted?.tag,
        createdById: actor.id,
        updatedById: actor.id
      }).returning();
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_PROVIDER_CREATED,
        targetType: "ai_provider", targetId: created!.id,
        afterJson: publicProvider(created!)
      });
      return created!;
    });
    return ok(request, { message: "AI 服务商创建成功", provider: publicProvider(provider) });
  });

  route.patch("/ai/providers/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "修改 AI 服务商", params: providerParamsSchema, body: providerBodySchema.partial().refine((value) => Object.keys(value).length > 0, "至少需要修改一个字段") }
  }, async (request) => {
    const actor = requireAdmin(request, AI_PERMISSIONS.PROVIDER_UPDATE);
    const [before] = await app.db.select().from(aiProviders).where(eq(aiProviders.id, request.params.id)).limit(1);
    if (!before) throw new NotFoundError("AI 服务商不存在");
    const encrypted = request.body.apiKey ? encryptSecret(request.body.apiKey) : undefined;
    const identityChanged = Boolean(
      (request.body.baseUrl && request.body.baseUrl !== before.baseUrl)
      || encrypted
    );
    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(aiProviders).set({
        code: request.body.code ?? before.code,
        name: request.body.name ?? before.name,
        description: request.body.description ?? before.description,
        baseUrl: request.body.baseUrl ?? before.baseUrl,
        enabled: request.body.enabled ?? before.enabled,
        timeoutMs: request.body.timeoutMs ?? before.timeoutMs,
        priority: request.body.priority ?? before.priority,
        apiKeyCiphertext: encrypted?.ciphertext ?? before.apiKeyCiphertext,
        apiKeyIv: encrypted?.iv ?? before.apiKeyIv,
        apiKeyTag: encrypted?.tag ?? before.apiKeyTag,
        updatedById: actor.id,
        updatedAt: new Date()
      }).where(eq(aiProviders.id, before.id)).returning();
      if (identityChanged) {
        await invalidateModelsForProvider(tx, before.id);
      }
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
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "删除 AI 服务商", params: providerParamsSchema }
  }, async (request) => {
    const actor = requireAdmin(request, AI_PERMISSIONS.PROVIDER_DELETE);
    const [provider] = await app.db.select().from(aiProviders).where(eq(aiProviders.id, request.params.id)).limit(1);
    if (!provider) throw new NotFoundError("AI 服务商不存在");
    const [modelCount] = await app.db.select({ value: count() }).from(aiModels).where(eq(aiModels.providerId, provider.id));
    if ((modelCount?.value ?? 0) > 0) {
      throw new ConflictError("该服务商下仍有模型，请先删除模型后再删除服务商");
    }
    await app.db.delete(aiProviders).where(eq(aiProviders.id, provider.id));
    await writeAuditLog({ db: app.db, request, actor, action: "ai.provider_deleted", targetType: "ai_provider", targetId: provider.id, beforeJson: publicProvider(provider) });
    return ok(request, { message: "AI 服务商删除成功" });
  });

  route.post("/ai/providers/:id/test-connection", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "测试 AI 服务商连接", params: providerParamsSchema }
  }, async (request) => {
    const actor = requireAdmin(request, AI_PERMISSIONS.PROVIDER_TEST);
    const [provider] = await app.db.select().from(aiProviders).where(eq(aiProviders.id, request.params.id)).limit(1);
    if (!provider) throw new NotFoundError("AI 服务商不存在");
    try {
      const result = await testProviderConnection(app.db, provider.id);
      await writeAuditLog({
        db: app.db, request, actor, action: AUDIT_ACTIONS.AI_CONNECTION_TESTED,
        targetType: "ai_provider", targetId: provider.id, afterJson: { success: true, modelId: result.model }
      });
      return ok(request, { message: result.message, response: result.response, provider: publicProvider({ ...provider, lastTestStatus: "OK", lastTestAt: new Date() }) });
    } catch (error) {
      await writeAuditLog({
        db: app.db, request, actor, action: AUDIT_ACTIONS.AI_CONNECTION_TESTED,
        targetType: "ai_provider", targetId: provider.id, afterJson: { success: false }
      });
      throw error;
    }
  });

  // ============ Model ============

  route.get("/ai/models", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "获取 AI 模型列表" }
  }, async (request) => {
    requireAdmin(request, AI_PERMISSIONS.MODEL_LIST);
    const items = await app.db.select({
      model: aiModels,
      provider: aiProviders
    }).from(aiModels)
      .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
      .orderBy(desc(aiModels.isDefault), desc(aiModels.priority), desc(aiModels.createdAt));
    return ok(request, { items: items.map((row) => toPublicModelConfig(row.model, row.provider)) });
  });

  route.post("/ai/models", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "创建 AI 模型", body: modelBodySchema }
  }, async (request) => {
    const actor = requireModelAdmin(request, AI_PERMISSIONS.MODEL_CREATE);
    if (request.body.enabled || request.body.isDefault) {
      throw new ConflictError("新建模型必须先通过准入测试后才能启用或设为默认");
    }
    const [provider] = await app.db.select().from(aiProviders).where(eq(aiProviders.id, request.body.providerId)).limit(1);
    if (!provider) throw new NotFoundError("关联的 AI 服务商不存在");
    if (!provider.enabled) throw new ConflictError("关联的 AI 服务商已停用，不能添加模型");
    const displayName = request.body.name ?? request.body.displayName!;
    const model = await app.db.transaction(async (tx) => {
      const [created] = await tx.insert(aiModels).values({
        providerId: request.body.providerId,
        displayName,
        modelId: request.body.modelId,
        description: request.body.description,
        supportsVision: request.body.supportsVision,
        reasoningLevel: request.body.reasoningLevel,
        enabled: false,
        isDefault: false,
        lastTestStatus: "UNTESTED"
      }).returning();
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_MODEL_CREATED,
        targetType: "ai_model", targetId: created!.id, afterJson: toPublicModelAudit(toPublicModelConfig(created!, provider))
      });
      return created!;
    });
    return ok(request, { message: "AI 模型创建成功", model: toPublicModelConfig(model, provider) });
  });

  route.patch("/ai/models/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI配置"],
      summary: "修改 AI 模型",
      params: modelParamsSchema,
      body: modelPatchBodySchema
    }
  }, async (request) => {
    const actor = requireModelAdmin(request, AI_PERMISSIONS.MODEL_UPDATE);
    const [before] = await app.db.select().from(aiModels).where(eq(aiModels.id, request.params.id)).limit(1);
    if (!before) throw new NotFoundError("AI 模型不存在");
    if (request.body.providerId && request.body.providerId !== before.providerId) {
      const [provider] = await app.db.select().from(aiProviders)
        .where(eq(aiProviders.id, request.body.providerId)).limit(1);
      if (!provider) throw new NotFoundError("关联的 AI 服务商不存在");
      if (!provider.enabled) throw new ConflictError("关联的 AI 服务商已停用，不能迁移模型");
    }
    const identityChanged = shouldInvalidateAdmission(before, {
      providerId: request.body.providerId,
      modelId: request.body.modelId,
      supportsVision: request.body.supportsVision,
      reasoningLevel: request.body.reasoningLevel
    });
    const nextStatus = identityChanged ? "UNTESTED" as const : before.lastTestStatus;
    const wantsEnable = request.body.enabled === true;
    const wantsDefault = request.body.isDefault === true;
    if ((wantsEnable || wantsDefault) && nextStatus !== "PASSED") {
      throw new ConflictError(wantsDefault ? "设为默认模型前必须通过准入测试" : "启用模型前必须通过准入测试");
    }
    if (wantsDefault) assertCanEnableOrDefault({ lastTestStatus: nextStatus }, "default");

    const updated = await app.db.transaction(async (tx) => {
      const displayName = request.body.name ?? request.body.displayName;
      const [row] = await tx.update(aiModels).set({
        providerId: request.body.providerId ?? before.providerId,
        displayName: displayName ?? before.displayName,
        modelId: request.body.modelId ?? before.modelId,
        description: request.body.description ?? before.description,
        supportsVision: request.body.supportsVision ?? before.supportsVision,
        reasoningLevel: request.body.reasoningLevel ?? before.reasoningLevel,
        enabled: identityChanged ? false : (request.body.enabled ?? before.enabled),
        isDefault: identityChanged ? false : (request.body.isDefault ?? before.isDefault),
        ...(identityChanged ? invalidatedAdmissionPatch() : {}),
        updatedAt: new Date()
      }).where(eq(aiModels.id, before.id)).returning();
      if (row!.isDefault) {
        await clearOtherDefaultModels(tx, row!.id);
      }
      const [provider] = await tx.select().from(aiProviders).where(eq(aiProviders.id, row!.providerId)).limit(1);
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_MODEL_UPDATED,
        targetType: "ai_model", targetId: before.id,
        beforeJson: toPublicModelAudit(before),
        afterJson: toPublicModelAudit(toPublicModelConfig(row!, provider!))
      });
      return { row: row!, provider: provider! };
    });
    return ok(request, { message: "AI 模型修改成功", model: toPublicModelConfig(updated.row, updated.provider) });
  });

  route.delete("/ai/models/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "删除 AI 模型", params: modelParamsSchema }
  }, async (request) => {
    const actor = requireModelAdmin(request, AI_PERMISSIONS.MODEL_DELETE);
    const [model] = await app.db.select().from(aiModels).where(eq(aiModels.id, request.params.id)).limit(1);
    if (!model) throw new NotFoundError("AI 模型不存在");
    const [sceneBinding] = await app.db.select({ id: aiScenes.id }).from(aiScenes)
      .where(or(
        eq(aiScenes.defaultModelId, model.id),
        eq(aiScenes.reasoningModelId, model.id),
        eq(aiScenes.fallbackModelId, model.id)
      )).limit(1);
    if (sceneBinding) throw new ConflictError("该模型仍被场景绑定，请先调整场景配置后再删除");
    await app.db.delete(aiModels).where(eq(aiModels.id, model.id));
    await writeAuditLog({
      db: app.db, request, actor, action: "ai.model_deleted",
      targetType: "ai_model", targetId: model.id, beforeJson: toPublicModelAudit(model)
    });
    return ok(request, { message: "AI 模型删除成功" });
  });

  const testModelHandler = async (request: Parameters<typeof getCurrentUser>[0] & { params: { id: string } }, app: FastifyInstance) => {
    const actor = requireModelAdmin(request, AI_PERMISSIONS.MODEL_TEST);
    const [model] = await app.db.select().from(aiModels).where(eq(aiModels.id, request.params.id)).limit(1);
    if (!model) throw new NotFoundError("AI 模型不存在");
    const report = await testModelAdmission(app.db, model.id);
    await writeAuditLog({
      db: app.db, request, actor, action: AUDIT_ACTIONS.AI_CONNECTION_TESTED,
      targetType: "ai_model", targetId: model.id,
      afterJson: {
        ok: report.ok,
        modelId: model.modelId,
        supportsVision: model.supportsVision,
        reasoningLevel: model.reasoningLevel,
        checks: {
          connection: report.checks.connection.ok,
          text: report.checks.text.ok,
          toolCalling: report.checks.toolCalling.ok,
          reasoning: report.checks.reasoning.ok,
          vision: report.checks.vision?.ok ?? null
        }
      }
    });
    return ok(request, {
      ok: report.ok,
      message: report.ok ? "模型准入测试通过" : "模型准入测试未通过",
      checks: report.checks
    });
  };

  route.post("/ai/models/:id/test", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "测试 AI 模型准入（文本/工具/推理/视觉）", params: modelParamsSchema }
  }, async (request) => testModelHandler(request, app));

  route.post("/ai/models/:id/test-connection", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "测试 AI 模型准入（兼容旧路径）", params: modelParamsSchema }
  }, async (request) => testModelHandler(request, app));

  // ============ Scene ============

  route.get("/ai/scene-bindings", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "获取 AI 场景配置列表" }
  }, async (request) => {
    requireAdmin(request, AI_PERMISSIONS.SCENE_LIST);
    const rows = await listScenes(app.db);
    return ok(request, { items: rows.map(publicScene) });
  });

  route.put("/ai/scene-bindings", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "配置 AI 场景", body: sceneBodySchema }
  }, async (request) => {
    const actor = requireAdmin(request, AI_PERMISSIONS.SCENE_UPDATE);
    const [scene] = await app.db.select().from(aiScenes).where(eq(aiScenes.code, request.body.scene)).limit(1);
    if (!scene) throw new NotFoundError(`场景“${request.body.scene}”不存在`);

    if (request.body.primaryModelId !== undefined) {
      await assertSceneModelUsable(app.db, request.body.primaryModelId, "default");
    }
    if (request.body.reasoningModelId !== undefined) {
      await assertSceneModelUsable(app.db, request.body.reasoningModelId, "reasoning");
    }
    if (request.body.fallbackModelId !== undefined) {
      await assertSceneModelUsable(app.db, request.body.fallbackModelId, "fallback");
    }
    if (request.body.enabled === false && scene.code === "general_chat") {
      throw new ConflictError("通用对话是当前开放场景，禁止停用");
    }
    if (request.body.promptTemplateId) {
      const [prompt] = await app.db.select({ id: prompts.id }).from(prompts).where(eq(prompts.id, request.body.promptTemplateId)).limit(1);
      if (!prompt) throw new NotFoundError("关联的提示词不存在");
    }

    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(aiScenes).set({
        name: request.body.name ?? scene.name,
        description: request.body.description ?? scene.description,
        defaultModelId: request.body.primaryModelId !== undefined ? request.body.primaryModelId : scene.defaultModelId,
        reasoningModelId: request.body.reasoningModelId !== undefined ? request.body.reasoningModelId : scene.reasoningModelId,
        fallbackModelId: request.body.fallbackModelId !== undefined ? request.body.fallbackModelId : scene.fallbackModelId,
        promptId: request.body.promptTemplateId !== undefined ? request.body.promptTemplateId : scene.promptId,
        allowReasoning: request.body.allowReasoning ?? scene.allowReasoning,
        requireProject: request.body.requireProject ?? scene.requireProject,
        allowFileUpload: request.body.allowFileUpload ?? scene.allowFileUpload,
        allowKnowledgeSearch: request.body.allowKnowledgeSearch ?? scene.allowKnowledgeSearch,
        allowTools: request.body.allowTools ?? scene.allowTools,
        sort: request.body.sort ?? scene.sort,
        visibility: request.body.visibility ?? scene.visibility,
        enabled: request.body.enabled ?? scene.enabled,
        updatedAt: new Date()
      }).where(eq(aiScenes.id, scene.id)).returning();
      await writeAuditLog({
        db: tx, request, actor, action: AUDIT_ACTIONS.AI_SCENE_BOUND,
        targetType: "ai_scene", targetId: scene.id, afterJson: row
      });
      return row!;
    });
    return ok(request, { message: "AI 场景配置成功", scene: updated });
  });

  // ============ Prompt ============

  route.get("/ai/prompts", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "获取提示词列表" }
  }, async (request) => {
    requireAdmin(request, AI_PERMISSIONS.PROMPT_LIST);
    const items = await app.db.select({
      prompt: prompts,
      activeVersion: promptVersions
    }).from(prompts)
      .leftJoin(promptVersions, eq(promptVersions.id, prompts.activeVersionId))
      .orderBy(desc(prompts.updatedAt));
    return ok(request, {
      items: items.map(({ prompt, activeVersion }) => ({
        id: prompt.id,
        scene: prompt.code,
        name: prompt.name,
        code: prompt.code,
        description: prompt.description,
        version: activeVersion?.version ?? null,
        status: activeVersion?.status ?? null,
        systemPrompt: activeVersion?.content ?? null,
        activeVersionId: activeVersion?.id ?? null,
        enabled: activeVersion?.status === "PUBLISHED",
        createdAt: prompt.createdAt,
        updatedAt: prompt.updatedAt
      }))
    });
  });

  route.get("/ai/prompts/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "获取提示词详情", params: promptParamsSchema }
  }, async (request) => {
    requireAdmin(request, AI_PERMISSIONS.PROMPT_LIST);
    const [row] = await app.db.select({ prompt: prompts, activeVersion: promptVersions }).from(prompts)
      .leftJoin(promptVersions, eq(promptVersions.id, prompts.activeVersionId))
      .where(eq(prompts.id, request.params.id)).limit(1);
    if (!row) throw new NotFoundError("提示词不存在");
    return ok(request, { prompt: row });
  });

  route.post("/ai/prompts", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "创建提示词草稿", body: promptCreateBodySchema }
  }, async (request) => {
    const actor = requireAdmin(request, AI_PERMISSIONS.PROMPT_CREATE);
    const { prompt, draft } = await createPromptDraft(app.db, {
      sceneCode: request.body.scene,
      name: request.body.name,
      description: request.body.description,
      content: request.body.systemPrompt,
      changeNote: request.body.changeNote,
      createdById: actor.id
    });
    await writeAuditLog({
      db: app.db, request, actor, action: "ai.prompt_created",
      targetType: "prompt", targetId: prompt.id, afterJson: { versionId: draft.id, version: draft.version, status: draft.status }
    });
    return ok(request, { message: "提示词草稿创建成功，请发布后生效", prompt: { ...prompt, draftVersion: draft.version, draftId: draft.id } });
  });

  route.patch("/ai/prompts/:id/draft", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "编辑提示词草稿", params: promptParamsSchema, body: promptDraftBodySchema }
  }, async (request) => {
    const actor = requireAdmin(request, AI_PERMISSIONS.PROMPT_EDIT);
    const { draft } = await updatePromptDraft(app.db, request.params.id, {
      name: request.body.name,
      description: request.body.description,
      content: request.body.systemPrompt,
      changeNote: request.body.changeNote,
      updatedById: actor.id
    });
    await writeAuditLog({
      db: app.db, request, actor, action: "ai.prompt_draft_updated",
      targetType: "prompt_version", targetId: draft.id, afterJson: { version: draft.version, status: draft.status }
    });
    return ok(request, { message: "提示词草稿已保存", draft: { id: draft.id, version: draft.version, status: draft.status } });
  });

  route.post("/ai/prompts/:id/publish", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "发布提示词草稿", params: promptParamsSchema, body: z.object({ versionId: z.uuid("版本 ID 格式不正确") }) }
  }, async (request) => {
    const actor = requireAdmin(request, AI_PERMISSIONS.PROMPT_PUBLISH);
    const published = await publishPromptVersion(app.db, request.params.id, request.body.versionId, actor.id);
    await writeAuditLog({
      db: app.db, request, actor, action: "ai.prompt_published",
      targetType: "prompt_version", targetId: published.id,
      afterJson: { version: published.version, status: published.status }
    });
    return ok(request, { message: "提示词发布成功，新请求将使用该版本", version: { id: published.id, version: published.version, status: published.status } });
  });

  route.post("/ai/prompts/:id/disable", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "停用当前生效提示词", params: promptParamsSchema }
  }, async (request) => {
    const actor = requireAdmin(request, AI_PERMISSIONS.PROMPT_PUBLISH);
    const disabled = await disablePrompt(app.db, request.params.id);
    await writeAuditLog({
      db: app.db, request, actor, action: "ai.prompt_disabled",
      targetType: "prompt_version", targetId: disabled.id,
      afterJson: { version: disabled.version, status: disabled.status }
    });
    return ok(request, { message: "提示词已停用，该场景的新请求将提示配置不完整" });
  });

  route.post("/ai/prompts/:id/versions/:versionId/rollback", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "回滚历史版本为新草稿", params: promptVersionParamsSchema }
  }, async (request) => {
    const actor = requireAdmin(request, AI_PERMISSIONS.PROMPT_EDIT);
    const draft = await rollbackPromptVersion(app.db, request.params.id, request.params.versionId, actor.id);
    return ok(request, { message: "已基于历史版本创建新草稿，请编辑或直接发布", draft: { id: draft.id, version: draft.version, status: draft.status } });
  });

  route.get("/ai/prompts/:id/versions", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "获取提示词版本列表", params: promptParamsSchema }
  }, async (request) => {
    requireAdmin(request, AI_PERMISSIONS.PROMPT_LIST);
    const items = await app.db.select().from(promptVersions)
      .where(eq(promptVersions.promptId, request.params.id))
      .orderBy(desc(promptVersions.version));
    if (items.length === 0) throw new NotFoundError("提示词不存在");
    return ok(request, { items });
  });

  route.get("/ai/prompts/:id/versions/compare", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "对比提示词版本", params: promptParamsSchema, querystring: compareQuerySchema }
  }, async (request) => {
    requireAdmin(request, AI_PERMISSIONS.PROMPT_LIST);
    const [from] = await app.db.select().from(promptVersions)
      .where(and(eq(promptVersions.id, request.query.from), eq(promptVersions.promptId, request.params.id))).limit(1);
    const [to] = await app.db.select().from(promptVersions)
      .where(and(eq(promptVersions.id, request.query.to), eq(promptVersions.promptId, request.params.id))).limit(1);
    if (!from || !to) throw new NotFoundError("对比的提示词版本不存在");
    return ok(request, {
      from: { id: from.id, version: from.version, status: from.status, changeNote: from.changeNote, publishedAt: from.publishedAt },
      to: { id: to.id, version: to.version, status: to.status, changeNote: to.changeNote, publishedAt: to.publishedAt },
      changed: from.content !== to.content
    });
  });

  route.delete("/ai/prompts/:id/versions/:versionId", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "删除提示词草稿版本", params: promptVersionParamsSchema }
  }, async (request) => {
    const actor = requireAdmin(request, AI_PERMISSIONS.PROMPT_EDIT);
    const deleted = await deletePromptDraftVersion(app.db, request.params.id, request.params.versionId);
    await writeAuditLog({
      db: app.db, request, actor, action: "ai.prompt_version_deleted",
      targetType: "prompt_version", targetId: deleted.id, beforeJson: { version: deleted.version, status: deleted.status }
    });
    return ok(request, { message: "提示词草稿版本已删除" });
  });

  route.delete("/ai/prompts/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 平台 / AI配置"], summary: "删除未发布过的提示词", params: promptParamsSchema }
  }, async (request) => {
    const actor = requireAdmin(request, AI_PERMISSIONS.PROMPT_DELETE);
    const deleted = await deletePromptIfUnpublished(app.db, request.params.id);
    await writeAuditLog({
      db: app.db, request, actor, action: "ai.prompt_deleted",
      targetType: "prompt", targetId: deleted.id, beforeJson: { code: deleted.code, name: deleted.name }
    });
    return ok(request, { message: "提示词已删除" });
  });
}
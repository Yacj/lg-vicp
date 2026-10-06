import { and, desc, eq, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "../../db/client.js";
import {
  aiModels,
  aiProviders,
  aiScenes,
  prompts,
  promptVersions
} from "../../db/schema.js";
import { AiError } from "../../shared/ai-errors.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import { decryptSecret, maskSecret } from "./ai-config.crypto.js";
import { createCompatibleLanguageModel } from "./ai-provider-adapter.js";
import type { ReasoningLevel } from "./ai-reasoning.js";
import {
  invalidatedAdmissionPatch,
  isAdmittedForRuntime,
  pickDefaultRuntimeModelId,
  validateModelForRuntime,
  type ModelTestStatus
} from "./ai-model-runtime.js";
import { languageModelCallOptions } from "./ai-task-runtime-policy.js";
import { generateText } from "ai";

/** @deprecated 能力键不再由 B 端勾选，仅兼容历史数据读取 */
export const MODEL_CAPABILITY_KEYS = [
  "text",
  "streaming",
  "structuredOutput",
  "reasoning",
  "reasoningEffort",
  "reasoningAlwaysOn",
  "tools",
  "toolCalling",
  "vision",
  "files"
] as const;

export interface ResolvedModelConfig {
  providerId: string;
  providerName: string;
  providerCode: string | null;
  modelId: string;
  modelDisplayName: string;
  supportsVision: boolean;
  reasoningLevel: ReasoningLevel;
  lastTestStatus: ModelTestStatus;
  isDefault: boolean;
  /** @deprecated 内部探测缓存，运行时不再按人工勾选 tools/agent 选模 */
  capabilities: Record<string, boolean>;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  contextWindow: number | null;
  languageModel: ReturnType<typeof createCompatibleLanguageModel>;
  modelRef: typeof aiModels.$inferSelect;
  providerRef: typeof aiProviders.$inferSelect;
}

export type PublicAiModelConfig = {
  id: string;
  name: string;
  displayName: string;
  provider: string;
  providerId: string;
  providerName: string;
  modelId: string;
  baseUrl: string;
  credentialId: string;
  supportsVision: boolean;
  reasoningLevel: ReasoningLevel;
  enabled: boolean;
  isDefault: boolean;
  lastTestStatus: ModelTestStatus;
  lastTestAt: Date | null;
  lastTestError: string | null;
  createdAt: Date;
  updatedAt: Date;
  code: string | null;
  description: string | null;
  /** @deprecated */
  capabilities: Record<string, boolean>;
  /** @deprecated */
  contextWindow: number | null;
  /** @deprecated */
  maxOutputTokens: number | null;
  /** @deprecated */
  defaultTemperature: number | null;
  /** @deprecated */
  timeoutMs: number;
  priority: number;
};

function toResolvedModelConfig(
  model: { modelRef: typeof aiModels.$inferSelect; providerRef: typeof aiProviders.$inferSelect },
  apiKey: string
): ResolvedModelConfig {
  return {
    providerId: model.providerRef.id,
    providerName: model.providerRef.name,
    providerCode: model.providerRef.code,
    modelId: model.modelRef.modelId,
    modelDisplayName: model.modelRef.displayName,
    supportsVision: model.modelRef.supportsVision,
    reasoningLevel: model.modelRef.reasoningLevel,
    lastTestStatus: model.modelRef.lastTestStatus,
    isDefault: model.modelRef.isDefault,
    capabilities: model.modelRef.capabilities ?? {},
    baseUrl: model.providerRef.baseUrl,
    apiKey,
    timeoutMs: model.providerRef.timeoutMs,
    contextWindow: model.modelRef.contextWindow,
    languageModel: createCompatibleLanguageModel({
      provider: model.providerRef,
      apiKey,
      modelId: model.modelRef.modelId
    }),
    modelRef: model.modelRef,
    providerRef: model.providerRef
  };
}

export function toPublicModelConfig(
  model: typeof aiModels.$inferSelect,
  provider: typeof aiProviders.$inferSelect
): PublicAiModelConfig {
  return {
    id: model.id,
    name: model.displayName,
    displayName: model.displayName,
    provider: provider.code ?? provider.name,
    providerId: provider.id,
    providerName: provider.name,
    modelId: model.modelId,
    baseUrl: provider.baseUrl,
    credentialId: provider.id,
    supportsVision: model.supportsVision,
    reasoningLevel: model.reasoningLevel,
    enabled: model.enabled,
    isDefault: model.isDefault,
    lastTestStatus: model.lastTestStatus,
    lastTestAt: model.lastTestAt,
    lastTestError: model.lastTestError,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
    code: model.code,
    description: model.description,
    capabilities: model.capabilities ?? {},
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    defaultTemperature: model.defaultTemperature,
    timeoutMs: model.timeoutMs,
    priority: model.priority
  };
}

export function toPublicModelAudit(model: PublicAiModelConfig | typeof aiModels.$inferSelect) {
  if ("provider" in model && "name" in model) {
    const row = model as PublicAiModelConfig;
    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      modelId: row.modelId,
      supportsVision: row.supportsVision,
      reasoningLevel: row.reasoningLevel,
      enabled: row.enabled,
      isDefault: row.isDefault,
      lastTestStatus: row.lastTestStatus
    };
  }
  const row = model as typeof aiModels.$inferSelect;
  return {
    id: row.id,
    name: row.displayName,
    providerId: row.providerId,
    modelId: row.modelId,
    supportsVision: row.supportsVision,
    reasoningLevel: row.reasoningLevel,
    enabled: row.enabled,
    isDefault: row.isDefault,
    lastTestStatus: row.lastTestStatus
  };
}

async function loadModelRow(db: Database, id: string) {
  const [model] = await db.select({
    modelRef: aiModels,
    providerRef: aiProviders
  }).from(aiModels)
    .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
    .where(eq(aiModels.id, id))
    .limit(1);
  return model ?? null;
}

function decryptProviderKey(provider: typeof aiProviders.$inferSelect) {
  if (!provider.apiKeyCiphertext || !provider.apiKeyIv || !provider.apiKeyTag) {
    throw new AiError("AI_CONFIG_INVALID", `模型服务商“${provider.name}”尚未配置 API Key`);
  }
  return decryptSecret(provider.apiKeyCiphertext, provider.apiKeyIv, provider.apiKeyTag);
}

export async function resolveModelById(db: Database, id: string): Promise<ResolvedModelConfig> {
  const model = await loadModelRow(db, id);
  if (!model) throw new AiError("AI_MODEL_UNAVAILABLE", "模型不存在、已停用或服务商不可用");
  if (!model.providerRef.enabled) {
    throw new AiError("AI_MODEL_UNAVAILABLE", "模型不存在、已停用或服务商不可用");
  }
  validateModelForRuntime({
    enabled: model.modelRef.enabled,
    lastTestStatus: model.modelRef.lastTestStatus,
    supportsVision: model.modelRef.supportsVision,
    reasoningLevel: model.modelRef.reasoningLevel
  });
  const apiKey = decryptProviderKey(model.providerRef);
  return toResolvedModelConfig(model, apiKey);
}

/** 管理端测试/预览：允许加载未启用、未准入模型，但仍要求服务商已配置密钥。 */
export async function loadModelForAdmin(db: Database, id: string): Promise<ResolvedModelConfig> {
  const model = await loadModelRow(db, id);
  if (!model) throw new NotFoundError("AI 模型不存在");
  const apiKey = decryptProviderKey(model.providerRef);
  return toResolvedModelConfig(model, apiKey);
}

export async function invalidateModelsForProvider(db: Database, providerId: string) {
  await db.update(aiModels).set({
    ...invalidatedAdmissionPatch(),
    updatedAt: new Date()
  }).where(eq(aiModels.providerId, providerId));
}

export async function clearOtherDefaultModels(db: Database, keepId: string) {
  await db.update(aiModels).set({
    isDefault: false,
    updatedAt: new Date()
  }).where(and(eq(aiModels.isDefault, true), ne(aiModels.id, keepId)));
}

/** 默认视觉模型角色编码：兼容历史 code=default_vision */
export const DEFAULT_VISION_MODEL_ROLE = "default_vision";
export const DEFAULT_AGENT_MODEL_ROLE = "default_agent";

export function pickDefaultVisionModelId(
  rows: Array<{
    id: string;
    code?: string | null;
    isDefault?: boolean | null;
    supportsVision?: boolean | null;
    lastTestStatus?: string | null;
    capabilities?: Record<string, boolean> | null;
  }>
): string | null {
  return pickDefaultRuntimeModelId(rows.map((row) => ({
    id: row.id,
    code: row.code ?? null,
    isDefault: row.isDefault ?? false,
    supportsVision: row.supportsVision ?? row.capabilities?.vision === true,
    lastTestStatus: row.lastTestStatus ?? "UNTESTED"
  })), { requireVision: true });
}

export function pickDefaultAgentModelId(
  rows: Array<{
    id: string;
    code?: string | null;
    isDefault?: boolean | null;
    lastTestStatus?: string | null;
  }>
): string | null {
  return pickDefaultRuntimeModelId(rows.map((row) => ({
    id: row.id,
    code: row.code ?? null,
    isDefault: row.isDefault ?? false,
    lastTestStatus: row.lastTestStatus ?? "UNTESTED"
  })));
}

/**
 * 从已准入模型中解析默认视觉模型。要求 enabled + PASSED + supportsVision。
 */
export async function resolveDefaultVisionModel(db: Database): Promise<ResolvedModelConfig> {
  const candidates = await db.select({
    modelRef: aiModels,
    providerRef: aiProviders
  }).from(aiModels)
    .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
    .where(and(eq(aiModels.enabled, true), eq(aiProviders.enabled, true)))
    .orderBy(desc(aiModels.isDefault), desc(aiModels.priority));

  const preferredId = pickDefaultVisionModelId(candidates.map((row) => ({
    id: row.modelRef.id,
    code: row.modelRef.code,
    isDefault: row.modelRef.isDefault,
    supportsVision: row.modelRef.supportsVision,
    lastTestStatus: row.modelRef.lastTestStatus
  })));
  if (!preferredId) {
    throw new AiError("VISION_MODEL_NOT_CONFIGURED");
  }
  return resolveModelById(db, preferredId);
}

/**
 * 解析已通过准入测试的默认 Agent 模型。
 * 未配置时返回 null，调用方回退到无工具的普通对话路径。
 */
export async function resolveAgentModelOrNull(db: Database): Promise<ResolvedModelConfig | null> {
  const candidates = await db.select({
    modelRef: aiModels,
    providerRef: aiProviders
  }).from(aiModels)
    .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
    .where(and(eq(aiModels.enabled, true), eq(aiProviders.enabled, true)))
    .orderBy(desc(aiModels.isDefault), desc(aiModels.priority));

  const preferredId = pickDefaultAgentModelId(candidates.map((row) => ({
    id: row.modelRef.id,
    code: row.modelRef.code,
    isDefault: row.modelRef.isDefault,
    lastTestStatus: row.modelRef.lastTestStatus
  })));
  if (!preferredId) return null;
  return resolveModelById(db, preferredId);
}

/**
 * 校验模型是否可被场景绑定：必须启用且已通过准入测试。
 */
export async function assertSceneModelUsable(db: Database, modelId: string | null | undefined, role: "default" | "reasoning" | "fallback") {
  if (!modelId) return;
  const [model] = await db.select({
    modelRef: aiModels,
    providerEnabled: aiProviders.enabled
  }).from(aiModels)
    .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
    .where(eq(aiModels.id, modelId))
    .limit(1);
  if (!model || !model.providerEnabled) {
    throw new AiError("AI_CONFIG_INVALID", `场景绑定的${role === "reasoning" ? "推理模型" : "模型"}不存在或已停用`);
  }
  if (!isAdmittedForRuntime(model.modelRef)) {
    throw new AiError("AI_CONFIG_INVALID", `场景绑定的${role === "reasoning" ? "推理模型" : "模型"}必须已启用且通过准入测试`);
  }
}

/**
 * 提示词版本化服务：草稿创建/编辑、发布、停用、回滚。
 * 规则：同一提示词只能有一个 PUBLISHED 版本；已发布版本不可直接修改，修改复制为新草稿；
 * 删除草稿不影响历史消息追溯（已发布/已停用版本不可删除）。
 */

async function nextVersionNumber(db: Database, promptId: string): Promise<number> {
  const [row] = await db.select({ max: sql<number>`coalesce(max(${promptVersions.version}), 0)` })
    .from(promptVersions).where(eq(promptVersions.promptId, promptId));
  return (row?.max ?? 0) + 1;
}

export async function createPromptDraft(
  db: Database,
  input: { sceneCode: string; name: string; description?: string; content: string; changeNote?: string; createdById: string }
) {
  const [scene] = await db.select({ id: aiScenes.id, code: aiScenes.code }).from(aiScenes)
    .where(eq(aiScenes.code, input.sceneCode)).limit(1);
  if (!scene) throw new NotFoundError(`场景“${input.sceneCode}”不存在`);
  return db.transaction(async (tx) => {
    const [prompt] = await tx.insert(prompts).values({
      sceneId: scene.id,
      name: input.name,
      code: scene.code,
      description: input.description ?? input.content.slice(0, 60)
    }).onConflictDoNothing().returning();
    if (!prompt) {
      const [existing] = await tx.select({ id: prompts.id }).from(prompts).where(eq(prompts.code, scene.code)).limit(1);
      if (!existing) throw new ConflictError("提示词创建冲突，请重试");
      const version = await nextVersionNumber(tx, existing.id);
      const [draft] = await tx.insert(promptVersions).values({
        promptId: existing.id,
        version,
        content: input.content,
        status: "DRAFT",
        changeNote: input.changeNote,
        createdById: input.createdById
      }).returning();
      return { prompt: existing, draft: draft! };
    }
    const [draft] = await tx.insert(promptVersions).values({
      promptId: prompt.id,
      version: 1,
      content: input.content,
      status: "DRAFT",
      changeNote: input.changeNote,
      createdById: input.createdById
    }).returning();
    return { prompt, draft: draft! };
  });
}

export async function updatePromptDraft(
  db: Database,
  promptId: string,
  input: { name?: string; description?: string; content: string; changeNote?: string; updatedById: string }
) {
  const [prompt] = await db.select().from(prompts).where(eq(prompts.id, promptId)).limit(1);
  if (!prompt) throw new NotFoundError("提示词不存在");

  return db.transaction(async (tx) => {
    const [active] = await tx.select().from(promptVersions)
      .where(eq(promptVersions.id, prompt.activeVersionId ?? ""))
      .limit(1);
    const latestDraft = await tx.select().from(promptVersions)
      .where(and(eq(promptVersions.promptId, promptId), eq(promptVersions.status, "DRAFT")))
      .orderBy(desc(promptVersions.version)).limit(1);

    // 已发布/已停用状态下编辑：复制为新草稿
    const baseVersion = latestDraft[0] ?? active;
    if (baseVersion && baseVersion.status === "DRAFT") {
      await tx.update(promptVersions).set({
        content: input.content,
        changeNote: input.changeNote,
        createdAt: new Date()
      }).where(eq(promptVersions.id, baseVersion.id));
      if (input.name || input.description !== undefined) {
        await tx.update(prompts).set({
          name: input.name ?? prompt.name,
          description: input.description ?? prompt.description,
          updatedAt: new Date()
        }).where(eq(prompts.id, promptId));
      }
      return { draft: baseVersion };
    }
    const version = await nextVersionNumber(tx, promptId);
    const [draft] = await tx.insert(promptVersions).values({
      promptId,
      version,
      content: input.content,
      status: "DRAFT",
      changeNote: input.changeNote,
      createdById: input.updatedById
    }).returning();
    await tx.update(prompts).set({
      name: input.name ?? prompt.name,
      description: input.description ?? prompt.description,
      updatedAt: new Date()
    }).where(eq(prompts.id, promptId));
    return { draft: draft! };
  });
}

export async function publishPromptVersion(
  db: Database,
  promptId: string,
  versionId: string,
  publishedById: string
) {
  return db.transaction(async (tx) => {
    const [version] = await tx.select().from(promptVersions)
      .where(and(eq(promptVersions.id, versionId), eq(promptVersions.promptId, promptId)))
      .limit(1);
    if (!version) throw new NotFoundError("提示词版本不存在");
    if (version.status === "PUBLISHED") throw new ConflictError("该版本已是生效版本");
    if (version.status === "DISABLED") throw new ConflictError("已停用的版本不能重新发布，请基于历史版本回滚");

    await tx.update(promptVersions).set({ status: "DISABLED" })
      .where(and(eq(promptVersions.promptId, promptId), eq(promptVersions.status, "PUBLISHED")));
    const [published] = await tx.update(promptVersions).set({
      status: "PUBLISHED",
      publishedById,
      publishedAt: new Date()
    }).where(eq(promptVersions.id, versionId)).returning();
    await tx.update(prompts).set({ activeVersionId: published!.id, updatedAt: new Date() })
      .where(eq(prompts.id, promptId));
    return published!;
  });
}

export async function disablePrompt(db: Database, promptId: string) {
  return db.transaction(async (tx) => {
    const [prompt] = await tx.select().from(prompts).where(eq(prompts.id, promptId)).limit(1);
    if (!prompt) throw new NotFoundError("提示词不存在");
    if (!prompt.activeVersionId) throw new ConflictError("当前没有生效的提示词版本");
    const [disabled] = await tx.update(promptVersions).set({ status: "DISABLED" })
      .where(eq(promptVersions.id, prompt.activeVersionId)).returning();
    await tx.update(prompts).set({ activeVersionId: null, updatedAt: new Date() })
      .where(eq(prompts.id, promptId));
    return disabled!;
  });
}

export async function rollbackPromptVersion(
  db: Database,
  promptId: string,
  versionId: string,
  createdById: string
) {
  return db.transaction(async (tx) => {
    const [version] = await tx.select().from(promptVersions)
      .where(and(eq(promptVersions.id, versionId), eq(promptVersions.promptId, promptId)))
      .limit(1);
    if (!version) throw new NotFoundError("提示词版本不存在");
    if (version.status === "DRAFT") throw new ConflictError("草稿版本不需要回滚，直接编辑后发布即可");
    const nextVersion = await nextVersionNumber(tx, promptId);
    const [draft] = await tx.insert(promptVersions).values({
      promptId,
      version: nextVersion,
      content: version.content,
      status: "DRAFT",
      changeNote: `回滚自版本 ${version.version}`,
      createdById
    }).returning();
    return draft!;
  });
}

export async function deletePromptDraftVersion(db: Database, promptId: string, versionId: string) {
  const [version] = await db.select().from(promptVersions)
    .where(and(eq(promptVersions.id, versionId), eq(promptVersions.promptId, promptId)))
    .limit(1);
  if (!version) throw new NotFoundError("提示词版本不存在");
  if (version.status !== "DRAFT") {
    throw new ConflictError("已发布或已停用的版本必须保留用于历史追溯，不能删除");
  }
  await db.delete(promptVersions).where(eq(promptVersions.id, versionId));
  return version;
}

/** 删除提示词：仅允许从未发布过的提示词（无 PUBLISHED/DISABLED 历史版本） */
export async function deletePromptIfUnpublished(db: Database, promptId: string) {
  return db.transaction(async (tx) => {
    const [published] = await tx.select({ id: promptVersions.id }).from(promptVersions)
      .where(and(eq(promptVersions.promptId, promptId), ne(promptVersions.status, "DRAFT")))
      .limit(1);
    if (published) throw new ConflictError("该提示词已有发布历史，不能删除；可停用后保留用于追溯");
    const [deleted] = await tx.delete(prompts).where(eq(prompts.id, promptId)).returning();
    if (!deleted) throw new NotFoundError("提示词不存在");
    return deleted;
  });
}

/** Provider 测试连接：使用该服务商下优先级最高的启用模型发起一次最小调用 */
export async function testProviderConnection(db: Database, providerId: string) {
  const [provider] = await db.select().from(aiProviders).where(eq(aiProviders.id, providerId)).limit(1);
  if (!provider) throw new NotFoundError("AI 服务商不存在");

  const [model] = await db.select({ id: aiModels.id }).from(aiModels)
    .where(and(eq(aiModels.providerId, providerId), eq(aiModels.enabled, true)))
    .orderBy(desc(aiModels.priority), desc(aiModels.createdAt))
    .limit(1);
  if (!model) {
    throw new ConflictError("该服务商下没有启用的模型，请先创建模型后再测试连接");
  }

  const resolved = await loadModelForAdmin(db, model.id);
  try {
    const result = await generateText({
      model: resolved.languageModel,
      prompt: "这是一次连接测试。请只回复：连接成功。",
      ...languageModelCallOptions("MODEL_TEST")
    });
    await db.update(aiProviders).set({
      lastTestStatus: "OK",
      lastTestMessage: "连接测试成功",
      lastTestAt: new Date(),
      updatedAt: new Date()
    }).where(eq(aiProviders.id, providerId));
    return { success: true, message: "连接测试成功", response: result.text, provider: providerId, model: model.id };
  } catch (error) {
    // 只记录固定中文信息，避免把服务商 URL、密钥等敏感细节写入 lastTestMessage
    await db.update(aiProviders).set({
      lastTestStatus: "FAILED",
      lastTestMessage: "连接测试失败，请检查 Base URL 与 API Key",
      lastTestAt: new Date(),
      updatedAt: new Date()
    }).where(eq(aiProviders.id, providerId));
    throw new AiError("AI_PROVIDER_UNAVAILABLE", "服务商连接测试失败，请检查 Base URL 与 API Key");
  }
}

export { maskSecret };

export type PromptVersionRow = typeof promptVersions.$inferSelect;

/** 场景完整配置（供管理端返回与校验） */
export async function listScenes(db: Database) {
  const defaultModelAlias = alias(aiModels, "default_model");
  const defaultProviderAlias = alias(aiProviders, "default_provider");
  const reasoningModelAlias = alias(aiModels, "reasoning_model");
  const fallbackModelAlias = alias(aiModels, "fallback_model");
  return db.select({
    scene: aiScenes,
    prompt: prompts,
    activeVersion: promptVersions,
    defaultModel: defaultModelAlias,
    defaultProvider: defaultProviderAlias,
    reasoningModel: reasoningModelAlias,
    fallbackModel: fallbackModelAlias
  }).from(aiScenes)
    .leftJoin(prompts, eq(prompts.sceneId, aiScenes.id))
    .leftJoin(promptVersions, eq(promptVersions.id, prompts.activeVersionId))
    .leftJoin(defaultModelAlias, eq(defaultModelAlias.id, aiScenes.defaultModelId))
    .leftJoin(defaultProviderAlias, eq(defaultProviderAlias.id, defaultModelAlias.providerId))
    .leftJoin(reasoningModelAlias, eq(reasoningModelAlias.id, aiScenes.reasoningModelId))
    .leftJoin(fallbackModelAlias, eq(fallbackModelAlias.id, aiScenes.fallbackModelId))
    .orderBy(aiScenes.sort);
}
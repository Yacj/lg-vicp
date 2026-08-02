import { and, desc, eq, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
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

/** 模型能力键白名单：超出范围的能力键视为非法配置 */
export const MODEL_CAPABILITY_KEYS = [
  "text",
  "streaming",
  "structuredOutput",
  "reasoning",
  "reasoningEffort",
  "reasoningAlwaysOn",
  "tools",
  "vision",
  "files"
] as const;

export interface ResolvedModelConfig {
  providerId: string;
  providerName: string;
  modelId: string;
  modelDisplayName: string;
  capabilities: Record<string, boolean>;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxOutputTokens: number | null;
  defaultTemperature: number | null;
  contextWindow: number | null;
  languageModel: ReturnType<ReturnType<typeof createOpenAICompatible>["chatModel"]>;
  modelRef: typeof aiModels.$inferSelect;
  providerRef: typeof aiProviders.$inferSelect;
}

function createLanguageModel(provider: typeof aiProviders.$inferSelect, apiKey: string) {
  const compatible = createOpenAICompatible({
    name: provider.name,
    baseURL: provider.baseUrl.replace(/\/$/, ""),
    apiKey,
    includeUsage: true
  });
  return compatible;
}

export async function resolveModelById(db: Database, id: string): Promise<ResolvedModelConfig> {
  const [model] = await db.select({
    modelRef: aiModels,
    providerRef: aiProviders
  }).from(aiModels)
    .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
    .where(eq(aiModels.id, id))
    .limit(1);

  if (!model || !model.modelRef.enabled || !model.providerRef.enabled) {
    throw new AiError("AI_MODEL_UNAVAILABLE", "模型不存在、已停用或服务商不可用");
  }
  if (!model.providerRef.apiKeyCiphertext || !model.providerRef.apiKeyIv || !model.providerRef.apiKeyTag) {
    throw new AiError("AI_CONFIG_INVALID", `模型服务商“${model.providerRef.name}”尚未配置 API Key`);
  }
  const apiKey = decryptSecret(model.providerRef.apiKeyCiphertext, model.providerRef.apiKeyIv, model.providerRef.apiKeyTag);
  const compatible = createLanguageModel(model.providerRef, apiKey);
  return {
    providerId: model.providerRef.id,
    providerName: model.providerRef.name,
    modelId: model.modelRef.modelId,
    modelDisplayName: model.modelRef.displayName,
    capabilities: model.modelRef.capabilities ?? {},
    baseUrl: model.providerRef.baseUrl,
    apiKey,
    timeoutMs: model.providerRef.timeoutMs,
    maxOutputTokens: model.modelRef.maxOutputTokens,
    defaultTemperature: model.modelRef.defaultTemperature,
    contextWindow: model.modelRef.contextWindow,
    languageModel: compatible.chatModel(model.modelRef.modelId),
    modelRef: model.modelRef,
    providerRef: model.providerRef
  };
}

/**
 * 校验模型是否可被场景绑定：
 * - 模型与服务商必须存在且启用
 * - 作为推理模型绑定时必须支持 reasoning
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
  if (!model || !model.modelRef.enabled || !model.providerEnabled) {
    throw new AiError("AI_CONFIG_INVALID", `场景绑定的${role === "reasoning" ? "推理模型" : "模型"}不存在或已停用`);
  }
  if (role === "reasoning" && model.modelRef.capabilities?.reasoning !== true) {
    throw new AiError("AI_REASONING_NOT_SUPPORTED", "推理模型必须支持深度思考能力");
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

  const resolved = await resolveModelById(db, model.id);
  try {
    const result = await generateText({
      model: resolved.languageModel,
      prompt: "这是一次连接测试。请只回复：连接成功。",
      maxOutputTokens: 16,
      temperature: 0
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
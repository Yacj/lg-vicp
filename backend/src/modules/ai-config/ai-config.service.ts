import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { aiModels, aiProviders, aiSceneBindings, promptTemplates } from "../../db/schema.js";
import { ServiceUnavailableError } from "../../shared/errors.js";
import { decryptSecret } from "./ai-config.crypto.js";

export async function resolveSceneModel(db: Database, scene: string) {
  const [config] = await db.select({
    bindingId: aiSceneBindings.id,
    settings: aiSceneBindings.settings,
    capabilities: aiModels.capabilities,
    modelId: aiModels.modelId,
    modelDisplayName: aiModels.displayName,
    maxOutputTokens: aiModels.maxOutputTokens,
    defaultTemperature: aiModels.defaultTemperature,
    timeoutMs: aiModels.timeoutMs,
    providerId: aiProviders.id,
    providerName: aiProviders.name,
    baseUrl: aiProviders.baseUrl,
    apiKeyCiphertext: aiProviders.apiKeyCiphertext,
    apiKeyIv: aiProviders.apiKeyIv,
    apiKeyTag: aiProviders.apiKeyTag,
    promptTemplateId: promptTemplates.id,
    promptTemplateVersion: promptTemplates.version,
    systemPrompt: promptTemplates.systemPrompt
  }).from(aiSceneBindings)
    .innerJoin(aiModels, eq(aiModels.id, aiSceneBindings.primaryModelId))
    .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
    .leftJoin(promptTemplates, eq(promptTemplates.id, aiSceneBindings.promptTemplateId))
    .where(and(
      eq(aiSceneBindings.scene, scene),
      eq(aiSceneBindings.enabled, true),
      eq(aiModels.enabled, true),
      eq(aiProviders.enabled, true)
    ))
    .limit(1);

  if (!config) throw new ServiceUnavailableError(`场景“${scene}”尚未配置可用模型`);
  if (!config.apiKeyCiphertext || !config.apiKeyIv || !config.apiKeyTag) {
    throw new ServiceUnavailableError(`模型服务商“${config.providerName}”尚未配置 API Key`);
  }

  const apiKey = decryptSecret(config.apiKeyCiphertext, config.apiKeyIv, config.apiKeyTag);
  const provider = createOpenAICompatible({
    name: config.providerName,
    baseURL: config.baseUrl.replace(/\/$/, ""),
    apiKey,
    includeUsage: true
  });

  return {
    ...config,
    languageModel: provider.chatModel(config.modelId)
  };
}

export function resolveReasoningProviderOptions(
  config: { modelId: string; providerName: string; capabilities: Record<string, boolean> },
  mode: "OFF" | "ON"
) {
  const alwaysOn = config.capabilities.reasoningAlwaysOn === true || config.modelId === "deepseek-reasoner";
  if (mode === "OFF" && alwaysOn) {
    throw new ServiceUnavailableError("当前模型始终开启深度思考，请切换到普通对话模型");
  }
  if (mode === "OFF") return undefined;
  if (!config.capabilities.reasoning && !alwaysOn) {
    throw new ServiceUnavailableError("当前模型不支持深度思考，请切换模型后重试");
  }
  if (alwaysOn || config.capabilities.reasoningEffort !== true) return undefined;

  const providerKey = config.providerName.replace(/[-_]+([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return { [providerKey]: { reasoningEffort: "high" } };
}

export async function resolveModelById(db: Database, id: string) {
  const [config] = await db.select({
    modelId: aiModels.modelId,
    providerName: aiProviders.name,
    baseUrl: aiProviders.baseUrl,
    apiKeyCiphertext: aiProviders.apiKeyCiphertext,
    apiKeyIv: aiProviders.apiKeyIv,
    apiKeyTag: aiProviders.apiKeyTag
  }).from(aiModels)
    .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
    .where(and(eq(aiModels.id, id), eq(aiModels.enabled, true), eq(aiProviders.enabled, true)))
    .limit(1);

  if (!config) throw new ServiceUnavailableError("模型不存在、已停用或服务商不可用");
  if (!config.apiKeyCiphertext || !config.apiKeyIv || !config.apiKeyTag) {
    throw new ServiceUnavailableError(`模型服务商“${config.providerName}”尚未配置 API Key`);
  }
  const provider = createOpenAICompatible({
    name: config.providerName,
    baseURL: config.baseUrl.replace(/\/$/, ""),
    apiKey: decryptSecret(config.apiKeyCiphertext, config.apiKeyIv, config.apiKeyTag),
    includeUsage: true
  });
  return { ...config, languageModel: provider.chatModel(config.modelId) };
}

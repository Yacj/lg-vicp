/**
 * AI 运行时：场景 → 提示词版本 → 模型解析（reasoningMode/降级/fallback）→ 配额。
 * 模型按场景从数据库解析，禁止在业务代码写死服务商或模型 ID。
 */
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import type { Database } from "../../db/client.js";
import { aiScenes, prompts, promptVersions } from "../../db/schema.js";
import { AiError } from "../../shared/ai-errors.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { resolveModelById, type ResolvedModelConfig } from "../ai-config/ai-config.service.js";

export type ReasoningMode = "OFF" | "ON";

/** providerOptions 的值必须是 JSON 可序列化对象（AI SDK v7 ProviderOptions = Record<string, JSONObject>） */
export type ProviderOptionsValue =
  | string
  | number
  | boolean
  | null
  | ProviderOptionsValue[]
  | { [key: string]: ProviderOptionsValue };

export type ProviderOptionsMap = Record<string, Record<string, ProviderOptionsValue>>;

export interface SceneRuntime {
  sceneId: string;
  sceneCode: string;
  sceneName: string;
  allowReasoning: boolean;
  requireProject: boolean;
  allowFileUpload: boolean;
  allowKnowledgeSearch: boolean;
  allowTools: boolean;
  sceneTemperature: number | null;
  sceneMaxOutputTokens: number | null;
  promptVersionId: string;
  promptVersionNumber: number;
  promptContent: string;
  primary: ResolvedModelConfig;
  fallback: ResolvedModelConfig | null;
  reasoning: {
    mode: ReasoningMode;
    /** ON 且实际使用 reasoningModelId */
    reasoningModelUsed: boolean;
    /** 降级说明（写入消息 metadata 与日志） */
    downgradeNote: string | null;
  };
  providerOptions: ProviderOptionsMap | undefined;
}

/**
 * 按模型能力计算 reasoning 相关 providerOptions。
 * OFF：模型始终推理（reasoningAlwaysOn）时报错；ON：模型不支持推理时返回 undefined（由调用方决定降级策略）。
 */
export function resolveReasoningProviderOptions(
  config: Pick<ResolvedModelConfig, "modelId" | "providerName" | "capabilities">,
  mode: ReasoningMode
): ProviderOptionsMap | undefined {
  const capabilities = config.capabilities ?? {};
  if (mode === "OFF") {
    if (capabilities.reasoningAlwaysOn === true) {
      throw new AiError("AI_REASONING_NOT_SUPPORTED", "当前模型始终开启深度思考，请切换到普通对话模型");
    }
    return undefined;
  }
  // ON
  if (capabilities.reasoning !== true && capabilities.reasoningAlwaysOn !== true) {
    return undefined;
  }
  if (capabilities.reasoningAlwaysOn === true || capabilities.reasoningEffort !== true) {
    return undefined;
  }
  const providerKey = config.providerName.replace(/[-_]+([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return { [providerKey]: { reasoningEffort: "high" } };
}

/**
 * 解析场景运行时：
 * 1. 场景必须存在且启用；
 * 2. 必须存在已发布的提示词版本；
 * 3. reasoningMode=ON：allowReasoning 必须为 true，优先 reasoningModelId，不可用时按明确规则降级为默认模型并记录说明；
 * 4. 主模型失败时由调用方使用 fallback（仅一次，不无限重试）。
 */
export async function resolveSceneRuntime(
  db: Database,
  sceneCode: string,
  reasoningMode: ReasoningMode
): Promise<SceneRuntime> {
  const [scene] = await db.select().from(aiScenes)
    .where(and(eq(aiScenes.code, sceneCode), eq(aiScenes.enabled, true)))
    .limit(1);
  if (!scene) throw new AiError("AI_CONFIG_INVALID", `场景“${sceneCode}”未开放或尚未配置`);

  const [promptRow] = await db.select({ prompt: prompts, version: promptVersions })
    .from(prompts)
    .innerJoin(promptVersions, eq(promptVersions.id, prompts.activeVersionId))
    .where(and(eq(prompts.sceneId, scene.id), eq(promptVersions.status, "PUBLISHED")))
    .limit(1);
  if (!promptRow) {
    throw new AiError("AI_CONFIG_INVALID", `场景“${scene.name}”尚未配置生效的提示词版本`);
  }

  let primaryId = scene.defaultModelId;
  let reasoningModelUsed = false;
  let downgradeNote: string | null = null;
  let primaryResolved: ResolvedModelConfig | undefined;

  if (reasoningMode === "ON") {
    if (!scene.allowReasoning) {
      throw new AiError("AI_REASONING_NOT_SUPPORTED", "当前场景不支持深度思考");
    }
    if (scene.reasoningModelId) {
      try {
        primaryResolved = await resolveModelById(db, scene.reasoningModelId);
        primaryId = scene.reasoningModelId;
        reasoningModelUsed = true;
      } catch {
        // 推理模型不可用：降级到默认模型
      }
    }
    if (!reasoningModelUsed) {
      primaryId = scene.defaultModelId;
      downgradeNote = "推理模型不可用，已降级为场景默认模型";
    }
  }

  if (!primaryId) {
    throw new AiError("AI_CONFIG_INVALID", `场景“${scene.name}”尚未配置可用模型`);
  }
  const primary = primaryResolved ?? await resolveModelById(db, primaryId);
  if (!primary) {
    throw new AiError("AI_MODEL_UNAVAILABLE", `场景“${scene.name}”绑定的模型不可用`);
  }

  let providerOptions = resolveReasoningProviderOptions(primary, reasoningMode);
  if (reasoningMode === "ON" && !reasoningModelUsed && !providerOptions) {
    downgradeNote = "推理模型不可用，已降级为不支持深度思考的默认模型";
  }

  const fallback = scene.fallbackModelId && scene.fallbackModelId !== primaryId
    ? await resolveModelById(db, scene.fallbackModelId).catch(() => null)
    : null;

  return {
    sceneId: scene.id,
    sceneCode: scene.code,
    sceneName: scene.name,
    allowReasoning: scene.allowReasoning,
    requireProject: scene.requireProject,
    allowFileUpload: scene.allowFileUpload,
    allowKnowledgeSearch: scene.allowKnowledgeSearch,
    allowTools: scene.allowTools,
    sceneTemperature: scene.temperature,
    sceneMaxOutputTokens: scene.maxOutputTokens,
    promptVersionId: promptRow.version.id,
    promptVersionNumber: promptRow.version.version,
    promptContent: promptRow.version.content,
    primary,
    fallback,
    reasoning: {
      mode: reasoningMode,
      reasoningModelUsed,
      downgradeNote
    },
    providerOptions
  };
}

export interface AiQuota {
  exempt: boolean;
  dailyUsed: number;
  dailyLimit: number;
  concurrentUsed: number;
  concurrentLimit: number;
}

/**
 * 生成请求配额校验（发送消息 / 重新生成 / 报告草稿共用）：
 * - 超级管理员豁免；
 * - 单用户并发生成数限制（Redis 计数，生成结束后必须 releaseAiConcurrency）；
 * - 单用户每日请求数限制。
 * 并发计数成功后每日计数失败也会释放并发占位。
 */
export async function enforceAiQuota(app: FastifyInstance, user: AuthUser): Promise<AiQuota> {
  if (user.role === "SUPER_ADMIN") {
    return { exempt: true, dailyUsed: 0, dailyLimit: env.AI_DAILY_REQUEST_LIMIT, concurrentUsed: 0, concurrentLimit: env.AI_MAX_CONCURRENT_GENERATIONS };
  }

  const concurrentKey = `ai:active:${user.id}`;
  const concurrentUsed = await app.redis.incr(concurrentKey);
  if (concurrentUsed === 1) await app.redis.expire(concurrentKey, 900);
  if (concurrentUsed > env.AI_MAX_CONCURRENT_GENERATIONS) {
    await app.redis.decr(concurrentKey);
    throw new AiError("AI_QUOTA_EXCEEDED", "同时进行的 AI 生成任务过多，请稍后再试");
  }

  try {
    const day = new Date().toISOString().slice(0, 10);
    const dailyKey = `ai:quota:${user.id}:${day}`;
    const dailyUsed = await app.redis.incr(dailyKey);
    if (dailyUsed === 1) await app.redis.expire(dailyKey, 60 * 60 * 26);
    if (dailyUsed > env.AI_DAILY_REQUEST_LIMIT) {
      throw new AiError("AI_QUOTA_EXCEEDED", "今日 AI 使用次数已达上限，请明天再试");
    }
    return { exempt: false, dailyUsed, dailyLimit: env.AI_DAILY_REQUEST_LIMIT, concurrentUsed, concurrentLimit: env.AI_MAX_CONCURRENT_GENERATIONS };
  } catch (error) {
    await releaseAiConcurrency(app, user.id);
    throw error;
  }
}

export async function releaseAiConcurrency(app: FastifyInstance, userId: string) {
  const current = await app.redis.get(`ai:active:${userId}`);
  if (current && Number(current) > 0) await app.redis.decr(`ai:active:${userId}`);
}

export async function getAiQuota(app: FastifyInstance, user: AuthUser): Promise<AiQuota> {
  if (user.role === "SUPER_ADMIN") {
    return { exempt: true, dailyUsed: 0, dailyLimit: env.AI_DAILY_REQUEST_LIMIT, concurrentUsed: 0, concurrentLimit: env.AI_MAX_CONCURRENT_GENERATIONS };
  }
  const day = new Date().toISOString().slice(0, 10);
  const [dailyRaw, concurrentRaw] = await Promise.all([
    app.redis.get(`ai:quota:${user.id}:${day}`),
    app.redis.get(`ai:active:${user.id}`)
  ]);
  return {
    exempt: false,
    dailyUsed: Number(dailyRaw ?? 0),
    dailyLimit: env.AI_DAILY_REQUEST_LIMIT,
    concurrentUsed: Number(concurrentRaw ?? 0),
    concurrentLimit: env.AI_MAX_CONCURRENT_GENERATIONS
  };
}
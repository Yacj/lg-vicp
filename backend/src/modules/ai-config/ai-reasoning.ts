/**
 * 业务层推理强度只使用 LOW / HIGH / MAX。
 * Provider 别名映射仅允许出现在 Adapter 内部，禁止业务层静默降级（例如 MAX → HIGH）。
 */
import { AiError } from "../../shared/ai-errors.js";
import {
  getProviderAdapter,
  resolveProviderAdapterKey,
  type ProviderIdentity
} from "./ai-provider-adapter.js";

type ProviderOptionsMap = Record<string, Record<string, string | number | boolean | null>>;

export const REASONING_LEVELS = ["LOW", "HIGH", "MAX"] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return typeof value === "string" && (REASONING_LEVELS as readonly string[]).includes(value);
}

export interface ResolveReasoningConfigInput {
  provider: string | ProviderIdentity;
  modelId: string;
  level: ReasoningLevel;
}

export interface ResolvedReasoningConfig {
  level: ReasoningLevel;
  adapterKey: string;
  /** Provider 协议字段，仅用于调用，不得暴露给 B 端或 C 端 */
  effort: string;
  providerOptions: ProviderOptionsMap;
}

export function resolveReasoningConfig(input: ResolveReasoningConfigInput): ResolvedReasoningConfig {
  const identity: ProviderIdentity = typeof input.provider === "string"
    ? { code: input.provider, name: input.provider, baseUrl: "" }
    : input.provider;
  const adapterKey = resolveProviderAdapterKey(identity);
  const adapter = getProviderAdapter(adapterKey);
  if (!adapter.supportedReasoningLevels.includes(input.level)) {
    throw new AiError(
      "AI_REASONING_NOT_SUPPORTED",
      `当前模型不支持推理强度 ${input.level}，请改用已支持的强度并重新测试，系统不会自动降级`
    );
  }
  const effort = adapter.mapReasoningEffort(input.level, input.modelId);
  return {
    level: input.level,
    adapterKey,
    effort,
    providerOptions: {
      openaiCompatible: { reasoningEffort: effort }
    }
  };
}

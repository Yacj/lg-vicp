/**
 * Provider Adapter：统一 OpenAI Compatible 连接，并消化 DeepSeek 等服务商差异。
 * 思考链 reasoning_content 由 @ai-sdk/openai-compatible 在消息往返中处理，此处不重复实现，也不对外暴露。
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ReasoningLevel } from "./ai-reasoning.js";

export interface ProviderIdentity {
  code?: string | null;
  name: string;
  baseUrl: string;
}

export interface InternalModelCapabilities {
  text: boolean;
  toolCalling: boolean;
  streaming: boolean;
  structuredOutput: boolean;
  vision: boolean;
  reasoningLevels: ReasoningLevel[];
}

export interface ProviderAdapterProfile {
  key: string;
  supportedReasoningLevels: ReasoningLevel[];
  streaming: boolean;
  structuredOutput: boolean;
  isReasoningAlwaysOn(modelId: string): boolean;
  mapReasoningEffort(level: ReasoningLevel, modelId: string): string;
}

const ALL_REASONING_LEVELS: ReasoningLevel[] = ["LOW", "HIGH", "MAX"];

const DEEPSEEK_EFFORT: Record<ReasoningLevel, string> = {
  LOW: "low",
  HIGH: "high",
  MAX: "max"
};

const GENERIC_EFFORT: Record<ReasoningLevel, string> = {
  LOW: "low",
  HIGH: "high",
  MAX: "max"
};

export const DEEPSEEK_ADAPTER: ProviderAdapterProfile = {
  key: "deepseek",
  supportedReasoningLevels: ALL_REASONING_LEVELS,
  streaming: true,
  structuredOutput: true,
  isReasoningAlwaysOn(modelId) {
    return /reasoner/i.test(modelId);
  },
  mapReasoningEffort(level) {
    return DEEPSEEK_EFFORT[level];
  }
};

export const GENERIC_OPENAI_COMPATIBLE_ADAPTER: ProviderAdapterProfile = {
  key: "openai-compatible",
  supportedReasoningLevels: ALL_REASONING_LEVELS,
  streaming: true,
  structuredOutput: true,
  isReasoningAlwaysOn() {
    return false;
  },
  mapReasoningEffort(level) {
    return GENERIC_EFFORT[level];
  }
};

export function resolveProviderAdapterKey(provider: ProviderIdentity): string {
  const raw = `${provider.code ?? ""} ${provider.name} ${provider.baseUrl}`.toLowerCase();
  if (raw.includes("deepseek")) return DEEPSEEK_ADAPTER.key;
  return GENERIC_OPENAI_COMPATIBLE_ADAPTER.key;
}

export function getProviderAdapter(key: string): ProviderAdapterProfile {
  if (key === DEEPSEEK_ADAPTER.key) return DEEPSEEK_ADAPTER;
  return GENERIC_OPENAI_COMPATIBLE_ADAPTER;
}

export function resolveProviderAdapter(provider: ProviderIdentity): ProviderAdapterProfile {
  return getProviderAdapter(resolveProviderAdapterKey(provider));
}

export function createCompatibleLanguageModel(input: {
  provider: ProviderIdentity;
  apiKey: string;
  modelId: string;
}) {
  const adapter = resolveProviderAdapter(input.provider);
  const compatible = createOpenAICompatible({
    name: adapter.key,
    baseURL: input.provider.baseUrl.replace(/\/$/, ""),
    apiKey: input.apiKey,
    includeUsage: true
  });
  return compatible.chatModel(input.modelId);
}

export function adapterCapabilities(
  adapter: ProviderAdapterProfile,
  input: { supportsVision: boolean; admitted: boolean }
): InternalModelCapabilities {
  return {
    text: input.admitted,
    toolCalling: input.admitted,
    streaming: adapter.streaming,
    structuredOutput: adapter.structuredOutput,
    vision: input.admitted && input.supportsVision,
    reasoningLevels: adapter.supportedReasoningLevels
  };
}

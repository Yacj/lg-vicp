/**
 * 模型准入与运行时选择。正式 Runtime 只使用 enabled + lastTestStatus=PASSED 的模型。
 */
import { AiError } from "../../shared/ai-errors.js";
import { ConflictError } from "../../shared/errors.js";
import type { InternalModelCapabilities } from "./ai-provider-adapter.js";
import {
  adapterCapabilities,
  resolveProviderAdapter
} from "./ai-provider-adapter.js";
import type { ReasoningLevel } from "./ai-reasoning.js";

export const MODEL_TEST_STATUSES = ["UNTESTED", "PASSED", "FAILED"] as const;
export type ModelTestStatus = (typeof MODEL_TEST_STATUSES)[number];

export interface AiModelConfig {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  baseUrl?: string | null;
  credentialId?: string | null;
  supportsVision: boolean;
  reasoningLevel: ReasoningLevel;
  enabled: boolean;
  isDefault?: boolean;
  lastTestStatus: ModelTestStatus;
  lastTestAt?: string | null;
  lastTestError?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModelAdmissionSnapshot {
  enabled: boolean;
  lastTestStatus: ModelTestStatus;
  supportsVision: boolean;
  reasoningLevel: ReasoningLevel;
  provider?: string;
  modelId?: string;
}

export const MODEL_IDENTITY_FIELDS = [
  "providerId",
  "modelId",
  "supportsVision",
  "reasoningLevel"
] as const;

export type ModelIdentityField = (typeof MODEL_IDENTITY_FIELDS)[number];

export function isAdmittedForRuntime(model: Pick<ModelAdmissionSnapshot, "enabled" | "lastTestStatus">): boolean {
  return model.enabled === true && model.lastTestStatus === "PASSED";
}

export function validateModelForRuntime(
  model: ModelAdmissionSnapshot,
  options: { requireVision?: boolean } = {}
): void {
  if (!model.enabled) {
    throw new AiError("AI_MODEL_UNAVAILABLE", "模型已停用");
  }
  if (model.lastTestStatus !== "PASSED") {
    throw new AiError("AI_MODEL_UNAVAILABLE", "模型尚未通过准入测试，不能用于正式对话");
  }
  if (options.requireVision && !model.supportsVision) {
    throw new AiError("VISION_MODEL_NOT_CONFIGURED", "当前请求包含图片，但所选模型未声明视觉能力");
  }
}

export function assertCanEnableOrDefault(model: Pick<ModelAdmissionSnapshot, "lastTestStatus">, action: "enable" | "default"): void {
  if (model.lastTestStatus !== "PASSED") {
    throw new ConflictError(action === "default"
      ? "设为默认模型前必须通过准入测试"
      : "启用模型前必须通过准入测试");
  }
}

export function shouldInvalidateAdmission(before: {
  providerId: string;
  modelId: string;
  supportsVision: boolean;
  reasoningLevel: string;
}, after: Partial<{
  providerId: string;
  modelId: string;
  supportsVision: boolean;
  reasoningLevel: string;
}>): boolean {
  if (after.providerId !== undefined && after.providerId !== before.providerId) return true;
  if (after.modelId !== undefined && after.modelId !== before.modelId) return true;
  if (after.supportsVision !== undefined && after.supportsVision !== before.supportsVision) return true;
  if (after.reasoningLevel !== undefined && after.reasoningLevel !== before.reasoningLevel) return true;
  return false;
}

export function invalidatedAdmissionPatch() {
  return {
    lastTestStatus: "UNTESTED" as const,
    lastTestAt: null,
    lastTestError: null,
    enabled: false,
    isDefault: false
  };
}

export function pickDefaultRuntimeModelId(
  rows: Array<{ id: string; isDefault?: boolean | null; code?: string | null; supportsVision?: boolean | null; lastTestStatus?: string | null }>,
  options: { requireVision?: boolean } = {}
): string | null {
  const ready = rows.filter((row) => row.lastTestStatus === "PASSED"
    && (!options.requireVision || row.supportsVision === true));
  return ready.find((row) => row.isDefault === true)?.id
    ?? ready.find((row) => options.requireVision && row.code === "default_vision")?.id
    ?? ready.find((row) => !options.requireVision && row.code === "default_agent")?.id
    ?? ready[0]?.id
    ?? null;
}

export function deriveInternalCapabilities(input: {
  provider: { code?: string | null; name: string; baseUrl: string };
  supportsVision: boolean;
  lastTestStatus: ModelTestStatus;
}): InternalModelCapabilities {
  const adapter = resolveProviderAdapter(input.provider);
  return adapterCapabilities(adapter, {
    supportsVision: input.supportsVision,
    admitted: input.lastTestStatus === "PASSED"
  });
}

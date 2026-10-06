import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
});

import { resolveReasoningConfig } from "./ai-reasoning.js";
import { DEEPSEEK_ADAPTER, GENERIC_OPENAI_COMPATIBLE_ADAPTER, resolveProviderAdapterKey } from "./ai-provider-adapter.js";
import { getAiTaskRuntimePolicy, languageModelCallOptions } from "./ai-task-runtime-policy.js";
import {
  assertCanEnableOrDefault,
  isAdmittedForRuntime,
  pickDefaultRuntimeModelId,
  shouldInvalidateAdmission,
  validateModelForRuntime
} from "./ai-model-runtime.js";
import { runModelAdmissionChecks } from "./ai-model-test.service.js";
import { ConflictError } from "../../shared/errors.js";
import { AiError } from "../../shared/ai-errors.js";

describe("DeepSeek reasoning 映射", () => {
  it("LOW/HIGH/MAX 明确映射为 low/high/max，不静默降级", () => {
    expect(resolveReasoningConfig({
      provider: { code: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
      modelId: "deepseek-chat",
      level: "LOW"
    }).effort).toBe("low");
    expect(resolveReasoningConfig({
      provider: "deepseek",
      modelId: "deepseek-chat",
      level: "HIGH"
    }).effort).toBe("high");
    expect(resolveReasoningConfig({
      provider: "deepseek",
      modelId: "deepseek-chat",
      level: "MAX"
    }).providerOptions).toEqual({ openaiCompatible: { reasoningEffort: "max" } });
  });

  it("Adapter 识别 DeepSeek 与通用 OpenAI Compatible", () => {
    expect(resolveProviderAdapterKey({ code: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" }))
      .toBe(DEEPSEEK_ADAPTER.key);
    expect(resolveProviderAdapterKey({ code: "other", name: "Other", baseUrl: "https://example.com" }))
      .toBe(GENERIC_OPENAI_COMPATIBLE_ADAPTER.key);
  });
});

describe("模型准入与启用规则", () => {
  it("正式 Runtime 只接受 enabled + PASSED", () => {
    expect(isAdmittedForRuntime({ enabled: true, lastTestStatus: "PASSED" })).toBe(true);
    expect(isAdmittedForRuntime({ enabled: true, lastTestStatus: "UNTESTED" })).toBe(false);
    expect(isAdmittedForRuntime({ enabled: false, lastTestStatus: "PASSED" })).toBe(false);
    expect(() => validateModelForRuntime({
      enabled: true,
      lastTestStatus: "FAILED",
      supportsVision: false,
      reasoningLevel: "HIGH"
    })).toThrow(AiError);
  });

  it("图片请求额外要求 supportsVision", () => {
    expect(() => validateModelForRuntime({
      enabled: true,
      lastTestStatus: "PASSED",
      supportsVision: false,
      reasoningLevel: "HIGH"
    }, { requireVision: true })).toThrow(/视觉/);
  });

  it("未通过测试不能启用或设默认", () => {
    expect(() => assertCanEnableOrDefault({ lastTestStatus: "UNTESTED" }, "enable")).toThrow(ConflictError);
    expect(() => assertCanEnableOrDefault({ lastTestStatus: "FAILED" }, "default")).toThrow(ConflictError);
    expect(() => assertCanEnableOrDefault({ lastTestStatus: "PASSED" }, "default")).not.toThrow();
  });

  it("关键配置变化会使 PASSED 失效", () => {
    const before = {
      providerId: "p1",
      modelId: "deepseek-chat",
      supportsVision: false,
      reasoningLevel: "HIGH"
    };
    expect(shouldInvalidateAdmission(before, { modelId: "deepseek-reasoner" })).toBe(true);
    expect(shouldInvalidateAdmission(before, { supportsVision: true })).toBe(true);
    expect(shouldInvalidateAdmission(before, { reasoningLevel: "MAX" })).toBe(true);
    expect(shouldInvalidateAdmission(before, { providerId: "p2" })).toBe(true);
    expect(shouldInvalidateAdmission(before, { reasoningLevel: "HIGH" })).toBe(false);
  });

  it("选模不再看 supportsTools，只看已准入模型", () => {
    expect(pickDefaultRuntimeModelId([
      { id: "a", isDefault: false, lastTestStatus: "PASSED" },
      { id: "b", isDefault: true, lastTestStatus: "PASSED" }
    ])).toBe("b");
    expect(pickDefaultRuntimeModelId([
      { id: "vision-untested", supportsVision: true, lastTestStatus: "UNTESTED", isDefault: true }
    ], { requireVision: true })).toBeNull();
  });
});

describe("AiTaskRuntimePolicy", () => {
  it("CHAT 不强制 temperature，Agent 与内部任务分开", () => {
    expect(languageModelCallOptions("CHAT").temperature).toBeUndefined();
    expect(getAiTaskRuntimePolicy("PROJECT_AGENT").tools).toBe(true);
    expect(getAiTaskRuntimePolicy("CHAT").tools).toBe(false);
    expect(getAiTaskRuntimePolicy("MEMORY_EXTRACTION").reasoningOverride).toBe("LOW");
    expect(getAiTaskRuntimePolicy("COLLECTION_AGENT").tools).toBe(true);
  });
});

describe("真实 Agent 准入测试", () => {
  it("TOOL_CALLING 必须走 tool call → execute → 最终回答", async () => {
    let executed: string | undefined;
    const generate = async (options: { tools?: Record<string, { execute?: (input: { value: string }) => Promise<unknown> }> }) => {
      if (options.tools?.probe) {
        await options.tools.probe.execute?.({ value: "ping" });
        executed = "ping";
        return {
          text: "工具结果已确认",
          steps: [{ toolCalls: [{ toolName: "probe" }], toolResults: [{ value: "ping" }] }]
        };
      }
      return { text: "连接成功", steps: [] };
    };

    const report = await runModelAdmissionChecks({
      languageModel: {} as never,
      provider: { code: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
      modelId: "deepseek-chat",
      reasoningLevel: "HIGH",
      supportsVision: false,
      generate: generate as never
    });
    expect(executed).toBe("ping");
    expect(report.ok).toBe(true);
    expect(report.checks.toolCalling.ok).toBe(true);
    expect(report.checks.vision).toBeUndefined();
  });

  it("只返回文本不调用工具时禁止作为 Agent 模型通过", async () => {
    const generate = async () => ({ text: "你好", steps: [] });
    const report = await runModelAdmissionChecks({
      languageModel: {} as never,
      provider: { code: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
      modelId: "deepseek-chat",
      reasoningLevel: "HIGH",
      supportsVision: false,
      generate: generate as never
    });
    expect(report.ok).toBe(false);
    expect(report.checks.toolCalling.ok).toBe(false);
  });

  it("supportsVision=true 时必须真实测图片，声明与能力不一致则失败", async () => {
    const generate = async (options: { messages?: unknown }) => {
      if (options.messages) return { text: "无法识别图片", steps: [] };
      return {
        text: "连接成功",
        steps: [{ toolCalls: [{ toolName: "probe" }], toolResults: [{ value: "ping" }] }]
      };
    };
    const failing = await runModelAdmissionChecks({
      languageModel: {} as never,
      provider: { code: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
      modelId: "deepseek-chat",
      reasoningLevel: "HIGH",
      supportsVision: true,
      generate: (async (options: { tools?: Record<string, { execute?: (input: { value: string }) => Promise<unknown> }>; messages?: unknown }) => {
        if (options.tools?.probe) {
          await options.tools.probe.execute?.({ value: "ping" });
          return { text: "工具结果已确认", steps: [{ toolCalls: [{ toolName: "probe" }] }] };
        }
        return generate(options);
      }) as never
    });
    expect(failing.checks.vision?.ok).toBe(false);
    expect(failing.ok).toBe(false);
  });

  it("supportsVision=false 时不跑视觉检查", async () => {
    const report = await runModelAdmissionChecks({
      languageModel: {} as never,
      provider: { code: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
      modelId: "deepseek-chat",
      reasoningLevel: "MAX",
      supportsVision: false,
      generate: (async (options: { tools?: Record<string, { execute?: (input: { value: string }) => Promise<unknown> }> }) => {
        if (options.tools?.probe) {
          await options.tools.probe.execute?.({ value: "ping" });
          return { text: "工具结果已确认", steps: [{ toolCalls: [{ toolName: "probe" }] }] };
        }
        return { text: "连接成功", steps: [] };
      }) as never
    });
    expect(report.checks.vision).toBeUndefined();
    expect(report.checks.reasoning.ok).toBe(true);
  });
});

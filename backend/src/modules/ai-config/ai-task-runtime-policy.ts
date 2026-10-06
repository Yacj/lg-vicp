/**
 * 内部任务运行时策略。采样、输出上限、超时、工具与步数由任务类型决定，不来自 B 端模型配置。
 */
import { env } from "../../config/env.js";
import type { ReasoningLevel } from "./ai-reasoning.js";

export type AiTaskType =
  | "CHAT"
  | "KNOWLEDGE"
  | "SUMMARY"
  | "MEMORY_EXTRACTION"
  | "PROJECT_AGENT"
  | "REPORT"
  | "COLLECTION_AGENT"
  | "TITLE"
  | "VISION"
  | "MODEL_TEST";

export interface AiTaskRuntimePolicy {
  taskType: AiTaskType;
  /** 未设置时使用 Provider 默认，不把 B 端温度传给正式调用 */
  temperature?: number;
  maxOutputTokens: number;
  timeoutMs: number;
  tools: boolean;
  maxSteps: number;
  structuredOutput: boolean;
  /** 覆盖模型默认推理强度；未设置时：会话 ON 用模型 reasoningLevel，OFF 不传推理参数 */
  reasoningOverride?: ReasoningLevel;
}

const POLICIES: Record<AiTaskType, AiTaskRuntimePolicy> = {
  CHAT: {
    taskType: "CHAT",
    maxOutputTokens: 4096,
    timeoutMs: 60_000,
    tools: false,
    maxSteps: 1,
    structuredOutput: false
  },
  KNOWLEDGE: {
    taskType: "KNOWLEDGE",
    maxOutputTokens: 4096,
    timeoutMs: 60_000,
    tools: false,
    maxSteps: 1,
    structuredOutput: false
  },
  SUMMARY: {
    taskType: "SUMMARY",
    temperature: 0,
    maxOutputTokens: 1200,
    timeoutMs: 45_000,
    tools: false,
    maxSteps: 1,
    structuredOutput: true,
    reasoningOverride: "LOW"
  },
  MEMORY_EXTRACTION: {
    taskType: "MEMORY_EXTRACTION",
    temperature: 0,
    maxOutputTokens: 1200,
    timeoutMs: 45_000,
    tools: false,
    maxSteps: 1,
    structuredOutput: true,
    reasoningOverride: "LOW"
  },
  PROJECT_AGENT: {
    taskType: "PROJECT_AGENT",
    maxOutputTokens: 4096,
    timeoutMs: 120_000,
    tools: true,
    maxSteps: 8,
    structuredOutput: false
  },
  REPORT: {
    taskType: "REPORT",
    maxOutputTokens: 4000,
    timeoutMs: 60_000,
    tools: false,
    maxSteps: 1,
    structuredOutput: true
  },
  COLLECTION_AGENT: {
    taskType: "COLLECTION_AGENT",
    maxOutputTokens: 2048,
    timeoutMs: 120_000,
    tools: true,
    maxSteps: 12,
    structuredOutput: false,
    reasoningOverride: "LOW"
  },
  TITLE: {
    taskType: "TITLE",
    temperature: 0,
    maxOutputTokens: 60,
    timeoutMs: 20_000,
    tools: false,
    maxSteps: 1,
    structuredOutput: false,
    reasoningOverride: "LOW"
  },
  VISION: {
    taskType: "VISION",
    maxOutputTokens: 1200,
    timeoutMs: 60_000,
    tools: false,
    maxSteps: 1,
    structuredOutput: false,
    reasoningOverride: "LOW"
  },
  MODEL_TEST: {
    taskType: "MODEL_TEST",
    temperature: 0,
    maxOutputTokens: 256,
    timeoutMs: 45_000,
    tools: true,
    maxSteps: 4,
    structuredOutput: false
  }
};

export function getAiTaskRuntimePolicy(taskType: AiTaskType): AiTaskRuntimePolicy {
  const policy = POLICIES[taskType];
  if (taskType === "PROJECT_AGENT") {
    return {
      ...policy,
      timeoutMs: env.AI_AGENT_OVERALL_TIMEOUT_MS,
      maxSteps: env.AI_AGENT_MAX_STEPS
    };
  }
  return policy;
}

/** 生成 AI SDK 调用共用的运行时参数，省略 temperature 表示使用 Provider 默认。 */
export function languageModelSamplingOptions(taskType: AiTaskType) {
  const policy = getAiTaskRuntimePolicy(taskType);
  return {
    maxOutputTokens: policy.maxOutputTokens,
    ...(policy.temperature === undefined ? {} : { temperature: policy.temperature })
  };
}

export function languageModelCallOptions(taskType: AiTaskType) {
  return {
    ...languageModelSamplingOptions(taskType),
    timeout: getAiTaskRuntimePolicy(taskType).timeoutMs
  };
}

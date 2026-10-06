/**
 * 模型准入测试：真实调用 TEXT / TOOL_CALLING（含 Agent 回环）/ REASONING / 按需 VISION。
 * 不得只根据 Provider 文档声明“支持 Tools”而放行。
 */
import { generateText, stepCountIs, tool } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { aiModels } from "../../db/schema.js";
import { AiError } from "../../shared/ai-errors.js";
import { NotFoundError } from "../../shared/errors.js";
import { loadModelForAdmin } from "./ai-config.service.js";
import { resolveReasoningConfig } from "./ai-reasoning.js";
import { getAiTaskRuntimePolicy, languageModelCallOptions } from "./ai-task-runtime-policy.js";

export type AdmissionCheckName = "connection" | "text" | "toolCalling" | "reasoning" | "vision";

export interface AdmissionCheckResult {
  ok: boolean;
  message: string;
}

export interface ModelAdmissionReport {
  ok: boolean;
  checks: {
    connection: AdmissionCheckResult;
    text: AdmissionCheckResult;
    toolCalling: AdmissionCheckResult;
    reasoning: AdmissionCheckResult;
    vision?: AdmissionCheckResult;
  };
}

const TEXT_PROMPT = "这是一次系统准入测试。请只回复：连接成功。";
const TOOL_PROMPT = [
  "这是一次工具调用准入测试。",
  "你必须调用 probe 工具，参数 value 固定为 ping。",
  "收到工具结果后，用中文给出一句最终确认，不要再调用工具。"
].join("");
const REASONING_PROMPT = "这是一次推理强度准入测试。请只回复：推理配置有效。";
const VISION_PROMPT = "请用一句话描述这张图片。如果无法查看图片，明确说明无法识别。";

/** 1x1 PNG，仅用于视觉能力探测，不展示给用户 */
const VISION_PROBE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

export function createAdmissionProbeTool(onExecute: (value: string) => void) {
  return tool({
    description: "用于验证模型是否能够完成系统要求的工具调用",
    inputSchema: z.object({
      value: z.string().describe("固定测试值")
    }),
    execute: async ({ value }) => {
      onExecute(value);
      return { value };
    }
  });
}

function failed(message: string): AdmissionCheckResult {
  return { ok: false, message };
}

function passed(message: string): AdmissionCheckResult {
  return { ok: true, message };
}

export function summarizeAdmissionError(report: ModelAdmissionReport): string {
  const parts = Object.entries(report.checks)
    .filter(([, check]) => check && !check.ok)
    .map(([name, check]) => `${name}: ${check!.message}`);
  return parts.join("；") || "准入测试失败";
}

function hasToolRoundtrip(result: {
  text: string;
  steps?: Array<{ toolCalls?: Array<{ toolName?: string }>; toolResults?: unknown[] }>;
  executedValue?: string;
}): boolean {
  const toolCalled = (result.steps ?? []).some((step) =>
    (step.toolCalls ?? []).some((call) => call.toolName === "probe")
  );
  const continued = (result.text ?? "").trim().length > 0;
  return toolCalled && result.executedValue === "ping" && continued;
}

export async function runModelAdmissionChecks(input: {
  languageModel: Parameters<typeof generateText>[0]["model"];
  provider: { code?: string | null; name: string; baseUrl: string };
  modelId: string;
  reasoningLevel: "LOW" | "HIGH" | "MAX";
  supportsVision: boolean;
  generate?: typeof generateText;
}): Promise<ModelAdmissionReport> {
  const generate = input.generate ?? generateText;
  const call = languageModelCallOptions("MODEL_TEST");

  const connection = passed("已建立模型连接");
  const checks: ModelAdmissionReport["checks"] = {
    connection,
    text: failed("未执行"),
    toolCalling: failed("未执行"),
    reasoning: failed("未执行")
  };

  try {
    const textResult = await generate({
      model: input.languageModel,
      prompt: TEXT_PROMPT,
      ...call
    });
    const text = textResult.text.trim();
    checks.text = text
      ? passed("已返回有效文本")
      : failed("模型未返回有效文本");
  } catch (error) {
    checks.connection = failed("连接测试失败，请检查 Base URL 与 API Key");
    checks.text = failed(error instanceof Error ? "文本调用失败" : "文本调用失败");
  }

  let executedValue: string | undefined;
  try {
    const probe = createAdmissionProbeTool((value) => {
      executedValue = value;
    });
    const toolResult = await generate({
      model: input.languageModel,
      prompt: TOOL_PROMPT,
      tools: { probe },
      stopWhen: stepCountIs(getAiTaskRuntimePolicy("MODEL_TEST").maxSteps),
      ...call
    });
    checks.toolCalling = hasToolRoundtrip({
      text: toolResult.text,
      steps: toolResult.steps as never,
      executedValue
    })
      ? passed("已完成工具调用、校验、执行并继续给出最终回答")
      : failed("模型未完成真实工具调用回环，不能作为正式 Agent 模型启用");
  } catch {
    checks.toolCalling = failed("工具调用测试失败，当前模型不能用于 Agent");
  }

  try {
    const reasoning = resolveReasoningConfig({
      provider: input.provider,
      modelId: input.modelId,
      level: input.reasoningLevel
    });
    const reasoningResult = await generate({
      model: input.languageModel,
      prompt: REASONING_PROMPT,
      providerOptions: reasoning.providerOptions,
      ...call
    });
    checks.reasoning = reasoningResult.text.trim()
      ? passed(`推理强度 ${input.reasoningLevel} 已按当前服务商正确映射并调用`)
      : failed("推理强度调用未返回有效文本");
  } catch (error) {
    checks.reasoning = failed(error instanceof AiError
      ? error.message
      : `推理强度 ${input.reasoningLevel} 调用失败，系统不会自动降级`);
  }

  if (input.supportsVision) {
    try {
      const visionResult = await generate({
        model: input.languageModel,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: VISION_PROMPT },
            { type: "image", image: VISION_PROBE_PNG }
          ]
        }],
        ...call
      });
      const visionText = visionResult.text.trim();
      const denied = /无法识别|不能查看|不支持.*图|image.*(not supported|unsupported)/i.test(visionText);
      checks.vision = visionText && !denied
        ? passed("已完成真实图片输入测试")
        : failed("模型声明支持视觉，但实际无法处理图片输入");
    } catch {
      checks.vision = failed("模型声明支持视觉，但实际图片输入调用失败");
    }
  }

  const required = [checks.connection, checks.text, checks.toolCalling, checks.reasoning, checks.vision]
    .filter((item): item is AdmissionCheckResult => Boolean(item));
  return {
    ok: required.every((item) => item.ok),
    checks
  };
}

export async function testModelAdmission(db: Database, modelId: string): Promise<ModelAdmissionReport> {
  const resolved = await loadModelForAdmin(db, modelId);
  if (!resolved) throw new NotFoundError("AI 模型不存在");

  const report = await runModelAdmissionChecks({
    languageModel: resolved.languageModel,
    provider: {
      code: resolved.providerCode,
      name: resolved.providerName,
      baseUrl: resolved.baseUrl
    },
    modelId: resolved.modelId,
    reasoningLevel: resolved.reasoningLevel,
    supportsVision: resolved.supportsVision
  });

  const capabilities = {
    text: report.checks.text.ok,
    streaming: true,
    tools: report.checks.toolCalling.ok,
    toolCalling: report.checks.toolCalling.ok,
    vision: resolved.supportsVision && report.checks.vision?.ok === true,
    reasoning: report.checks.reasoning.ok,
    structuredOutput: true
  };

  await db.update(aiModels).set({
    lastTestStatus: report.ok ? "PASSED" : "FAILED",
    lastTestAt: new Date(),
    lastTestError: report.ok ? null : summarizeAdmissionError(report),
    capabilities,
    updatedAt: new Date()
  }).where(eq(aiModels.id, modelId));

  return report;
}

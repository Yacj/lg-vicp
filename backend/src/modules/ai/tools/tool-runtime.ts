/**
 * Chat Agent Tool 运行时：权限/超时/循环防护/落库由 Backend 强制，不交给模型。
 */
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { aiToolCalls } from "../../../db/schema.js";
import { AiError } from "../../../shared/ai-errors.js";
import type { AuthUser } from "../../../shared/auth-user.js";
import type { AgentToolName } from "../ai-capability-router.js";
import type { ConversationRow } from "../ai-context-builder.js";
import type { SelectedChoice, SelectedComparison, AgentWaitType } from "../agent-choice.js";
import type { ConversationTaskState } from "../conversation-task.js";
import type { UserSelectionKind, UserSelectionRequest } from "../user-selection.js";
import { toolError, type ToolErrorOutput } from "./tool-output.js";
import { toModelVisibleToolOutput } from "./tool-result-normalizer.js";

export const TOOL_STATUS_LABELS: Record<AgentToolName, string> = {
  search_knowledge: "正在查询知识库…",
  get_project_state: "正在读取项目状态…",
  get_product_data: "正在读取产品资料…",
  thermal: "正在处理热工查询…",
  compare_solutions: "正在比较方案…",
  compare_products: "正在比较产品…",
  generate_report: "正在生成报告…"
};

const DEFAULT_TOOL_TIMEOUT_MS = 20_000;
const OUTPUT_STORE_LIMIT = 8_000;

export type AgentWaitSignal = {
  __agentSignal: "WAITING_USER_INPUT";
  type?: AgentWaitType;
  selectionKind?: UserSelectionKind;
  title?: string;
  prompt: string;
  options?: unknown[];
  multiple?: boolean;
  minSelections?: number;
  maxSelections?: number;
  autoSelectWhenSingle?: boolean;
  confirmAction?: { type: "CONTINUE" | "GENERATE_REPORT"; label: string };
  request?: UserSelectionRequest;
  comparisonResult?: unknown;
  sourceToolCallId?: string;
};

export function isAgentWaitSignal(value: unknown): value is AgentWaitSignal {
  return Boolean(value && typeof value === "object" && (value as AgentWaitSignal).__agentSignal === "WAITING_USER_INPUT");
}

export function hashToolInput(toolName: string, input: unknown): string {
  return createHash("sha256").update(`${toolName}:${stableStringify(input)}`).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function summarizeToolPayload(value: unknown, limit = OUTPUT_STORE_LIMIT): Record<string, unknown> {
  const json = typeof value === "object" && value !== null ? value as Record<string, unknown> : { value };
  const text = JSON.stringify(json);
  if (text.length <= limit) return json;
  return { truncated: true, preview: text.slice(0, limit) };
}

export interface ToolRuntimeContext {
  app: FastifyInstance;
  request: FastifyRequest;
  user: AuthUser;
  conversation: ConversationRow;
  assistantMessageId: string;
  agentRunId: string;
  abortSignal: AbortSignal;
  recentToolHashes: string[];
  toolCallCount: { value: number };
  maxToolCalls: number;
  duplicateLimit: number;
  selectedChoice?: SelectedChoice | null;
  selectedComparison?: SelectedComparison | null;
  selectedUserSelection?: import("../user-selection.js").UserSelectionResult | null;
  taskState?: ConversationTaskState | null;
  answerContract?: string | null;
  /** 本轮用户原始提问：用于工具在模型未显式给参数时做确定性兜底（如 K 查询语义） */
  userMessage?: string | null;
  onWait?: (signal: AgentWaitSignal) => void;
  onEvent?: (event: string, data: unknown) => void;
}

function detectDuplicateFromCtx(ctx: ToolRuntimeContext, nextHash: string): boolean {
  if (ctx.recentToolHashes.length === 0) return false;
  let streak = 0;
  for (let i = ctx.recentToolHashes.length - 1; i >= 0; i -= 1) {
    if (ctx.recentToolHashes[i] === nextHash) streak += 1;
    else break;
  }
  return streak + 1 >= ctx.duplicateLimit;
}

export async function persistToolCall(
  ctx: ToolRuntimeContext,
  input: {
    toolName: string;
    args: Record<string, unknown>;
    output: unknown;
    success: boolean;
    errorMessage?: string;
    durationMs: number;
    auditMetadata?: Record<string, unknown>;
  }
) {
  await ctx.app.db.insert(aiToolCalls).values({
    conversationId: ctx.conversation.id,
    messageId: ctx.assistantMessageId,
    agentRunId: ctx.agentRunId,
    toolName: input.toolName,
    inputJson: summarizeToolPayload(input.args),
    outputJson: { ...summarizeToolPayload(input.output), ...input.auditMetadata },
    inputHash: hashToolInput(input.toolName, input.args),
    success: input.success,
    errorMessage: input.errorMessage ?? null,
    durationMs: input.durationMs
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : { value };
}

/**
 * 在 typed execute 内部调用：保留 inputSchema 推导的参数类型，
 * 同时强制超时、循环检测、落库和 SSE 状态。
 */
export async function runRegisteredTool<TInput, TOutput>(
  ctx: ToolRuntimeContext,
  name: AgentToolName,
  input: TInput,
  options: { toolCallId: string; abortSignal?: AbortSignal; statusMessage?: string; auditMetadata?: () => Record<string, unknown> },
  execute: () => Promise<TOutput>,
  timeoutMs = DEFAULT_TOOL_TIMEOUT_MS
): Promise<TOutput | ToolErrorOutput> {
  const statusMessage = options.statusMessage ?? TOOL_STATUS_LABELS[name];
  ctx.onEvent?.("tool_start", { toolName: name, message: statusMessage });
  ctx.onEvent?.("agent_status", { toolName: name, message: statusMessage });
  const args = asRecord(input);
  const hash = hashToolInput(name, input);
  if (detectDuplicateFromCtx(ctx, hash)) {
    throw new AiError("AGENT_LOOP_LIMIT");
  }
  if (ctx.toolCallCount.value >= ctx.maxToolCalls) {
    throw new AiError("AGENT_LOOP_LIMIT");
  }
  ctx.recentToolHashes.push(hash);
  ctx.toolCallCount.value += 1;
  const started = Date.now();
  const timeout = AbortSignal.timeout(timeoutMs);
  const linked = AbortSignal.any([ctx.abortSignal, options.abortSignal, timeout].filter(Boolean) as AbortSignal[]);
  try {
    if (linked.aborted) throw new AiError("AGENT_TOOL_TIMEOUT");
    const output = await Promise.race([
      execute(),
      new Promise<never>((_, reject) => {
        linked.addEventListener("abort", () => {
          reject(new AiError(ctx.abortSignal.aborted ? "AGENT_CANCELLED" : "AGENT_TOOL_TIMEOUT"));
        }, { once: true });
      })
    ]);
    if (isAgentWaitSignal(output)) {
      ctx.onWait?.({ ...output, sourceToolCallId: output.sourceToolCallId ?? options.toolCallId });
    }
    await persistToolCall(ctx, {
      toolName: name,
      args,
      output,
      success: true,
      auditMetadata: options.auditMetadata?.(),
      durationMs: Date.now() - started
    });
    ctx.onEvent?.("tool_result", { toolName: name, success: true });
    return toModelVisibleToolOutput(output) as TOutput;
  } catch (error) {
    if (error instanceof AiError && (error.code === "AGENT_LOOP_LIMIT" || error.code === "AGENT_CANCELLED")) {
      throw error;
    }
    const aiError = error instanceof AiError
      ? error
      : new AiError("AI_PROVIDER_UNAVAILABLE", error instanceof Error ? error.message : "工具执行失败");
    const payload = toolError({
      code: aiError.code,
      message: aiError.message,
      recoverable: aiError.code !== "AGENT_TOOL_TIMEOUT" || !ctx.abortSignal.aborted
    });
    await persistToolCall(ctx, {
      toolName: name,
      args,
      output: payload,
      success: false,
      auditMetadata: options.auditMetadata?.(),
      errorMessage: aiError.message,
      durationMs: Date.now() - started
    });
    ctx.onEvent?.("tool_result", { toolName: name, success: false, error: aiError.message });
    if (aiError.code === "AGENT_TOOL_TIMEOUT" && ctx.abortSignal.aborted) throw aiError;
    return payload;
  }
}

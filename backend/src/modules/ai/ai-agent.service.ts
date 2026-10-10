import { REFERENCE_LOOKUP_ANSWER_SYSTEM_PROMPT, renderAllowedFactsForModel, validateOrRepairThermalAnswer } from "./thermal-answer-validation.js";
/**
 * Agent Run：AI SDK streamText + tool() + stepCountIs。
 * resolveAiCapabilities 只做预路由，不代替模型选 Tool。
 * WAITING_USER_INPUT 必须持久化 SDK 产生的 assistant tool-call / tool result / assistant text。
 */
import { generateText, streamText, stepCountIs, type LanguageModelUsage, type ModelMessage } from "ai";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../config/env.js";
import { aiAgentRuns, aiConversations, projects } from "../../db/schema.js";
import { AiError, toAiError } from "../../shared/ai-errors.js";
import { isAbortError } from "./ai-sse.js";
import { UserSelectionError } from "./user-selection.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { NotFoundError } from "../../shared/errors.js";
import { canViewProject } from "../../shared/permissions.js";
import type { ResolvedModelConfig } from "../ai-config/ai-config.service.js";
import { resolveAgentModelOrNull } from "../ai-config/ai-config.service.js";
import { getAiTaskRuntimePolicy, languageModelCallOptions } from "../ai-config/ai-task-runtime-policy.js";
import { normalizeAllowedToolNames, type AgentToolName } from "./ai-capability-router.js";
import type { ConversationRow } from "./ai-context-builder.js";
import { createAgentTools, type ToolRuntimeContext } from "./ai-tools.js";
import { writeSse } from "./ai-sse.js";
import type { SceneRuntime } from "./ai-runtime.service.js";
import {
  attachUserSelectionRequest,
  formatChoiceResumeMessage,
  formatComparisonSelectionResumeMessage,
  isComparisonSelectionWait,
  parseAgentWaitState,
  parseSelectedChoice,
  parseSelectedComparison,
  resolveChoiceFromInput,
  resolveComparisonSelectionFromInput,
  resolveUserSelectionFromInput,
  waitStateToUserSelectionRequest,
  type AgentWaitState,
  type SelectedChoice,
  type SelectedComparison
} from "./agent-choice.js";
import { formatUserSelectionResumeMessage, type UserSelectionResult } from "./user-selection.js";
import type { ConversationTaskState } from "./conversation-task.js";
import { normalizeConversationLookupQuery } from "./tools/thermal-lookup.js";
import {
  applyAgentStreamPart,
  classifyFinishedStep,
  classifyInterruptedStep,
  createAgentStepBuffer,
  splitVisibleAnswerChunks,
  type AgentStepBuffer
} from "./ai-agent-step-buffer.js";
import { formatUserVisibleAnswer } from "./ai-answer-format.js";

export const AGENT_LOOP_REMINDER = [
  "【工具循环】",
  "继续遵守执行规范、用户回答规则和最终答案形态。",
  "工具结果只用于判断。只有最终答案进入聊天正文，不要描述准备调用或已经调用了什么。"
].join("\n");

/** 兼容旧引用：Agent 循环只追加提醒，完整执行规范已在 Prompt Assembly 中。 */
export const AGENT_SYSTEM_EXTRA = AGENT_LOOP_REMINDER;

export type AgentRunRow = typeof aiAgentRuns.$inferSelect;

export type { AgentWaitState, SelectedChoice, SelectedComparison };

export type AgentRunState = {
  system: string;
  messages: ModelMessage[];
  waiting?: AgentWaitState;
  selectedChoice?: SelectedChoice;
  selectedComparison?: SelectedComparison;
  selectedUserSelection?: UserSelectionResult;
  generateReportNow?: boolean;
  sources: unknown[];
  recentToolHashes: string[];
  /** 兼容旧字段：等于 userVisibleText */
  fullText: string;
  /** 最终给用户看的正文，不含 Tool 前过渡文本 */
  userVisibleText: string;
  /** Tool Step 内部文本，仅供排查，不得写入用户消息 */
  internalStepText: string;
};

export function applyResponseMessages(
  baseMessages: ModelMessage[],
  responseMessages: ReadonlyArray<ModelMessage>
): ModelMessage[] {
  return [...baseMessages, ...responseMessages];
}

export function parseAgentRunState(raw: unknown): AgentRunState {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const userVisibleText = typeof value.userVisibleText === "string"
    ? value.userVisibleText
    : typeof value.fullText === "string" ? value.fullText : "";
  return {
    system: typeof value.system === "string" ? value.system : "",
    messages: Array.isArray(value.messages) ? value.messages as ModelMessage[] : [],
    waiting: parseAgentWaitState(value),
    selectedChoice: parseSelectedChoice(value),
    selectedComparison: parseSelectedComparison(value),
    generateReportNow: value.generateReportNow === true,
    sources: Array.isArray(value.sources) ? value.sources : [],
    recentToolHashes: Array.isArray(value.recentToolHashes)
      ? value.recentToolHashes.filter((item): item is string => typeof item === "string")
      : [],
    fullText: userVisibleText,
    userVisibleText,
    internalStepText: typeof value.internalStepText === "string" ? value.internalStepText : ""
  };
}

export async function resolveAgentModel(
  runtime: SceneRuntime,
  db: Parameters<typeof resolveAgentModelOrNull>[0]
): Promise<ResolvedModelConfig | null> {
  if (!runtime.allowTools) return null;
  if (runtime.primary.lastTestStatus === "PASSED" && runtime.primary.modelRef.enabled) {
    return runtime.primary;
  }
  return resolveAgentModelOrNull(db);
}

export function isStaleRunningAgentRun(
  row: Pick<AgentRunRow, "status" | "startedAt">,
  now = Date.now(),
  timeoutMs = env.AI_AGENT_OVERALL_TIMEOUT_MS
) {
  return row.status === "RUNNING" && now - row.startedAt.getTime() > timeoutMs;
}

async function expireStaleRunningAgentRun(app: FastifyInstance, row: AgentRunRow | null) {
  if (!row || !isStaleRunningAgentRun(row)) return row;
  await failAgentRun(app, row.id, new AiError("AI_MODEL_TIMEOUT"));
  const [fresh] = await app.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, row.id)).limit(1);
  return fresh ?? row;
}

export async function getActiveAgentRun(app: FastifyInstance, conversationId: string) {
  const [row] = await app.db.select().from(aiAgentRuns).where(and(
    eq(aiAgentRuns.conversationId, conversationId),
    inArray(aiAgentRuns.status, ["RUNNING", "WAITING_USER_INPUT"])
  )).orderBy(desc(aiAgentRuns.startedAt)).limit(1);
  const current = await expireStaleRunningAgentRun(app, row ?? null);
  if (!current || (current.status !== "RUNNING" && current.status !== "WAITING_USER_INPUT")) return null;
  return current;
}

export async function getAgentRunById(app: FastifyInstance, runId: string) {
  const [row] = await app.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, runId)).limit(1);
  return expireStaleRunningAgentRun(app, row ?? null);
}

export function toWaitingSsePayload(runId: string, waiting: AgentWaitState) {
  const withRequest = waiting.request ? waiting : attachUserSelectionRequest(waiting);
  const request = withRequest.request ?? waitStateToUserSelectionRequest(withRequest);
  return {
    runId,
    type: "USER_SELECTION" as const,
    selectionKind: request.selectionKind,
    request,
    title: withRequest.title,
    prompt: withRequest.prompt,
    options: withRequest.options ?? [],
    multiple: request.multiple,
    minSelections: request.minSelections,
    maxSelections: request.maxSelections,
    autoSelectWhenSingle: request.autoSelectWhenSingle,
    confirmAction: request.confirmAction,
    comparisonResult: withRequest.comparisonResult,
    legacyType: withRequest.type
  };
}

export function toAgentRunDto(row: AgentRunRow) {
  const state = parseAgentRunState(row.stateJson);
  return {
    id: row.id,
    conversationId: row.conversationId,
    status: row.status,
    currentStep: row.currentStep,
    allowedTools: normalizeAllowedToolNames(row.allowedToolsJson),
    waitingPrompt: state.waiting?.prompt ?? null,
    waitingOptions: state.waiting?.options ?? null,
    waiting: state.waiting
      ? {
        ...toWaitingSsePayload(row.id, state.waiting),
        type: state.waiting.type === "APPROVAL" ? "APPROVAL" : "USER_SELECTION",
        title: state.waiting.title,
        prompt: state.waiting.prompt,
        options: state.waiting.options,
        multiple: state.waiting.multiple ?? isComparisonSelectionWait(state.waiting),
        minSelections: state.waiting.minSelections,
        confirmAction: state.waiting.confirmAction,
        comparisonResult: state.waiting.comparisonResult
      }
      : null,
    selectedChoice: state.selectedChoice
      ? { optionId: state.selectedChoice.optionId, label: state.selectedChoice.option.label }
      : null,
    selectedComparison: state.selectedComparison
      ? { optionIds: state.selectedComparison.optionIds, labels: state.selectedComparison.options.map((item) => item.label) }
      : null,
    model: row.model,
    toolCallCount: row.toolCallCount,
    tokenUsage: row.tokenUsageJson,
    errorMessage: row.errorMessage,
    errorCode: row.errorCode,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt
  };
}

export async function createAgentRun(app: FastifyInstance, input: {
  conversation: ConversationRow;
  user: AuthUser;
  triggerMessageId: string;
  assistantMessageId: string;
  allowedTools: AgentToolName[];
  model: string;
  state: AgentRunState;
}) {
  const [row] = await app.db.insert(aiAgentRuns).values({
    conversationId: input.conversation.id,
    triggerMessageId: input.triggerMessageId,
    assistantMessageId: input.assistantMessageId,
    userId: input.user.id,
    projectId: input.conversation.projectId,
    status: "RUNNING",
    currentStep: 0,
    allowedToolsJson: input.allowedTools,
    stateJson: input.state,
    model: input.model
  }).returning();
  return row!;
}

export async function cancelAgentRun(app: FastifyInstance, runId: string, errorMessage = "用户取消") {
  await app.db.update(aiAgentRuns).set({
    status: "CANCELLED",
    errorMessage,
    errorCode: "AGENT_CANCELLED",
    finishedAt: new Date()
  }).where(and(
    eq(aiAgentRuns.id, runId),
    inArray(aiAgentRuns.status, ["RUNNING", "WAITING_USER_INPUT"])
  ));
}

export async function cancelRunningAgentRuns(
  app: FastifyInstance,
  conversationId: string,
  errorMessage = "被新的生成请求中止"
) {
  await app.db.update(aiAgentRuns).set({
    status: "CANCELLED",
    errorMessage,
    errorCode: "AGENT_CANCELLED",
    finishedAt: new Date()
  }).where(and(
    eq(aiAgentRuns.conversationId, conversationId),
    eq(aiAgentRuns.status, "RUNNING")
  ));
}

export async function cancelAgentRunsForAssistantMessage(
  app: FastifyInstance,
  assistantMessageId: string,
  errorMessage = "用户取消"
) {
  await app.db.update(aiAgentRuns).set({
    status: "CANCELLED",
    errorMessage,
    errorCode: "AGENT_CANCELLED",
    finishedAt: new Date()
  }).where(and(
    eq(aiAgentRuns.assistantMessageId, assistantMessageId),
    inArray(aiAgentRuns.status, ["RUNNING", "WAITING_USER_INPUT"])
  ));
}

export async function failAgentRun(app: FastifyInstance, runId: string, error: unknown) {
  const aiError = error instanceof AiError ? error : toAiError(error);
  await app.db.update(aiAgentRuns).set({
    status: "FAILED",
    errorCode: aiError.code,
    errorMessage: aiError.message,
    finishedAt: new Date()
  }).where(and(
    eq(aiAgentRuns.id, runId),
    eq(aiAgentRuns.status, "RUNNING")
  ));
}

function abortRequestedError() {
  const error = new Error("AI 回答已请求停止");
  error.name = "AbortError";
  return error;
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(abortRequestedError());
      return;
    }
    signal.addEventListener("abort", () => reject(abortRequestedError()), { once: true });
  });
}

function waitForTimeout(ms: number): { promise: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiError("AI_MODEL_TIMEOUT")), ms);
  });
  return {
    promise,
    cancel: () => {
      if (timer) clearTimeout(timer);
    }
  };
}

export function detectDuplicateLoop(hashes: string[], nextHash: string, limit: number): boolean {
  if (hashes.length === 0) return false;
  let streak = 0;
  for (let i = hashes.length - 1; i >= 0; i -= 1) {
    if (hashes[i] === nextHash) streak += 1;
    else break;
  }
  return streak + 1 >= limit;
}

export async function runAgentLoop(options: {
  app: FastifyInstance;
  request: FastifyRequest;
  reply: FastifyReply;
  user: AuthUser;
  conversation: ConversationRow;
  runtime: SceneRuntime;
  agentModel: ResolvedModelConfig;
  allowedTools: AgentToolName[];
  assistantMessageId: string;
  agentRunId: string;
  abortSignal: AbortSignal;
  initialState: AgentRunState;
  taskState?: ConversationTaskState | null;
  answerContract?: string | null;
  /** 本轮用户原始提问：透传给工具做确定性兜底（如 K 查询语义推断） */
  userMessage?: string | null;
}): Promise<{
  text: string;
  usage?: LanguageModelUsage;
  finish: "COMPLETED" | "WAITING_USER_INPUT" | "CANCELLED" | "FAILED";
  sources: unknown[];
  referencePages?: unknown[];
  error?: AiError;
}> {
  const { app, request, reply, user, conversation, runtime, agentModel, assistantMessageId, agentRunId, abortSignal } = options;
  const allowedTools = normalizeAllowedToolNames(options.allowedTools);
  const initialState = parseAgentRunState(options.initialState);
  const baseMessages = [...initialState.messages];
  const state: AgentRunState = {
    ...initialState,
    messages: [...baseMessages],
    recentToolHashes: [...(initialState.recentToolHashes ?? [])],
    sources: [...(initialState.sources ?? [])],
    waiting: undefined,
    selectedChoice: initialState.selectedChoice,
    selectedComparison: initialState.selectedComparison,
    generateReportNow: initialState.generateReportNow
  };
  let userVisibleText = "";
  let internalStepText = initialState.internalStepText ?? "";
  let usage: LanguageModelUsage | undefined;
  let sources: unknown[] = state.sources;
  let referencePages: unknown[] = [];
  const waitingRef: { current: AgentWaitState | null } = { current: null };
  let step = 0;
  const toolCallCount = { value: 0 };
  const startedAt = Date.now();
  let stepBuffer = createAgentStepBuffer();

  const appendInternal = (text: string) => {
    const value = text.trim();
    if (!value) return;
    internalStepText = internalStepText ? `${internalStepText}\n\n${value}` : value;
  };

  const flushVisible = async (text: string, interrupted = false) => {
    let checkedText = text;
    const ownsThermalFacts = ctx.answerContract === "REFERENCE_LOOKUP" || ctx.answerContract === "THERMAL" || ctx.thermalCanonicalAnswers !== undefined;
    if (ownsThermalFacts) {
      if (interrupted || abortSignal.aborted) return;
      const canonical = ctx.thermalCanonicalAnswers ?? ["当前尚未形成可核验的正式热工结果，请确认查询条件后继续。"];
      const checked = await validateOrRepairThermalAnswer(text, canonical, async (canonicalAnswer) => {
        const remaining = env.AI_AGENT_OVERALL_TIMEOUT_MS - (Date.now() - startedAt);
        if (remaining <= 0) throw new AiError("AI_MODEL_TIMEOUT");
        const retry = await generateText({
          model: agentModel.languageModel, system: REFERENCE_LOOKUP_ANSWER_SYSTEM_PROMPT,
          messages: [{ role: "user", content: ctx.thermalAllowedFacts
            ? `${renderAllowedFactsForModel(ctx.thermalAllowedFacts)}\n\n请只用上面的事实，自然地回答用户：${ctx.userMessage ?? ""}`
            : canonicalAnswer }],
          ...languageModelCallOptions("PROJECT_AGENT"), timeout: Math.min(20_000, remaining),
          abortSignal, providerOptions: runtime.providerOptions
        });
        return retry.text;
      }, ctx.thermalAllowedFacts);
      if (abortSignal.aborted) return;
      checkedText = checked.text;
      ctx.thermalFactValidation = { repaired: checked.repaired, fallback: checked.fallback };
      if (checked.repaired) request.log.warn({ agentRunId, fallback: checked.fallback }, "热工回答未满足原子事实契约，已在发送前修复");
    }
    const formatted = formatUserVisibleAnswer(checkedText);
    if (!formatted) return;
    userVisibleText = userVisibleText ? `${userVisibleText}\n\n${formatted}` : formatted;
    for (const chunk of splitVisibleAnswerChunks(formatted)) {
      writeSse(reply, "delta", { text: chunk });
    }
  };

  const settleStepBuffer = async (buffer: AgentStepBuffer, interrupted = false) => {
    const kind = interrupted
      ? classifyInterruptedStep(buffer)
      : (buffer.text.trim() ? classifyFinishedStep(buffer) : null);
    if (!kind) return;
    if (kind === "internal") appendInternal(buffer.text);
    else await flushVisible(buffer.text, interrupted);
  };

  const ctx: ToolRuntimeContext = {
    app,
    request,
    user,
    conversation,
    assistantMessageId,
    agentRunId,
    abortSignal,
    recentToolHashes: [...(state.recentToolHashes ?? [])],
    toolCallCount,
    maxToolCalls: env.AI_AGENT_MAX_TOOL_CALLS,
    duplicateLimit: env.AI_AGENT_DUPLICATE_TOOL_LIMIT,
    selectedChoice: initialState.selectedChoice ?? null,
    selectedComparison: initialState.selectedComparison ?? null,
    selectedUserSelection: initialState.selectedUserSelection ?? null,
    taskState: options.taskState ?? null,
    answerContract: options.answerContract ?? null,
    userMessage: options.userMessage ?? null,
    onWait: (signal) => {
      const type = signal.type === "APPROVAL"
        ? "APPROVAL"
        : signal.type === "USER_SELECTION"
          ? "USER_SELECTION"
          : signal.type === "COMPARISON_SELECTION"
            ? "COMPARISON_SELECTION"
            : "CHOICE";
      const waiting: AgentWaitState = {
        type,
        selectionKind: signal.selectionKind
          ?? (type === "COMPARISON_SELECTION" ? "PRODUCT" : signal.request?.selectionKind),
        title: signal.title ?? signal.request?.title ?? (type === "APPROVAL"
          ? "请确认是否继续"
          : type === "COMPARISON_SELECTION"
            ? "请选择需要纳入报告的产品/方案"
            : "请选择"),
        prompt: signal.prompt ?? signal.request?.description ?? "",
        options: Array.isArray(signal.options) ? signal.options as AgentWaitState["options"] : [],
        multiple: signal.multiple ?? signal.request?.multiple ?? type === "COMPARISON_SELECTION",
        minSelections: signal.minSelections ?? signal.request?.minSelections ?? (type === "COMPARISON_SELECTION" ? 1 : undefined),
        maxSelections: signal.maxSelections ?? signal.request?.maxSelections,
        autoSelectWhenSingle: signal.autoSelectWhenSingle ?? signal.request?.autoSelectWhenSingle ?? true,
        confirmAction: signal.confirmAction ?? signal.request?.confirmAction ?? (type === "COMPARISON_SELECTION"
          ? { type: "GENERATE_REPORT", label: "确认并生成报告" }
          : undefined),
        request: signal.request,
        comparisonResult: signal.comparisonResult && typeof signal.comparisonResult === "object"
          ? signal.comparisonResult as AgentWaitState["comparisonResult"]
          : undefined,
        sourceToolCallId: signal.sourceToolCallId,
        reason: type === "APPROVAL"
          ? "USER_APPROVAL"
          : type === "COMPARISON_SELECTION"
            ? "COMPARISON_SELECTION"
            : type === "USER_SELECTION" ? "USER_SELECTION" : "USER_CHOICE"
      };
      waitingRef.current = type === "APPROVAL" ? waiting : attachUserSelectionRequest(waiting);
    },
    onEvent: (event, data) => {
      writeSse(reply, event, data);
      if (event === "sources" && data && typeof data === "object" && "sources" in (data as Record<string, unknown>)) {
        sources = (data as { sources: unknown[] }).sources;
      }
      if (event === "reference_pages" && data && typeof data === "object" && "stored" in (data as Record<string, unknown>)) {
        referencePages = (data as { stored: unknown[] }).stored;
      }
    }
  };

  const tools = createAgentTools(ctx, allowedTools);

  const snapshotAnswerState = () => ({
    fullText: userVisibleText,
    userVisibleText,
    internalStepText,
    sources,
    recentToolHashes: ctx.recentToolHashes,
    thermalFactValidation: ctx.thermalFactValidation
  });

  const persistProgress = async () => {
    await app.db.update(aiAgentRuns).set({
      currentStep: step,
      toolCallCount: toolCallCount.value,
      tokenUsageJson: {
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens
      },
      stateJson: {
        ...state,
        ...snapshotAnswerState()
      }
    }).where(eq(aiAgentRuns.id, agentRunId));
  };

  try {
    const result = streamText({
      model: agentModel.languageModel,
      system: `${state.system}\n\n${AGENT_LOOP_REMINDER}`,
      messages: baseMessages,
      tools,
      stopWhen: [
        stepCountIs(getAiTaskRuntimePolicy("PROJECT_AGENT").maxSteps),
        () => waitingRef.current !== null || abortSignal.aborted
      ],
      prepareStep: async () => {
        // 参考查询与正式热工由后端持有权威数据、硬条件与来源页：首步必须真实调用工具。
        // 否则模型会凭对话上下文直接作答，导致会话权威条件不更新、来源无法核验。
        const ownsReferenceData = ctx.answerContract === "REFERENCE_LOOKUP" || ctx.answerContract === "THERMAL";
        const compareSelected = ctx.taskState?.lastReferenceLookup && normalizeConversationLookupQuery({}, ctx.userMessage ?? "", ctx.taskState.lastReferenceLookup).lifecycle === "COMPARE_SELECTED";
        const hasActiveCandidates = ctx.answerContract === "REFERENCE_LOOKUP" || (ctx.taskState?.lastReferenceLookup?.candidates?.length ?? 0) > 0;
        // 已存在候选集的追问（原页/参数/局部改条件）必须回到 thermal 重查并重新给出原页，
        // 不能让模型改用其他工具或凭上下文复述；全新查询只要求至少真实调用一次工具。
        const toolChoice = compareSelected && allowedTools.includes("compare_solutions")
          ? { type: "tool", toolName: "compare_solutions" } as const
          : !ownsReferenceData || allowedTools.length === 0
          ? undefined
          : hasActiveCandidates && allowedTools.includes("thermal")
            ? { type: "tool", toolName: "thermal" } as const
            : "required" as const;
        return {
          activeTools: allowedTools,
          ...(step === 0 && toolChoice ? { toolChoice } : {})
        };
      },
      ...languageModelCallOptions("PROJECT_AGENT"),
      timeout: Math.min(getAiTaskRuntimePolicy("PROJECT_AGENT").timeoutMs, env.AI_AGENT_OVERALL_TIMEOUT_MS),
      abortSignal,
      providerOptions: runtime.providerOptions,
      onStepFinish: async (stepResult) => {
        step += 1;
        usage = stepResult.usage;
        const stepMessages = stepResult.response?.messages ?? [];
        if (stepMessages.length > 0) {
          state.messages = applyResponseMessages(state.messages, stepMessages);
        }
        await persistProgress();
      }
    });

    const abortWait = waitForAbort(abortSignal);
    void abortWait.catch(() => undefined);
    const timeoutWait = waitForTimeout(env.AI_AGENT_OVERALL_TIMEOUT_MS);
    try {
      await Promise.race([
        (async () => {
          for await (const part of result.fullStream) {
            if (abortSignal.aborted) break;
            if (part.type === "start-step" && stepBuffer.text) {
              await settleStepBuffer(stepBuffer);
            }
            stepBuffer = applyAgentStreamPart(stepBuffer, part);
            if (part.type === "finish-step") {
              await settleStepBuffer(stepBuffer);
              stepBuffer = createAgentStepBuffer();
            }
            if (Date.now() - startedAt > env.AI_AGENT_OVERALL_TIMEOUT_MS) {
              throw new AiError("AI_MODEL_TIMEOUT");
            }
          }
        })(),
        abortWait,
        timeoutWait.promise
      ]);
    } finally {
      timeoutWait.cancel();
    }
    if (stepBuffer.text) {
      await settleStepBuffer(stepBuffer, abortSignal.aborted);
      stepBuffer = createAgentStepBuffer();
    }
    if (!abortSignal.aborted) {
      usage = await Promise.resolve(result.usage);
      const responseMessages = await result.responseMessages;
      state.messages = applyResponseMessages(baseMessages, responseMessages);
    }

    if (abortSignal.aborted) {
      await cancelAgentRun(app, agentRunId, "用户取消");
      return { text: userVisibleText, usage, finish: "CANCELLED", sources, referencePages };
    }

    if (waitingRef.current) {
      state.waiting = waitingRef.current;
      await app.db.update(aiAgentRuns).set({
        status: "WAITING_USER_INPUT",
        currentStep: step,
        toolCallCount: toolCallCount.value,
        stateJson: {
          ...state,
          ...snapshotAnswerState(),
          waiting: waitingRef.current
        }
      }).where(and(eq(aiAgentRuns.id, agentRunId), eq(aiAgentRuns.status, "RUNNING")));
      const waitingPayload = toWaitingSsePayload(agentRunId, waitingRef.current);
      writeSse(reply, "need_user_input", waitingPayload);
      writeSse(reply, "waiting_user_input", waitingPayload);
      writeSse(reply, "agent_status", { message: "需要你确认后继续" });
      return { text: userVisibleText, usage, finish: "WAITING_USER_INPUT", sources, referencePages };
    }

    await app.db.update(aiAgentRuns).set({
      status: "COMPLETED",
      currentStep: step,
      toolCallCount: toolCallCount.value,
      tokenUsageJson: {
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens
      },
      stateJson: { ...state, ...snapshotAnswerState() },
      finishedAt: new Date()
    }).where(and(eq(aiAgentRuns.id, agentRunId), eq(aiAgentRuns.status, "RUNNING")));
    return { text: userVisibleText, usage, finish: "COMPLETED", sources, referencePages };
  } catch (error) {
    if (stepBuffer.text) await settleStepBuffer(stepBuffer, true);
    if (isAbortError(error) || abortSignal.aborted) {
      await cancelAgentRun(app, agentRunId, "用户取消");
      return { text: userVisibleText, usage, finish: "CANCELLED", sources, referencePages };
    }
    const aiError = error instanceof AiError ? error : toAiError(error);
    await app.db.update(aiAgentRuns).set({
      status: "FAILED",
      errorCode: aiError.code,
      errorMessage: aiError.message,
      currentStep: step,
      toolCallCount: toolCallCount.value,
      stateJson: { ...state, ...snapshotAnswerState() },
      finishedAt: new Date()
    }).where(and(eq(aiAgentRuns.id, agentRunId), eq(aiAgentRuns.status, "RUNNING")));
    if (error instanceof AiError && error.code === "AGENT_LOOP_LIMIT") {
      return { text: userVisibleText, usage, finish: "FAILED", sources, referencePages, error };
    }
    throw error;
  } finally {
    const [current] = await app.db.select({ status: aiAgentRuns.status })
      .from(aiAgentRuns)
      .where(eq(aiAgentRuns.id, agentRunId))
      .limit(1);
    if (current?.status === "RUNNING") {
      await failAgentRun(app, agentRunId, new AiError("AI_STREAM_INTERRUPTED"));
    }
  }
}

export async function assertAgentRunAccess(
  app: FastifyInstance,
  user: AuthUser,
  run: AgentRunRow
) {
  const [conversation] = await app.db.select().from(aiConversations)
    .where(eq(aiConversations.id, run.conversationId)).limit(1);
  if (!conversation) throw new AiError("AGENT_RUN_NOT_FOUND");
  if (user.role !== "SUPER_ADMIN" && conversation.userId !== user.id) {
    throw new AiError("AI_CONVERSATION_FORBIDDEN");
  }
  if (conversation.projectId) {
    const [project] = await app.db.select().from(projects)
      .where(eq(projects.id, conversation.projectId)).limit(1);
    if (project && !canViewProject(user, project)) throw new NotFoundError("关联项目不存在或无权查看");
  }
  return conversation;
}

export async function prepareResumeState(
  run: AgentRunRow,
  userInput: string,
  optionId?: string | null,
  extra?: {
    optionIds?: string[] | null;
    selectedIds?: string[] | null;
    selectionKind?: string | null;
    confirmAction?: "CONTINUE" | "GENERATE_REPORT" | null;
  }
): Promise<AgentRunState> {
  if (run.status !== "WAITING_USER_INPUT") {
    throw new AiError("AGENT_RUN_NOT_WAITING");
  }
  const state = parseAgentRunState(run.stateJson);
  if (!state.waiting) {
    throw new AiError("AGENT_RUN_NOT_WAITING");
  }
  const selectedUserSelection = (() => {
    try {
      return resolveUserSelectionFromInput(state.waiting, {
        runId: run.id,
        selectionKind: extra?.selectionKind as UserSelectionResult["selectionKind"] | undefined,
        selectedIds: extra?.selectedIds,
        optionId,
        optionIds: extra?.optionIds,
        content: userInput,
        confirmAction: extra?.confirmAction === "GENERATE_REPORT" || extra?.confirmAction === "CONTINUE"
          ? extra.confirmAction
          : undefined
      });
    } catch (error) {
      if (error instanceof UserSelectionError) {
        throw new AiError("AGENT_SELECTION_INVALID", error.message);
      }
      throw error;
    }
  })();
  const selectedComparison = isComparisonSelectionWait(state.waiting)
    ? resolveComparisonSelectionFromInput(state.waiting, {
      content: userInput,
      optionId,
      optionIds: extra?.optionIds ?? extra?.selectedIds,
      selectedIds: extra?.selectedIds,
      confirmAction: extra?.confirmAction === "GENERATE_REPORT" ? "GENERATE_REPORT" : undefined
    })
    : selectedUserSelection && selectedUserSelection.selectionKind === "PRODUCT"
      ? {
        optionIds: selectedUserSelection.selectedIds,
        options: selectedUserSelection.options.map((item) => ({
          id: item.id,
          label: item.title,
          summary: item.description ?? "",
          data: item.meta
        })),
        confirmAction: selectedUserSelection.confirmAction === "GENERATE_REPORT" ? "GENERATE_REPORT" as const : undefined
      }
      : undefined;
  const resolved = selectedComparison?.options[0]
    ? { optionId: selectedComparison.options[0].id, option: selectedComparison.options[0] }
    : resolveChoiceFromInput(state.waiting, { content: userInput, optionId: optionId ?? extra?.selectedIds?.[0] });
  const selectedChoice: SelectedChoice | undefined = resolved
    ? {
      ...resolved,
      comparisonResult: state.waiting?.comparisonResult,
      sourceToolCallId: state.waiting?.sourceToolCallId
    }
    : state.selectedChoice;
  const comparison: SelectedComparison | undefined = selectedComparison
    ? {
      ...selectedComparison,
      comparisonResult: state.waiting?.comparisonResult,
      sourceToolCallId: state.waiting?.sourceToolCallId,
      confirmAction: extra?.confirmAction === "GENERATE_REPORT" || selectedComparison.confirmAction === "GENERATE_REPORT"
        ? "GENERATE_REPORT"
        : selectedComparison.confirmAction
    }
    : state.selectedComparison;
  const generateReportNow = comparison?.confirmAction === "GENERATE_REPORT"
    || selectedUserSelection?.confirmAction === "GENERATE_REPORT"
    || extra?.confirmAction === "GENERATE_REPORT";
  const resumeContent = selectedUserSelection
    ? formatUserSelectionResumeMessage(selectedUserSelection, userInput)
    : comparison
      ? formatComparisonSelectionResumeMessage(comparison, userInput)
      : resolved
        ? formatChoiceResumeMessage(selectedChoice!, userInput)
        : userInput;
  return {
    system: state.system,
    messages: [...state.messages, { role: "user", content: resumeContent }],
    selectedChoice,
    selectedComparison: comparison,
    selectedUserSelection: selectedUserSelection ?? state.selectedUserSelection,
    generateReportNow,
    sources: state.sources,
    recentToolHashes: [],
    fullText: "",
    userVisibleText: "",
    internalStepText: state.internalStepText
  };
}

/** 用户提交选择后恢复原 Run，不得新建无关任务。 */
export async function submitChoice(
  run: AgentRunRow,
  input: {
    content?: string;
    optionId?: string;
    optionIds?: string[];
    selectedIds?: string[];
    selectionKind?: string;
    confirmAction?: "CONTINUE" | "GENERATE_REPORT";
  }
): Promise<AgentRunState> {
  return prepareResumeState(run, input.content ?? "", input.optionId, {
    optionIds: input.optionIds,
    selectedIds: input.selectedIds,
    selectionKind: input.selectionKind,
    confirmAction: input.confirmAction
  });
}

export async function loadLatestSelectedChoice(
  app: FastifyInstance,
  conversationId: string
): Promise<SelectedChoice | null> {
  const rows = await app.db.select().from(aiAgentRuns)
    .where(eq(aiAgentRuns.conversationId, conversationId))
    .orderBy(desc(aiAgentRuns.startedAt))
    .limit(8);
  for (const row of rows) {
    const selected = parseAgentRunState(row.stateJson).selectedChoice;
    if (selected?.optionId) return selected;
  }
  return null;
}

/**
 * Agent Run：原生 Tool Calling 循环、Resume、Cancel、循环防护。
 * resolveAiCapabilities 只负责预路由允许的 Tool Set，不再代替 Agent。
 */
import { streamText, stepCountIs, type LanguageModelUsage, type ModelMessage } from "ai";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../../config/env.js";
import { aiAgentRuns, aiConversations, projects } from "../../db/schema.js";
import { AiError } from "../../shared/ai-errors.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { NotFoundError } from "../../shared/errors.js";
import { canViewProject } from "../../shared/permissions.js";
import type { ResolvedModelConfig } from "../ai-config/ai-config.service.js";
import { resolveAgentModelOrNull } from "../ai-config/ai-config.service.js";
import type { AgentToolName } from "./ai-capability-router.js";
import type { ConversationRow } from "./ai-context-builder.js";
import { createAgentTools, type ToolRuntimeContext } from "./ai-tools.js";
import { writeSse } from "./ai-sse.js";
import type { SceneRuntime } from "./ai-runtime.service.js";

export const AGENT_SYSTEM_EXTRA = [
  "【Agent 工具使用规则】",
  "涉及图集/标准/构造时调用 search_knowledge，不得编造来源。",
  "涉及传热系数、热阻、保温厚度时必须调用 thermal_calculate，不得自行估算。",
  "存在多个候选方案时调用 compare_solutions，列出差异并请用户选择，不得替用户做唯一最终选择。",
  "仅当用户明确要求生成报告时才调用 generate_report_draft。",
  "缺少关键项目条件、记忆冲突或需要覆盖已确认方案时，停止并询问用户。"
].join("\n");

export type AgentRunRow = typeof aiAgentRuns.$inferSelect;

export type AgentRunState = {
  system: string;
  messages: ModelMessage[];
  waitingPrompt?: string;
  waitingOptions?: unknown[];
  sources?: unknown[];
  recentToolHashes: string[];
  fullText: string;
};

export async function resolveAgentModel(
  runtime: SceneRuntime,
  db: Parameters<typeof resolveAgentModelOrNull>[0]
): Promise<ResolvedModelConfig | null> {
  if (runtime.allowTools && runtime.primary.capabilities?.tools === true) {
    return runtime.primary;
  }
  if (!runtime.allowTools) return null;
  return resolveAgentModelOrNull(db);
}

export async function getActiveAgentRun(app: FastifyInstance, conversationId: string) {
  const [row] = await app.db.select().from(aiAgentRuns).where(and(
    eq(aiAgentRuns.conversationId, conversationId),
    inArray(aiAgentRuns.status, ["RUNNING", "WAITING_USER_INPUT"])
  )).orderBy(desc(aiAgentRuns.startedAt)).limit(1);
  return row ?? null;
}

export async function getAgentRunById(app: FastifyInstance, runId: string) {
  const [row] = await app.db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, runId)).limit(1);
  return row ?? null;
}

export function toAgentRunDto(row: AgentRunRow) {
  const state = (row.stateJson ?? {}) as AgentRunState;
  return {
    id: row.id,
    conversationId: row.conversationId,
    status: row.status,
    currentStep: row.currentStep,
    allowedTools: row.allowedToolsJson,
    waitingPrompt: state.waitingPrompt ?? null,
    waitingOptions: state.waitingOptions ?? null,
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
}): Promise<{
  text: string;
  usage?: LanguageModelUsage;
  finish: "COMPLETED" | "WAITING_USER_INPUT" | "CANCELLED" | "FAILED";
  sources: unknown[];
  error?: AiError;
}> {
  const { app, request, reply, user, conversation, runtime, agentModel, allowedTools, assistantMessageId, agentRunId, abortSignal } = options;
  const state: AgentRunState = {
    ...options.initialState,
    recentToolHashes: [...(options.initialState.recentToolHashes ?? [])]
  };
  let fullText = state.fullText ?? "";
  let usage: LanguageModelUsage | undefined;
  let sources: unknown[] = state.sources ?? [];
  const waitingRef: { current: { prompt: string; options?: unknown[] } | null } = { current: null };
  let step = 0;
  const toolCallCount = { value: 0 };
  const startedAt = Date.now();

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
    onWait: (signal) => {
      waitingRef.current = { prompt: signal.prompt, options: signal.options };
    },
    onEvent: (event, data) => {
      writeSse(reply, event, data);
      if (event === "sources" && data && typeof data === "object" && "sources" in (data as Record<string, unknown>)) {
        sources = (data as { sources: unknown[] }).sources;
      }
    }
  };

  const tools = createAgentTools(ctx, allowedTools);

  try {
    const result = streamText({
      model: agentModel.languageModel,
      system: `${state.system}\n\n${AGENT_SYSTEM_EXTRA}`,
      messages: state.messages,
      tools,
      stopWhen: [
        stepCountIs(env.AI_AGENT_MAX_STEPS),
        () => waitingRef.current !== null || abortSignal.aborted
      ],
      maxOutputTokens: runtime.sceneMaxOutputTokens ?? agentModel.maxOutputTokens ?? undefined,
      temperature: runtime.sceneTemperature ?? agentModel.defaultTemperature ?? undefined,
      timeout: Math.min(agentModel.timeoutMs, env.AI_AGENT_OVERALL_TIMEOUT_MS),
      abortSignal,
      providerOptions: runtime.providerOptions,
      onStepFinish: async ({ usage: stepUsage }) => {
        step += 1;
        usage = stepUsage;
        await app.db.update(aiAgentRuns).set({
          currentStep: step,
          toolCallCount: toolCallCount.value,
          tokenUsageJson: {
            inputTokens: stepUsage?.inputTokens,
            outputTokens: stepUsage?.outputTokens
          },
          stateJson: { ...state, fullText, sources }
        }).where(eq(aiAgentRuns.id, agentRunId));
      }
    });

    for await (const part of result.fullStream) {
      if (abortSignal.aborted) break;
      if (part.type === "text-delta") {
        const delta = "text" in part ? String(part.text) : "";
        if (!delta) continue;
        fullText += delta;
        writeSse(reply, "delta", { text: delta });
        writeSse(reply, "text_delta", { text: delta });
      }
      if (Date.now() - startedAt > env.AI_AGENT_OVERALL_TIMEOUT_MS) {
        throw new AiError("AI_MODEL_TIMEOUT");
      }
    }
    usage = await Promise.resolve(result.usage);

    if (abortSignal.aborted) {
      await app.db.update(aiAgentRuns).set({
        status: "CANCELLED",
        errorCode: "AGENT_CANCELLED",
        errorMessage: "用户取消",
        currentStep: step,
        toolCallCount: toolCallCount.value,
        stateJson: { ...state, fullText, sources },
        finishedAt: new Date()
      }).where(eq(aiAgentRuns.id, agentRunId));
      return { text: fullText, usage, finish: "CANCELLED", sources };
    }

    if (waitingRef.current) {
      await app.db.update(aiAgentRuns).set({
        status: "WAITING_USER_INPUT",
        currentStep: step,
        toolCallCount: toolCallCount.value,
        stateJson: {
          ...state,
          messages: [...state.messages, { role: "assistant", content: fullText }],
          fullText,
          sources,
          waitingPrompt: waitingRef.current.prompt,
          waitingOptions: waitingRef.current.options,
          recentToolHashes: ctx.recentToolHashes
        }
      }).where(eq(aiAgentRuns.id, agentRunId));
      writeSse(reply, "need_user_input", {
        runId: agentRunId,
        prompt: waitingRef.current.prompt,
        options: waitingRef.current.options ?? []
      });
      writeSse(reply, "agent_status", { message: "需要你确认后继续" });
      return { text: fullText, usage, finish: "WAITING_USER_INPUT", sources };
    }

    await app.db.update(aiAgentRuns).set({
      status: "COMPLETED",
      currentStep: step,
      toolCallCount: toolCallCount.value,
      tokenUsageJson: {
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens
      },
      stateJson: { ...state, fullText, sources, messages: state.messages },
      finishedAt: new Date()
    }).where(eq(aiAgentRuns.id, agentRunId));
    return { text: fullText, usage, finish: "COMPLETED", sources };
  } catch (error) {
    if (error instanceof AiError && error.code === "AGENT_LOOP_LIMIT") {
      await app.db.update(aiAgentRuns).set({
        status: "FAILED",
        errorCode: "AGENT_LOOP_LIMIT",
        errorMessage: error.message,
        currentStep: step,
        toolCallCount: toolCallCount.value,
        stateJson: { ...state, fullText, sources },
        finishedAt: new Date()
      }).where(eq(aiAgentRuns.id, agentRunId));
      return { text: fullText, usage, finish: "FAILED", sources, error };
    }
    throw error;
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

export async function prepareResumeState(run: AgentRunRow, userInput: string): Promise<AgentRunState> {
  if (run.status !== "WAITING_USER_INPUT") {
    throw new AiError("AGENT_RUN_NOT_WAITING");
  }
  const state = (run.stateJson ?? {}) as AgentRunState;
  return {
    system: state.system,
    messages: [...(state.messages ?? []), { role: "user", content: userInput }],
    sources: state.sources ?? [],
    recentToolHashes: [],
    fullText: ""
  };
}

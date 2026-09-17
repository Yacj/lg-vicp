/**
 * AI 对话生成共享服务：敏感词围栏 → 限流/配额 → 生成锁 → 场景运行时解析 →
 * 消息落库 → 知识检索注入 → 提示词组装 → SSE 流式生成（主/备用模型降级）→ 审计与引用出参。
 * 发送消息（/conversations/:id/messages）与知识问答（/knowledge-qa）共用。
 * 未传入 knowledgeChunks 时由能力路由决定是否检索已发布知识库，不再依赖用户选择 scene。
 */
import { randomUUID } from "node:crypto";
import { streamText, type LanguageModelUsage, type ModelMessage } from "ai";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { env } from "../../config/env.js";
import { aiAgentRuns, aiConversations, aiMessageAttachments, aiMessages, projects } from "../../db/schema.js";
import { AI_SCENES, AUDIT_ACTIONS } from "../../shared/constants.js";
import { AiError, toAiError } from "../../shared/ai-errors.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { ConflictError, NotFoundError, TooManyRequestsError } from "../../shared/errors.js";
import { canViewProject } from "../../shared/permissions.js";
import { formatInsulationSystemContext, formatThermalCapabilityContext } from "../../shared/prompt-assembly.js";
import { isAbortError, startSseStream, writeProgress, writeSse } from "./ai-sse.js";
import { checkContentFiltered } from "./ai-content-filter.service.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { formatKnowledgeContext, type WikiHit } from "../knowledge/knowledge.service.js";
import { getPublishedInsulationSystem } from "../construction/construction-read.service.js";
import { toAiSources } from "./ai-source.mapper.js";
import { formatComparisonRuleContext, loadApprovedComparisonRules, logComparisonRuleUsage } from "../comparison/material-compare.service.js";
import { createConcurrencyRelease, enforceAiQuota, resolveSceneRuntime, type SceneRuntime } from "./ai-runtime.service.js";
import { loadKnowledgeForGeneration } from "./ai-knowledge-load.js";
import { resolveAiCapabilities, selectAllowedToolNames } from "./ai-capability-router.js";
import { resolveProjectContext } from "./ai-project-profile.js";
import { buildAiContext } from "./ai-context-builder.js";
import {
  cancelAgentRun,
  createAgentRun,
  getActiveAgentRun,
  prepareResumeState,
  resolveAgentModel,
  runAgentLoop
} from "./ai-agent.service.js";
import { scheduleConversationMaintenance, updateConversationSummary } from "./ai-conversation-state.service.js";
import { refreshProjectMemoryFromConversation } from "./ai-project-memory.service.js";
import {
  describeChatImages,
  formatVisionContext,
  validateChatImageAttachments,
  visionResultPayload,
  type VisionContext
} from "./ai-vision.service.js";

export type ActiveGeneration = {
  controller: AbortController;
  conversationId: string;
  userId: string;
  stopRequested: boolean;
  stopReason?: "USER" | "CLIENT_DISCONNECTED";
};

/** 进行中的生成任务（按 assistant 消息 ID），供停止端点定位并中止 */
export const activeGenerations = new Map<string, ActiveGeneration & { lockKey: string; lockToken: string; stopKey: string }>();

/** 会话级生成锁释放（校验 token，避免误删他人锁） */
export async function releaseGenerationLock(app: FastifyInstance, lockKey: string, lockToken: string) {
  if (await app.redis.get(lockKey) === lockToken) await app.redis.del(lockKey);
}

/** 生成准备失败时把仍停留在 PENDING/STREAMING 的助手消息标失败，避免会话永久占坑。 */
export async function failPendingGenerationMessage(app: FastifyInstance, messageId: string, error: unknown) {
  if (!messageId) return;
  const aiError = error instanceof AiError ? error : toAiError(error);
  await app.db.update(aiMessages).set({
    status: "FAILED",
    errorMessage: aiError.message,
    errorCode: aiError.code,
    finishedAt: new Date()
  }).where(and(
    eq(aiMessages.id, messageId),
    inArray(aiMessages.status, ["PENDING", "STREAMING"])
  ));
}

/** 单用户每分钟生成请求限流 */
export async function enforceAiRateLimit(app: FastifyInstance, userId: string) {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `ai:rate:${userId}:${minute}`;
  const count = await app.redis.incr(key);
  if (count === 1) await app.redis.expire(key, 70);
  if (count > env.AI_RATE_LIMIT_PER_MINUTE) {
    throw new TooManyRequestsError("AI 请求过于频繁，请稍后再试");
  }
}

export async function streamConversationReply(options: {
  app: FastifyInstance;
  request: FastifyRequest;
  reply: FastifyReply;
  user: AuthUser;
  conversation: typeof aiConversations.$inferSelect;
  content: string;
  /** 聊天图片 fileId，不属于项目文件；0 张走原文字流程 */
  attachmentFileIds?: string[];
  /** 传入时跳过场景内自动检索，直接使用该检索结果（知识问答场景；空数组表示无检索结果） */
  knowledgeChunks?: WikiHit[];
  /** 覆盖 done.sources 映射（B 端版本测试可裁剪调试字段） */
  mapSources?: (hits: readonly WikiHit[]) => unknown;
}): Promise<void> {
  const { app, request, reply, user, conversation, content, attachmentFileIds, knowledgeChunks: providedChunks, mapSources } = options;
  const startedAt = Date.now();
  const requestId = request.id;

  // 敏感词围栏：命中即拦截（不发模型请求），用户消息落库 BLOCKED 并审计
  const blocked = await checkContentFiltered(app.db, conversation.scene, content);
  if (blocked) {
    await app.db.transaction(async (tx) => {
      const [blockedRow] = await tx.insert(aiMessages).values({
        conversationId: conversation.id,
        userId: user.id,
        role: "USER",
        content,
        status: "BLOCKED",
        reasoningMode: conversation.reasoningMode,
        requestId,
        metadata: {
          blockedFilterId: blocked.filterId,
          blockedKeyword: blocked.keyword,
          blockedMatchType: blocked.matchType,
          blockedMatchedText: blocked.matchedText
        }
      }).returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: conversation.projectId ?? undefined,
        action: AUDIT_ACTIONS.AI_MESSAGE_BLOCKED, targetType: "ai_message", targetId: blockedRow!.id,
        afterJson: {
          filterId: blocked.filterId,
          keyword: blocked.keyword,
          matchType: blocked.matchType,
          matchedText: blocked.matchedText
        }
      });
    });
    throw new AiError("AI_CONTENT_BLOCKED", blocked.hitMessage?.trim() || undefined);
  }

  const chatImages = await validateChatImageAttachments(app, user, attachmentFileIds);

  // 生成请求限流与配额（与历史发送消息端点行为一致）
  await enforceAiRateLimit(app, user.id);
  await enforceAiQuota(app, user);
  const releaseQuota = createConcurrencyRelease(app, user.id);
  let lockKey = "";
  let lockToken = "";
  let createdAssistantMessageId = "";
  try {

  if (conversation.projectId) {
    const [project] = await app.db.select().from(projects).where(and(
      eq(projects.id, conversation.projectId), isNull(projects.deletedAt)
    )).limit(1);
    if (!project || !canViewProject(user, project)) throw new NotFoundError("关联项目不存在或无权查看");
  }

  const [activeMessage] = await app.db.select({ id: aiMessages.id }).from(aiMessages)
    .where(and(
      eq(aiMessages.conversationId, conversation.id),
      inArray(aiMessages.status, ["PENDING", "STREAMING"])
    )).limit(1);
  if (activeMessage) throw new ConflictError("当前会话已有正在生成的 AI 回答");

  const lockKeyName = `ai:conversation:${conversation.id}:generation`;
  lockKey = lockKeyName;
  lockToken = randomUUID();
  if (await app.redis.set(lockKey, lockToken, "EX", 900, "NX") !== "OK") {
    throw new ConflictError("当前会话已有正在生成的 AI 回答");
  }

  let runtime: SceneRuntime;
  try {
    runtime = await resolveSceneRuntime(app.db, conversation.scene, conversation.reasoningMode);
  } catch (error) {
    await releaseGenerationLock(app, lockKey, lockToken);
    throw error;
  }

  const [userMessage, assistantMessage] = await app.db.transaction(async (tx) => {
    const [userRow] = await tx.insert(aiMessages).values({
      conversationId: conversation.id,
      userId: user.id,
      role: "USER",
      content,
      status: "COMPLETED",
      reasoningMode: conversation.reasoningMode,
      requestId
    }).returning();
    const [assistantRow] = await tx.insert(aiMessages).values({
      conversationId: conversation.id,
      role: "ASSISTANT",
      content: "",
      status: "PENDING",
      reasoningMode: conversation.reasoningMode,
      providerId: runtime.primary.providerId,
      provider: runtime.primary.providerName,
      modelId: runtime.primary.modelRef.id,
      model: runtime.primary.modelId,
      promptVersionId: runtime.promptVersionId,
      promptTemplateVersion: runtime.promptVersionNumber,
      requestId,
      metadata: { reasoningMode: conversation.reasoningMode, reasoning: runtime.reasoning }
    }).returning();
    if (chatImages.length > 0) {
      await tx.insert(aiMessageAttachments).values(chatImages.map((image, index) => ({
        messageId: userRow!.id,
        fileId: image.fileId,
        attachmentType: "IMAGE" as const,
        sortOrder: index,
        visionStatus: "PENDING" as const
      })));
    }
    return [userRow!, assistantRow!];
  });
  createdAssistantMessageId = assistantMessage.id;

  let vision: VisionContext | null = null;
  if (chatImages.length > 0) {
    try {
      vision = await describeChatImages(app, chatImages, content);
      await app.db.update(aiMessageAttachments).set({
        visionStatus: "SUCCEEDED",
        visionResultJson: visionResultPayload(vision, chatImages.map((image) => image.fileId)),
        semanticSummary: vision.semanticSummary,
        extractedText: vision.extractedText,
        detectedObjectsJson: vision.detectedObjects,
        visionModel: vision.modelId
      }).where(eq(aiMessageAttachments.messageId, userMessage.id));
    } catch (error) {
      await app.db.update(aiMessageAttachments).set({
        visionStatus: "FAILED",
        visionResultJson: { error: error instanceof Error ? error.message : "视觉识别失败" }
      }).where(eq(aiMessageAttachments.messageId, userMessage.id));
      throw error;
    }
  }
  const visionContext = vision ? formatVisionContext(vision.text) : null;

  // 会话保温体系上下文（专业场景必选；只注入标识信息，技术规则仍须来自检索/工具）
  const insulationSystem = conversation.insulationSystemId
    ? await getPublishedInsulationSystem(app.db, conversation.insulationSystemId)
    : null;

  const capabilities = providedChunks !== undefined
    ? {
      needKnowledgeSearch: true,
      explicitKnowledgeRequest: true,
      needProjectContext: Boolean(conversation.projectId),
      needThermalTool: false,
      needComparisonTool: conversation.scene === AI_SCENES.MATERIAL_COMPARE,
      needReportContext: false
    }
    : resolveAiCapabilities({
      message: content,
      projectId: conversation.projectId,
      conversationId: conversation.id,
      scene: conversation.scene
    });

  const allowedTools = selectAllowedToolNames({
    capabilities,
    hasProject: Boolean(conversation.projectId),
    allowKnowledgeSearch: runtime.allowKnowledgeSearch
  });
  const agentModel = providedChunks !== undefined ? null : await resolveAgentModel(runtime, app.db);
  const agentEnabled = Boolean(agentModel && allowedTools.length > 0);

  // Agent 路径由工具按需检索；无工具模型或知识问答注入仍走预检索，避免假装已有 Agent 能力。
  const { chunks, retrievalFailed } = await loadKnowledgeForGeneration({
    app,
    log: request.log,
    conversationId: conversation.id,
    messageId: assistantMessage.id,
    content,
    projectId: conversation.projectId,
    insulationSystemId: conversation.insulationSystemId ?? null,
    needSearch: agentEnabled ? false : capabilities.needKnowledgeSearch,
    providedChunks
  });

  const projectContext = conversation.projectId
    ? await resolveProjectContext(app, conversation.projectId)
    : null;
  const comparisonRules = !agentEnabled && (conversation.scene === AI_SCENES.MATERIAL_COMPARE || capabilities.needComparisonTool)
    ? await loadApprovedComparisonRules(app, {})
    : [];
  const shouldInjectKnowledge = !agentEnabled && (providedChunks !== undefined
    || chunks.length > 0
    || retrievalFailed
    || (capabilities.needKnowledgeSearch && capabilities.explicitKnowledgeRequest));
  const knowledgeContext = shouldInjectKnowledge ? formatKnowledgeContext(chunks, { retrievalFailed }) : null;
  const built = await buildAiContext({
    app,
    conversation,
    currentMessage: content,
    runtime,
    projectContext,
    insulationSystemContext: insulationSystem
      ? formatInsulationSystemContext({ name: insulationSystem.name, code: insulationSystem.code, systemType: insulationSystem.systemType })
      : null,
    knowledgeContext,
    ruleContext: comparisonRules.length > 0 ? formatComparisonRuleContext(comparisonRules) : null,
    thermalContext: !agentEnabled && capabilities.needThermalTool ? formatThermalCapabilityContext() : null,
    visionContext,
    excludeMessageIds: [userMessage.id, assistantMessage.id]
  });
  const system = built.system;
  const messages: ModelMessage[] = built.messages;

  const stopKey = `ai:message:${assistantMessage.id}:stop`;
  const generation: ActiveGeneration & { lockKey: string; lockToken: string; stopKey: string } = {
    controller: new AbortController(),
    conversationId: conversation.id,
    userId: user.id,
    stopRequested: false,
    lockKey,
    lockToken,
    stopKey
  };
  activeGenerations.set(assistantMessage.id, generation);
  let streamFinished = false;
  const onClientClose = () => {
    if (!streamFinished && !generation.stopRequested) {
      generation.stopRequested = true;
      generation.stopReason = "CLIENT_DISCONNECTED";
      generation.controller.abort();
    }
  };

  startSseStream(reply, request.id);
  writeSse(reply, "message", { messageId: assistantMessage.id, userMessageId: userMessage.id, conversationId: conversation.id, requestId });
  writeSse(reply, "message_start", { messageId: assistantMessage.id, userMessageId: userMessage.id, conversationId: conversation.id, requestId });
  writeProgress(reply, "analyzing", chatImages.length > 0
    ? "正在识别图片并分析问题..."
    : conversation.projectId ? "正在分析项目资料..." : "正在分析问题...");
  request.raw.once("close", onClientClose);
  await app.db.update(aiMessages).set({ status: "STREAMING", startedAt: new Date() }).where(eq(aiMessages.id, assistantMessage.id));
  if (!agentEnabled && (providedChunks !== undefined || capabilities.needKnowledgeSearch)) {
    writeProgress(reply, "checking", "正在核对检索资料和计算结果...");
  }
  writeProgress(reply, "composing", "正在整理回答...");

  let fullText = "";
  let streamUsage: LanguageModelUsage | undefined;
  let usedFallback = false;
  let originalFailedModel: string | null = null;
  let agentSources: unknown[] | null = null;
  let finishReason: "COMPLETED" | "WAITING_USER_INPUT" = "COMPLETED";

  const streamBody = async (modelConfig: typeof runtime.primary) => {
    const result = streamText({
      model: modelConfig.languageModel,
      system,
      messages,
      maxOutputTokens: runtime.sceneMaxOutputTokens ?? runtime.primary.maxOutputTokens ?? undefined,
      temperature: runtime.sceneTemperature ?? runtime.primary.defaultTemperature ?? undefined,
      timeout: modelConfig.timeoutMs,
      abortSignal: generation.controller.signal,
      providerOptions: runtime.providerOptions
    });
    let text = "";
    for await (const delta of result.textStream) {
      if (await app.redis.exists(stopKey) === 1) {
        generation.stopRequested = true;
        generation.stopReason = "USER";
        generation.controller.abort();
        const stopError = new Error("AI 回答已请求停止");
        stopError.name = "AbortError";
        throw stopError;
      }
      text += delta;
      fullText += delta;
      writeSse(reply, "delta", { text: delta });
      writeSse(reply, "text_delta", { text: delta });
    }
    streamUsage = await result.usage;
    return text;
  };

  try {
    const waitingRun = await getActiveAgentRun(app, conversation.id);
    const resumeModel = agentModel ?? (runtime.primary.capabilities?.tools === true ? runtime.primary : null);
    if (waitingRun?.status === "WAITING_USER_INPUT" && resumeModel) {
      const resumeTools = (waitingRun.allowedToolsJson ?? allowedTools) as typeof allowedTools;
      const resumeState = await prepareResumeState(waitingRun, content);
      resumeState.system = system;
      await app.db.update(aiAgentRuns).set({
        status: "RUNNING",
        assistantMessageId: assistantMessage.id,
        triggerMessageId: userMessage.id,
        stateJson: resumeState
      }).where(eq(aiAgentRuns.id, waitingRun.id));
      writeSse(reply, "agent_status", { message: "正在根据你的选择继续任务…", runId: waitingRun.id });
      const agentResult = await runAgentLoop({
        app, request, reply, user, conversation, runtime,
        agentModel: resumeModel,
        allowedTools: resumeTools,
        assistantMessageId: assistantMessage.id,
        agentRunId: waitingRun.id,
        abortSignal: generation.controller.signal,
        initialState: resumeState
      });
      fullText = agentResult.text;
      streamUsage = agentResult.usage;
      agentSources = agentResult.sources;
      if (agentResult.finish === "WAITING_USER_INPUT") finishReason = "WAITING_USER_INPUT";
      if (agentResult.finish === "FAILED" && agentResult.error) throw agentResult.error;
      if (agentResult.finish === "CANCELLED") {
        generation.stopRequested = true;
        throw Object.assign(new Error("AI 回答已请求停止"), { name: "AbortError" });
      }
    } else if (agentEnabled && agentModel) {
      const run = await createAgentRun(app, {
        conversation,
        user,
        triggerMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        allowedTools,
        model: agentModel.modelId,
        state: { system, messages, recentToolHashes: [], fullText: "", sources: [] }
      });
      writeSse(reply, "agent_status", { message: "正在调用专业工具…", runId: run.id });
      const agentResult = await runAgentLoop({
        app, request, reply, user, conversation, runtime, agentModel, allowedTools,
        assistantMessageId: assistantMessage.id,
        agentRunId: run.id,
        abortSignal: generation.controller.signal,
        initialState: { system, messages, recentToolHashes: [], fullText: "", sources: [] }
      });
      fullText = agentResult.text;
      streamUsage = agentResult.usage;
      agentSources = agentResult.sources;
      if (agentResult.finish === "WAITING_USER_INPUT") finishReason = "WAITING_USER_INPUT";
      if (agentResult.finish === "FAILED" && agentResult.error) throw agentResult.error;
      if (agentResult.finish === "CANCELLED") {
        generation.stopRequested = true;
        throw Object.assign(new Error("AI 回答已请求停止"), { name: "AbortError" });
      }
    } else {
      await streamBody(runtime.primary);
    }
  } catch (error) {
    if (agentEnabled) throw error;
    if (isAbortError(error) || generation.stopRequested || fullText !== "" || !runtime.fallback) {
      throw error;
    }
    originalFailedModel = runtime.primary.modelId;
    request.log.warn({ messageId: assistantMessage.id, originalFailedModel, fallbackModel: runtime.fallback.modelId }, "主模型调用失败，尝试备用模型");
    await streamBody(runtime.fallback);
    usedFallback = true;
  }

  const actualModelId = usedFallback
    ? runtime.fallback!.modelId
    : (agentEnabled && agentModel ? agentModel.modelId : runtime.primary.modelId);
  try {
    if (chunks.length > 0 && !/\[资料\d+\]/.test(fullText)) {
      const citationNotice = `\n\n参考来源：${chunks.map((chunk, index) => {
        const pageText = chunk.pageLabel ?? (chunk.sourcePage != null ? String(chunk.sourcePage) : null);
        return `[资料${index + 1}] ${chunk.sourceTitle}${pageText ? ` ${pageText} 页` : ""}`;
      }).join("；")}`;
      fullText += citationNotice;
      writeSse(reply, "delta", { text: citationNotice });
    }
    if (await app.redis.exists(stopKey) === 1) {
      generation.stopRequested = true;
      generation.stopReason = "USER";
      const stopError = new Error("AI 回答已请求停止");
      stopError.name = "AbortError";
      throw stopError;
    }

    const doneSources = agentSources ?? (mapSources ?? toAiSources)(chunks);
    const metadata = {
      reasoningMode: conversation.reasoningMode,
      reasoning: runtime.reasoning,
      capabilities,
      allowedTools,
      agentEnabled,
      finishReason,
      ...(usedFallback ? { fallbackUsed: true, originalFailedModel, actualModel: actualModelId } : {})
    };
    await app.db.transaction(async (tx) => {
      await tx.update(aiMessages).set({
        content: fullText,
        status: "COMPLETED",
        tokenInput: streamUsage?.inputTokens,
        tokenOutput: streamUsage?.outputTokens,
        reasoningTokens: streamUsage?.outputTokenDetails?.reasoningTokens,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date(),
        metadata
      }).where(eq(aiMessages.id, assistantMessage.id));
      await tx.update(aiConversations)
        .set({ updatedAt: new Date(), lastMessageAt: new Date() })
        .where(eq(aiConversations.id, conversation.id));
      await writeAuditLog({
        db: tx, request, actor: user, projectId: conversation.projectId ?? undefined,
        action: AUDIT_ACTIONS.AI_MESSAGE_SENT, targetType: "ai_message", targetId: userMessage.id,
        afterJson: {
          assistantMessageId: assistantMessage.id,
          model: actualModelId,
          retrievalCount: chunks.length,
          fallbackUsed: usedFallback
        }
      });
    });
    // 记录本次回答引用的材料对比规则（审计，含快照）
    if (comparisonRules.length > 0) {
      await logComparisonRuleUsage(app, user, {
        conversationId: conversation.id,
        messageId: assistantMessage.id,
        rules: comparisonRules
      });
    }
    // 首条用户消息回答完成后异步生成会话标题（仅未命名会话，Worker 内再做条件写入）
    if (conversation.title == null) {
      const [userMessageCount] = await app.db.select({ value: count() }).from(aiMessages)
        .where(and(eq(aiMessages.conversationId, conversation.id), eq(aiMessages.role, "USER")));
      if ((userMessageCount?.value ?? 0) === 1) {
        await app.queues.aiTitleGeneration.add("conversation_title", { conversationId: conversation.id });
      }
    }
    streamFinished = true;
    writeProgress(reply, "completed", finishReason === "WAITING_USER_INPUT" ? "需要你确认后继续" : "回答整理完成");
    writeSse(reply, "done", {
      messageId: assistantMessage.id,
      conversationId: conversation.id,
      finishReason,
      usage: {
        inputTokens: streamUsage?.inputTokens,
        outputTokens: streamUsage?.outputTokens,
        reasoningTokens: streamUsage?.outputTokenDetails?.reasoningTokens
      },
      model: { id: actualModelId },
      promptVersion: { id: runtime.promptVersionId, version: runtime.promptVersionNumber },
      sources: doneSources,
      latencyMs: Date.now() - startedAt
    });
    writeSse(reply, "message_done", {
      messageId: assistantMessage.id,
      conversationId: conversation.id,
      finishReason,
      sources: doneSources
    });
    if (built.droppedEarlyMessages || finishReason === "COMPLETED") {
      void updateConversationSummary(app, conversation.id, {
        force: finishReason === "COMPLETED" && agentEnabled,
        droppedEarlyMessages: built.droppedEarlyMessages
      }).catch((error) => request.log.warn({ err: error }, "会话摘要更新失败"));
    }
    void scheduleConversationMaintenance(app, conversation.id);
    if (conversation.projectId && finishReason === "COMPLETED") {
      void refreshProjectMemoryFromConversation(app, conversation.id, user, request)
        .catch((error) => request.log.warn({ err: error }, "项目记忆提取失败"));
    }
  } catch (error) {
    const stopRequested = generation.stopRequested || (await app.redis.exists(stopKey).catch(() => 0)) === 1 || isAbortError(error);
    if (stopRequested) {
      request.log.info({ messageId: assistantMessage.id }, "AI 回答已停止");
      const activeRun = await getActiveAgentRun(app, conversation.id);
      if (activeRun) await cancelAgentRun(app, activeRun.id);
      await app.db.transaction(async (tx) => {
        await tx.update(aiMessages).set({
          content: fullText,
          status: "STOPPED",
          stopReason: generation.stopReason ?? "USER",
          durationMs: Date.now() - startedAt,
          finishedAt: new Date(),
          metadata: {
            reasoningMode: conversation.reasoningMode,
            reasoning: runtime.reasoning,
            ...(usedFallback ? { fallbackUsed: true, originalFailedModel, actualModel: actualModelId } : {})
          }
        }).where(eq(aiMessages.id, assistantMessage.id));
        await tx.update(aiConversations)
          .set({ updatedAt: new Date(), lastMessageAt: new Date() })
          .where(eq(aiConversations.id, conversation.id));
        await writeAuditLog({
          db: tx, request, actor: user, projectId: conversation.projectId ?? undefined,
          action: AUDIT_ACTIONS.AI_MESSAGE_STOPPED,
          targetType: "ai_message",
          targetId: assistantMessage.id,
          afterJson: { stopReason: generation.stopReason ?? "USER", contentLength: fullText.length }
        });
      });
      writeSse(reply, "stopped", {
        messageId: assistantMessage.id,
        partialContent: fullText,
        content: fullText,
        usage: streamUsage ? {
          inputTokens: streamUsage.inputTokens,
          outputTokens: streamUsage.outputTokens,
          reasoningTokens: streamUsage.outputTokenDetails?.reasoningTokens
        } : undefined
      });
    } else {
      const aiError = error instanceof AiError ? error : toAiError(error);
      request.log.error({ err: error, requestId }, "AI 回复生成失败");
      await app.db.update(aiMessages).set({
        content: fullText,
        status: "FAILED",
        errorMessage: aiError.message,
        errorCode: aiError.code,
        requestId,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date()
      }).where(eq(aiMessages.id, assistantMessage.id));
      writeSse(reply, "error", {
        code: aiError.code,
        message: aiError.message,
        requestId,
        retryable: aiError.retryable
      });
    }
  } finally {
    streamFinished = true;
    request.raw.off("close", onClientClose);
    activeGenerations.delete(assistantMessage.id);
    await releaseGenerationLock(app, lockKey, lockToken);
    await app.redis.del(stopKey);
    await releaseQuota();
    reply.raw.end();
  }
  } catch (error) {
    if (lockKey && lockToken) {
      await releaseGenerationLock(app, lockKey, lockToken);
    }
    await failPendingGenerationMessage(app, createdAssistantMessageId, error);
    await releaseQuota();
    throw error;
  }
}

export { resolveProjectContext } from "./ai-project-profile.js";
/**
 * AI 对话生成共享服务：敏感词围栏 → 限流/配额 → 生成锁 → 场景运行时解析 →
 * 消息落库 → 知识检索注入 → 提示词组装 → SSE 流式生成（主/备用模型降级）→ 审计与引用出参。
 * 发送消息（/conversations/:id/messages）与知识问答（/knowledge-qa）共用。
 * 未传入 knowledgeChunks 时由能力路由决定是否检索已发布知识库，不再依赖用户选择 scene。
 */
import { randomUUID } from "node:crypto";
import { streamText, type LanguageModelUsage, type ModelMessage } from "ai";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, count, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { env } from "../../config/env.js";
import { aiConversations, aiMessages, projects } from "../../db/schema.js";
import { AI_SCENES, AUDIT_ACTIONS } from "../../shared/constants.js";
import { AiError, toAiError } from "../../shared/ai-errors.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { ConflictError, NotFoundError, TooManyRequestsError } from "../../shared/errors.js";
import { canViewProject } from "../../shared/permissions.js";
import { budgetHistory, buildSystemMessages, estimateTokens, formatInsulationSystemContext, formatThermalCapabilityContext, type ContextMessage } from "../../shared/prompt-assembly.js";
import { isAbortError, startSseStream, writeProgress, writeSse } from "./ai-sse.js";
import { checkContentFiltered } from "./ai-content-filter.service.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { formatKnowledgeContext, type WikiHit } from "../knowledge/knowledge.service.js";
import { getPublishedInsulationSystem } from "../construction/construction-read.service.js";
import { toAiSources } from "./ai-source.mapper.js";
import { formatComparisonRuleContext, loadApprovedComparisonRules, logComparisonRuleUsage } from "../comparison/material-compare.service.js";
import { createConcurrencyRelease, enforceAiQuota, resolveSceneRuntime, type SceneRuntime } from "./ai-runtime.service.js";
import { loadKnowledgeForGeneration } from "./ai-knowledge-load.js";
import { resolveAiCapabilities } from "./ai-capability-router.js";

/** 模型 contextWindow 缺省时的保守预算 */
export const DEFAULT_CONTEXT_WINDOW = 32_000;

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
  /** 传入时跳过场景内自动检索，直接使用该检索结果（知识问答场景；空数组表示无检索结果） */
  knowledgeChunks?: WikiHit[];
  /** 覆盖 done.sources 映射（B 端版本测试可裁剪调试字段） */
  mapSources?: (hits: readonly WikiHit[]) => unknown;
}): Promise<void> {
  const { app, request, reply, user, conversation, content, knowledgeChunks: providedChunks, mapSources } = options;
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
    return [userRow!, assistantRow!];
  });
  createdAssistantMessageId = assistantMessage.id;

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

  // 检索：外部注入优先（knowledge-qa / test-qa）；否则按能力路由自动检索已发布知识。
  // 检索失败不得 500，降级为无资料继续生成，由模型给出可理解说明。
  const { chunks, retrievalFailed } = await loadKnowledgeForGeneration({
    app,
    log: request.log,
    conversationId: conversation.id,
    messageId: assistantMessage.id,
    content,
    projectId: conversation.projectId,
    insulationSystemId: conversation.insulationSystemId ?? null,
    needSearch: capabilities.needKnowledgeSearch,
    providedChunks
  });

  const projectContext = (runtime.requireProject || capabilities.needProjectContext)
    ? await resolveProjectContext(app, conversation.projectId)
    : null;
  const comparisonRules = conversation.scene === AI_SCENES.MATERIAL_COMPARE || capabilities.needComparisonTool
    ? await loadApprovedComparisonRules(app, {})
    : [];
  const shouldInjectKnowledge = providedChunks !== undefined
    || chunks.length > 0
    || retrievalFailed
    || (capabilities.needKnowledgeSearch && capabilities.explicitKnowledgeRequest);
  const knowledgeContext = shouldInjectKnowledge ? formatKnowledgeContext(chunks, { retrievalFailed }) : null;
  const systemMessages = buildSystemMessages({
    scenePrompt: runtime.promptContent,
    projectContext,
    insulationSystemContext: insulationSystem
      ? formatInsulationSystemContext({ name: insulationSystem.name, code: insulationSystem.code, systemType: insulationSystem.systemType })
      : null,
    knowledgeContext,
    ruleContext: comparisonRules.length > 0 ? formatComparisonRuleContext(comparisonRules) : null,
    thermalContext: capabilities.needThermalTool ? formatThermalCapabilityContext() : null
  });
  const system = systemMessages.map((message) => message.content).join("\n\n");

  const historyRows = await app.db.select({ role: aiMessages.role, content: aiMessages.content, id: aiMessages.id })
    .from(aiMessages).where(and(
      eq(aiMessages.conversationId, conversation.id),
      inArray(aiMessages.status, ["COMPLETED", "STOPPED"]),
      notInArray(aiMessages.id, [userMessage.id, assistantMessage.id])
    )).orderBy(desc(aiMessages.createdAt)).limit(200);
  const historyMessages: ContextMessage[] = historyRows.reverse()
    .filter((message) => (message.role === "USER" || message.role === "ASSISTANT")
      && message.id !== userMessage.id && message.id !== assistantMessage.id)
    .map((message) => ({
      role: message.role === "USER" ? "user" as const : "assistant" as const,
      content: message.content
    }));
  const budgeted = budgetHistory({
    history: historyMessages,
    systemTokens: estimateTokens(system),
    userMessageTokens: estimateTokens(content),
    contextWindow: runtime.primary.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxOutputTokens: runtime.sceneMaxOutputTokens ?? runtime.primary.maxOutputTokens
  });
  const messages: ModelMessage[] = [...budgeted, { role: "user", content }];

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
  writeProgress(reply, "analyzing", conversation.projectId ? "正在分析项目资料..." : "正在分析问题...");
  request.raw.once("close", onClientClose);
  await app.db.update(aiMessages).set({ status: "STREAMING", startedAt: new Date() }).where(eq(aiMessages.id, assistantMessage.id));
  // checking 阶段仅在真实执行知识检索时发送，不伪造“检索/计算”进度
  if (providedChunks !== undefined || capabilities.needKnowledgeSearch) {
    writeProgress(reply, "checking", "正在核对检索资料和计算结果...");
  }
  writeProgress(reply, "composing", "正在整理回答...");

  let fullText = "";
  let streamUsage: LanguageModelUsage | undefined;
  let usedFallback = false;
  let originalFailedModel: string | null = null;

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
    }
    streamUsage = await result.usage;
    return text;
  };

  try {
    await streamBody(runtime.primary);
  } catch (error) {
    // 仅在未产出任何内容、非用户停止且配置了备用模型时重试一次
    if (isAbortError(error) || generation.stopRequested || fullText !== "" || !runtime.fallback) {
      throw error;
    }
    originalFailedModel = runtime.primary.modelId;
    request.log.warn({ messageId: assistantMessage.id, originalFailedModel, fallbackModel: runtime.fallback.modelId }, "主模型调用失败，尝试备用模型");
    await streamBody(runtime.fallback);
    usedFallback = true;
  }

  const actualModelId = usedFallback ? runtime.fallback!.modelId : runtime.primary.modelId;
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

    const metadata = {
      reasoningMode: conversation.reasoningMode,
      reasoning: runtime.reasoning,
      capabilities,
      ...(usedFallback ? { fallbackUsed: true, originalFailedModel, actualModel: actualModelId } : {})
    };
    await app.db.transaction(async (tx) => {
      await tx.update(aiMessages).set({
        content: fullText,
        status: "COMPLETED",
        tokenInput: streamUsage?.inputTokens,
        tokenOutput: streamUsage?.outputTokens,
        reasoningTokens: streamUsage?.outputTokenDetails.reasoningTokens,
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
    writeProgress(reply, "completed", "回答整理完成");
    writeSse(reply, "done", {
      messageId: assistantMessage.id,
      conversationId: conversation.id,
      finishReason: "COMPLETED",
      usage: {
        inputTokens: streamUsage?.inputTokens,
        outputTokens: streamUsage?.outputTokens,
        reasoningTokens: streamUsage?.outputTokenDetails.reasoningTokens
      },
      model: { id: actualModelId },
      promptVersion: { id: runtime.promptVersionId, version: runtime.promptVersionNumber },
      sources: (mapSources ?? toAiSources)(chunks),
      latencyMs: Date.now() - startedAt
    });
  } catch (error) {
    const stopRequested = generation.stopRequested || (await app.redis.exists(stopKey).catch(() => 0)) === 1 || isAbortError(error);
    if (stopRequested) {
      request.log.info({ messageId: assistantMessage.id }, "AI 回答已停止");
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
          reasoningTokens: streamUsage.outputTokenDetails.reasoningTokens
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

/** 项目上下文（关联项目时注入真实数据；用户问及项目但未绑定时提示选择项目） */
export async function resolveProjectContext(app: FastifyInstance, projectId: string | null): Promise<string | null> {
  if (!projectId) {
    return "当前会话未关联项目。涉及项目数据时请先选择项目，不要编造项目名称、地区、建筑类型或工程参数。";
  }
  const [project] = await app.db.select().from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt))).limit(1);
  if (!project) return null;
  return [
    `项目名称：${project.name}`,
    project.description ? `项目描述：${project.description}` : null,
    project.region ? `所在地区：${project.region}` : null,
    project.buildingType ? `建筑类型：${project.buildingType}` : null
  ].filter(Boolean).join("\n");
}
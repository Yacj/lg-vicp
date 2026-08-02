/**
 * AI 调试路由（B 端平台）：流式验证模型与提示词配置，不落 ai_messages 库。
 * - POST /debug/chat：指定模型或场景发起调试对话（SSE，事件与业务对话一致）
 * - POST /debug/:id/stop：停止调试生成
 * 所有调用写审计；只允许 system:ai:debug:use 权限账号使用。
 */
import { randomUUID } from "node:crypto";
import { streamText, type LanguageModelUsage } from "ai";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { aiScenes, prompts, promptVersions } from "../../db/schema.js";
import { AiError, toAiError } from "../../shared/ai-errors.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { buildSystemMessages } from "../../shared/prompt-assembly.js";
import { ok } from "../../shared/response.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { resolveModelById, type ResolvedModelConfig } from "../ai-config/ai-config.service.js";
import { resolveReasoningProviderOptions, type ProviderOptionsMap, type ReasoningMode } from "./ai-runtime.service.js";
import { isAbortError, writeProgress, writeSse } from "./ai-sse.js";

const debugChatBodySchema = z.object({
  scene: z.string().trim().min(1, "请输入场景编码").max(80).optional(),
  modelId: z.uuid("模型 ID 格式不正确").optional(),
  promptVersionId: z.uuid("提示词版本 ID 格式不正确").optional(),
  reasoningMode: z.enum(["OFF", "ON"]).default("OFF"),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1, "消息内容不能为空").max(60000)
  })).min(1, "至少需要一条消息").max(30, "调试消息最多 30 条")
}).refine((value) => value.modelId || value.scene || value.promptVersionId, "请至少指定模型 ID、场景或提示词版本中的一项");

const debugStopParamsSchema = z.object({ id: z.uuid("调试任务 ID 格式不正确") });

type DebugGeneration = {
  controller: AbortController;
  stopRequested: boolean;
  stopReason?: "USER" | "CLIENT_DISCONNECTED";
};

/** 进行中的调试任务（内存态，进程重启即失效，不影响业务会话） */
const debugGenerations = new Map<string, DebugGeneration>();

function requireDebugPermission(request: Parameters<typeof getCurrentUser>[0]) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && !(user.permissionCodes ?? []).includes("system:ai:debug:use")) {
    throw new ForbiddenError("当前账号没有 AI 调试权限");
  }
  return user;
}

/**
 * 解析调试运行时：
 * - modelId 指定时直连该模型（最常用于验证模型能力）；
 * - 否则按场景解析（不要求场景已开放，便于调试未上线场景），模型不可用时给出明确错误；
 * - promptVersionId 指定时覆盖提示词，否则用场景当前生效版本；均未提供时仅应用平台基础规则。
 */
async function resolveDebugRuntime(
  app: FastifyInstance,
  body: z.infer<typeof debugChatBodySchema>
): Promise<{ model: ResolvedModelConfig; promptContent: string; providerOptions: ProviderOptionsMap | undefined }> {
  let model: ResolvedModelConfig | null = null;
  let promptContent: string | null = null;

  if (body.modelId) {
    model = await resolveModelById(app.db, body.modelId);
  } else {
    const sceneCode = body.scene ?? "general_chat";
    const [scene] = await app.db.select().from(aiScenes).where(eq(aiScenes.code, sceneCode)).limit(1);
    if (!scene) throw new NotFoundError(`AI 场景“${sceneCode}”不存在`);
    const primaryId = body.reasoningMode === "ON"
      ? (scene.reasoningModelId ?? scene.defaultModelId)
      : scene.defaultModelId;
    if (!primaryId) throw new AiError("AI_CONFIG_INVALID", `场景“${scene.name}”尚未配置可用模型`);
    model = await resolveModelById(app.db, primaryId);
    const [promptRow] = await app.db.select({ version: promptVersions })
      .from(prompts)
      .innerJoin(promptVersions, eq(promptVersions.id, prompts.activeVersionId))
      .where(eq(prompts.sceneId, scene.id)).limit(1);
    promptContent = promptRow?.version.content ?? null;
  }

  if (body.promptVersionId) {
    const [version] = await app.db.select().from(promptVersions).where(eq(promptVersions.id, body.promptVersionId)).limit(1);
    if (!version) throw new NotFoundError("提示词版本不存在");
    promptContent = version.content;
  }

  return {
    model: model!,
    promptContent: promptContent ?? "（调试模式：未指定场景或提示词版本，仅应用平台基础规则）",
    providerOptions: resolveReasoningProviderOptions(model!, body.reasoningMode)
  };
}

export async function aiDebugRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.post("/debug/chat", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI调试"],
      summary: "发起 AI 调试对话（SSE 流式）",
      description: "不写入业务消息库；事件流与业务对话一致（message/progress/delta/done/stopped/error）。",
      body: debugChatBodySchema
    }
  }, async (request, reply) => {
    const actor = requireDebugPermission(request);
    const body = request.body;
    const runtime = await resolveDebugRuntime(app, body);

    const debugId = randomUUID();
    const requestId = request.id;
    const system = buildSystemMessages({ scenePrompt: runtime.promptContent, projectContext: null, knowledgeContext: null })
      .map((message) => message.content).join("\n\n");

    const generation: DebugGeneration = { controller: new AbortController(), stopRequested: false };
    debugGenerations.set(debugId, generation);

    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-request-id": requestId
    });
    writeSse(reply, "message", { messageId: debugId, requestId });
    writeProgress(reply, "analyzing", "调试请求已受理，正在连接模型...");
    writeProgress(reply, "composing", "正在整理回答...");

    const startedAt = Date.now();
    let fullText = "";
    let streamUsage: LanguageModelUsage | undefined;
    let stopRequested = false;

    try {
      const result = streamText({
        model: runtime.model.languageModel,
        system,
        messages: body.messages,
        timeout: runtime.model.timeoutMs,
        abortSignal: generation.controller.signal,
        providerOptions: runtime.providerOptions
      });
      for await (const delta of result.textStream) {
        if (generation.stopRequested) {
          stopRequested = true;
          generation.controller.abort();
          const stopError = new Error("AI 回答已请求停止");
          stopError.name = "AbortError";
          throw stopError;
        }
        fullText += delta;
        writeSse(reply, "delta", { text: delta });
      }
      streamUsage = await result.usage;
      writeProgress(reply, "completed", "调试回答整理完成");
      writeSse(reply, "done", {
        messageId: debugId,
        finishReason: "COMPLETED",
        usage: {
          inputTokens: streamUsage?.inputTokens,
          outputTokens: streamUsage?.outputTokens,
          reasoningTokens: streamUsage?.outputTokenDetails.reasoningTokens
        },
        model: { id: runtime.model.modelRef.id },
        latencyMs: Date.now() - startedAt
      });
    } catch (error) {
      if (isAbortError(error) || generation.stopRequested) {
        stopRequested = true;
        request.log.info({ debugId }, "AI 调试已停止");
        writeSse(reply, "stopped", { messageId: debugId, partialContent: fullText, content: fullText });
      } else {
        const aiError = error instanceof AiError ? error : toAiError(error);
        request.log.error({ err: error, requestId }, "AI 调试生成失败");
        writeSse(reply, "error", {
          code: aiError.code,
          message: aiError.message,
          requestId,
          retryable: aiError.retryable
        });
      }
    } finally {
      debugGenerations.delete(debugId);
      reply.raw.end();
    }

    try {
      await writeAuditLog({
        db: app.db, request, actor,
        action: AUDIT_ACTIONS.AI_DEBUG_USED,
        targetType: "ai_debug", targetId: debugId,
        afterJson: {
          scene: body.scene ?? null,
          modelId: body.modelId ?? runtime.model.modelRef.id,
          promptVersionId: body.promptVersionId ?? null,
          reasoningMode: body.reasoningMode,
          messageCount: body.messages.length,
          outcome: stopRequested ? "stopped" : "completed",
          contentLength: fullText.length
        }
      });
    } catch (error) {
      // 审计失败不阻断调试（响应已结束）
      request.log.error({ err: error, debugId }, "AI 调试审计写入失败");
    }
  });

  route.post("/debug/:id/stop", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / AI调试"],
      summary: "停止 AI 调试对话",
      params: debugStopParamsSchema
    }
  }, async (request) => {
    requireDebugPermission(request);
    const generation = debugGenerations.get(request.params.id);
    if (!generation) throw new NotFoundError("调试任务不存在或已结束");
    generation.stopRequested = true;
    generation.stopReason = "USER";
    generation.controller.abort();
    return ok(request, { message: "已请求停止调试", debugId: request.params.id });
  });
}
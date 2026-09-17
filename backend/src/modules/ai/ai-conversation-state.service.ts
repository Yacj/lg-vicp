/**
 * 会话滚动摘要：增量压缩历史，不复制完整聊天记录。
 * 触发：即将被 token 裁剪、消息数/token 达阈值、会话结束、同项目新建会话、Agent Run 完成。
 */
import { generateObject } from "ai";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import { aiConversationStates, aiConversations, aiMessages } from "../../db/schema.js";
import { estimateTokens } from "../../shared/prompt-assembly.js";
import { resolveSceneRuntime } from "./ai-runtime.service.js";

export type ConversationStateSnapshot = {
  summary: string;
  activeGoal: string | null;
  confirmedFacts: Array<{ key: string; value: string }>;
  openQuestions: Array<{ question: string; blocking?: boolean }>;
  importantReferences: Array<{ kind: string; title: string; ref?: string }>;
  lastSummarizedMessageId: string | null;
  version: number;
};

const summaryOutputSchema = z.object({
  summary: z.string(),
  activeGoal: z.string().nullable(),
  confirmedFacts: z.array(z.object({
    key: z.string(),
    value: z.string()
  })),
  openQuestions: z.array(z.object({
    question: z.string(),
    blocking: z.boolean().optional()
  })),
  importantReferences: z.array(z.object({
    kind: z.enum(["KNOWLEDGE", "CALC", "ATTACHMENT", "REPORT", "OTHER"]),
    title: z.string(),
    ref: z.string().optional()
  }))
});

export const CONVERSATION_SUMMARY_SYSTEM_PROMPT = `你是会话状态整理器。根据旧摘要和新增消息，产出新的滚动摘要。
必须保留：用户目标、用户明确给出的项目条件、用户明确选择或否决、已完成的查询与计算、关键来源、待确认条件。
禁止只写“讨论了某问题”这类空泛描述。不要复制完整聊天记录。使用中文。`;

export function shouldUpdateConversationSummary(input: {
  unsummarizedCount: number;
  unsummarizedTokens: number;
  droppedEarlyMessages: boolean;
  force?: boolean;
}): boolean {
  if (input.force) return true;
  if (input.droppedEarlyMessages && input.unsummarizedCount > 0) return true;
  if (input.unsummarizedCount >= env.AI_SUMMARY_MESSAGE_THRESHOLD) return true;
  if (input.unsummarizedTokens >= env.AI_SUMMARY_TOKEN_THRESHOLD) return true;
  return false;
}

export function formatConversationStateContext(
  state: {
    summary?: string | null;
    activeGoal?: string | null;
    confirmedFactsJson?: Array<Record<string, unknown>> | null;
    openQuestionsJson?: Array<Record<string, unknown>> | null;
    importantReferencesJson?: Array<Record<string, unknown>> | null;
  } | null
): string | null {
  if (!state) return null;
  const facts = (state.confirmedFactsJson ?? []).map((item) => {
    const key = typeof item.key === "string" ? item.key : "事实";
    const value = typeof item.value === "string" ? item.value : JSON.stringify(item);
    return `- ${key}：${value}`;
  });
  const questions = (state.openQuestionsJson ?? []).map((item) => {
    const question = typeof item.question === "string" ? item.question : JSON.stringify(item);
    return `- ${question}`;
  });
  const refs = (state.importantReferencesJson ?? []).map((item) => {
    const title = typeof item.title === "string" ? item.title : JSON.stringify(item);
    const kind = typeof item.kind === "string" ? item.kind : "OTHER";
    return `- [${kind}] ${title}`;
  });
  const body = [
    state.activeGoal ? `当前任务：${state.activeGoal}` : null,
    state.summary ? `压缩历史：\n${state.summary}` : null,
    facts.length > 0 ? `已确认事实：\n${facts.join("\n")}` : null,
    questions.length > 0 ? `待确认：\n${questions.join("\n")}` : null,
    refs.length > 0 ? `重要引用：\n${refs.join("\n")}` : null
  ].filter(Boolean);
  if (body.length === 0) return null;
  return ["【会话状态（滚动摘要，不是完整记录）】", ...body].join("\n");
}

function formatMessagesForSummary(rows: Array<{ role: string; content: string }>): string {
  return rows.map((row) => `${row.role === "USER" ? "用户" : "助手"}：${row.content.slice(0, 1200)}`).join("\n");
}

export async function updateConversationSummary(
  app: FastifyInstance,
  conversationId: string,
  options: { force?: boolean; droppedEarlyMessages?: boolean } = {}
): Promise<ConversationStateSnapshot | null> {
  const [conversation] = await app.db.select().from(aiConversations)
    .where(eq(aiConversations.id, conversationId)).limit(1);
  if (!conversation) return null;

  const [existing] = await app.db.select().from(aiConversationStates)
    .where(eq(aiConversationStates.conversationId, conversationId)).limit(1);

  const messages = await app.db.select({
    id: aiMessages.id,
    role: aiMessages.role,
    content: aiMessages.content,
    status: aiMessages.status
  }).from(aiMessages).where(and(
    eq(aiMessages.conversationId, conversationId),
    eq(aiMessages.status, "COMPLETED")
  )).orderBy(asc(aiMessages.createdAt));

  const lastId = existing?.lastSummarizedMessageId ?? null;
  const lastIndex = lastId ? messages.findIndex((row) => row.id === lastId) : -1;
  const unsummarized = messages.slice(lastIndex + 1).filter((row) => row.role === "USER" || row.role === "ASSISTANT");
  const unsummarizedTokens = unsummarized.reduce((sum, row) => sum + estimateTokens(row.content), 0);
  if (!shouldUpdateConversationSummary({
    unsummarizedCount: unsummarized.length,
    unsummarizedTokens,
    droppedEarlyMessages: options.droppedEarlyMessages === true,
    force: options.force
  })) {
    return existing ? {
      summary: existing.summary ?? "",
      activeGoal: existing.activeGoal,
      confirmedFacts: (existing.confirmedFactsJson ?? []) as ConversationStateSnapshot["confirmedFacts"],
      openQuestions: (existing.openQuestionsJson ?? []) as ConversationStateSnapshot["openQuestions"],
      importantReferences: (existing.importantReferencesJson ?? []) as ConversationStateSnapshot["importantReferences"],
      lastSummarizedMessageId: existing.lastSummarizedMessageId,
      version: existing.version
    } : null;
  }
  if (unsummarized.length === 0) return existing ? {
    summary: existing.summary ?? "",
    activeGoal: existing.activeGoal,
    confirmedFacts: (existing.confirmedFactsJson ?? []) as ConversationStateSnapshot["confirmedFacts"],
    openQuestions: (existing.openQuestionsJson ?? []) as ConversationStateSnapshot["openQuestions"],
    importantReferences: (existing.importantReferencesJson ?? []) as ConversationStateSnapshot["importantReferences"],
    lastSummarizedMessageId: existing.lastSummarizedMessageId,
    version: existing.version
  } : null;

  const runtime = await resolveSceneRuntime(app.db, conversation.scene, "OFF");
  const result = await generateObject({
    model: runtime.primary.languageModel,
    schema: summaryOutputSchema,
    system: CONVERSATION_SUMMARY_SYSTEM_PROMPT,
    prompt: [
      existing?.summary ? `旧摘要：\n${existing.summary}` : "尚无旧摘要。",
      existing?.activeGoal ? `旧任务：${existing.activeGoal}` : null,
      existing?.confirmedFactsJson?.length ? `旧已确认事实：${JSON.stringify(existing.confirmedFactsJson)}` : null,
      existing?.openQuestionsJson?.length ? `旧待确认：${JSON.stringify(existing.openQuestionsJson)}` : null,
      "新增消息：",
      formatMessagesForSummary(unsummarized)
    ].filter(Boolean).join("\n"),
    maxOutputTokens: 1200,
    temperature: 0.2,
    abortSignal: AbortSignal.timeout(runtime.primary.timeoutMs)
  });

  const lastMessage = unsummarized[unsummarized.length - 1]!;
  const nextVersion = (existing?.version ?? 0) + 1;
  const values = {
    summary: result.object.summary,
    activeGoal: result.object.activeGoal,
    confirmedFactsJson: result.object.confirmedFacts,
    openQuestionsJson: result.object.openQuestions,
    importantReferencesJson: result.object.importantReferences,
    lastSummarizedMessageId: lastMessage.id,
    version: nextVersion,
    updatedAt: new Date()
  };

  if (existing) {
    await app.db.update(aiConversationStates).set(values)
      .where(eq(aiConversationStates.conversationId, conversationId));
  } else {
    await app.db.insert(aiConversationStates).values({
      conversationId,
      ...values
    });
  }

  return {
    summary: result.object.summary,
    activeGoal: result.object.activeGoal,
    confirmedFacts: result.object.confirmedFacts,
    openQuestions: result.object.openQuestions,
    importantReferences: result.object.importantReferences,
    lastSummarizedMessageId: lastMessage.id,
    version: nextVersion
  };
}

export async function scheduleConversationMaintenance(
  app: FastifyInstance,
  conversationId: string,
  delayMs = env.AI_MEMORY_IDLE_MS
) {
  try {
    await app.queues.aiConversationMaintenance.add(
      "idle_refresh",
      { conversationId, reason: "idle" },
      { delay: delayMs, jobId: `idle:${conversationId}`, removeOnComplete: true }
    );
  } catch {
    // 队列不可用时不阻断主对话
  }
}

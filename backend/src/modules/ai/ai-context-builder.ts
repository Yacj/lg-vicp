/**
 * 统一 AI 上下文组装：所有正式生成入口共用。
 * 组装顺序：系统规则 → 权限范围 → 项目档案 → 项目记忆 → 会话摘要 → 近期消息 →
 * 历史附件语义 → Agent 工具结果 → 检索资料 → 当前用户消息。
 * Token 按桶控制，优先保留当前消息、系统规则、已确认事实、记忆、摘要和最近消息。
 */
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ModelMessage } from "ai";
import { env } from "../../config/env.js";
import {
  aiConversationStates,
  aiMessageAttachments,
  aiMessages,
  type aiConversations
} from "../../db/schema.js";
import {
  USER_SCOPE_CONTEXT,
  budgetHistory,
  buildSystemMessages,
  compressToolOrKnowledgeText,
  DEFAULT_CONTEXT_WINDOW,
  estimateTokens,
  truncateToTokenBudget,
  type ContextMessage
} from "../../shared/prompt-assembly.js";
import { formatProjectMemoryContext, listInjectableProjectMemories } from "./ai-project-memory.service.js";
import { formatConversationStateContext } from "./ai-conversation-state.service.js";
import type { SceneRuntime } from "./ai-runtime.service.js";

export type ConversationRow = typeof aiConversations.$inferSelect;

export interface HistoricalAttachmentContext {
  messageId: string;
  fileId: string;
  semanticSummary: string;
  extractedText?: string | null;
  detectedObjects?: string[] | null;
  model?: string | null;
  createdAt: Date;
}

export interface BuildAiContextInput {
  app: FastifyInstance;
  conversation: ConversationRow;
  currentMessage: string;
  runtime: SceneRuntime;
  projectContext?: string | null;
  insulationSystemContext?: string | null;
  knowledgeContext?: string | null;
  ruleContext?: string | null;
  thermalContext?: string | null;
  visionContext?: string | null;
  agentToolContext?: string | null;
  excludeMessageIds?: string[];
}

export interface BuiltAiContext {
  system: string;
  messages: ModelMessage[];
  history: ContextMessage[];
  droppedEarlyMessages: boolean;
  attachmentContexts: HistoricalAttachmentContext[];
  budget: {
    systemTokens: number;
    summaryTokens: number;
    memoryTokens: number;
    historyTokens: number;
    knowledgeTokens: number;
    toolTokens: number;
    currentMessageTokens: number;
  };
}

export function formatAttachmentContext(items: HistoricalAttachmentContext[]): string | null {
  if (items.length === 0) return null;
  const lines = items.map((item, index) => {
    const objects = item.detectedObjects?.length ? `可见对象：${item.detectedObjects.join("、")}` : null;
    const text = item.extractedText?.trim() ? `可见文字：${item.extractedText.trim()}` : null;
    return [
      `图${index + 1}（fileId=${item.fileId}）`,
      item.semanticSummary.trim(),
      text,
      objects
    ].filter(Boolean).join("\n");
  });
  return [
    "【历史附件语义（已识别，不必要求用户重新上传，也不必重新整张看图）】",
    "用户提到“刚才那张图/第二个节点”时，优先依据下列摘要定位，不要假装没有看过。",
    ...lines
  ].join("\n");
}

export async function loadHistoricalAttachmentContext(
  app: FastifyInstance,
  conversationId: string,
  excludeMessageIds: string[] = []
): Promise<HistoricalAttachmentContext[]> {
  const rows = await app.db.select({
    messageId: aiMessageAttachments.messageId,
    fileId: aiMessageAttachments.fileId,
    semanticSummary: aiMessageAttachments.semanticSummary,
    extractedText: aiMessageAttachments.extractedText,
    detectedObjectsJson: aiMessageAttachments.detectedObjectsJson,
    visionModel: aiMessageAttachments.visionModel,
    visionResultJson: aiMessageAttachments.visionResultJson,
    visionStatus: aiMessageAttachments.visionStatus,
    createdAt: aiMessageAttachments.createdAt
  }).from(aiMessageAttachments)
    .innerJoin(aiMessages, eq(aiMessages.id, aiMessageAttachments.messageId))
    .where(and(
      eq(aiMessages.conversationId, conversationId),
      eq(aiMessageAttachments.visionStatus, "SUCCEEDED"),
      excludeMessageIds.length > 0 ? notInArray(aiMessageAttachments.messageId, excludeMessageIds) : undefined
    ))
    .orderBy(aiMessageAttachments.createdAt)
    .limit(20);

  return rows.flatMap((row) => {
    const fromColumn = row.semanticSummary?.trim();
    const fromJson = typeof row.visionResultJson?.semanticSummary === "string"
      ? row.visionResultJson.semanticSummary.trim()
      : typeof row.visionResultJson?.text === "string"
        ? row.visionResultJson.text.trim()
        : "";
    const semanticSummary = fromColumn || fromJson;
    if (!semanticSummary) return [];
    return [{
      messageId: row.messageId,
      fileId: row.fileId,
      semanticSummary,
      extractedText: row.extractedText ?? (typeof row.visionResultJson?.extractedText === "string" ? row.visionResultJson.extractedText : null),
      detectedObjects: row.detectedObjectsJson
        ?? (Array.isArray(row.visionResultJson?.detectedObjects) ? row.visionResultJson.detectedObjects as string[] : null),
      model: row.visionModel ?? (typeof row.visionResultJson?.modelId === "string" ? row.visionResultJson.modelId : null),
      createdAt: row.createdAt
    }];
  });
}

export async function buildAiContext(input: BuildAiContextInput): Promise<BuiltAiContext> {
  const excludeIds = input.excludeMessageIds ?? [];
  const [stateRow] = await input.app.db.select().from(aiConversationStates)
    .where(eq(aiConversationStates.conversationId, input.conversation.id))
    .limit(1);
  const memories = input.conversation.projectId
    ? await listInjectableProjectMemories(input.app, input.conversation.projectId)
    : [];
  const attachments = await loadHistoricalAttachmentContext(input.app, input.conversation.id, excludeIds);

  const summaryContext = truncateToTokenBudget(
    formatConversationStateContext(stateRow ?? null),
    env.AI_CONTEXT_BUCKET_SUMMARY_TOKENS
  );
  const memoryContext = truncateToTokenBudget(
    formatProjectMemoryContext(memories),
    env.AI_CONTEXT_BUCKET_MEMORY_TOKENS
  );
  const attachmentContext = truncateToTokenBudget(
    formatAttachmentContext(attachments),
    env.AI_CONTEXT_BUCKET_ATTACHMENT_TOKENS
  );
  const knowledgeContext = compressToolOrKnowledgeText(
    input.knowledgeContext,
    env.AI_CONTEXT_BUCKET_KNOWLEDGE_TOKENS
  );
  const agentToolContext = compressToolOrKnowledgeText(
    input.agentToolContext,
    env.AI_CONTEXT_BUCKET_TOOL_TOKENS
  );

  const systemMessages = buildSystemMessages({
    scenePrompt: input.runtime.promptContent,
    userScopeContext: USER_SCOPE_CONTEXT,
    projectContext: input.projectContext,
    projectMemoryContext: memoryContext || null,
    conversationSummaryContext: summaryContext || null,
    insulationSystemContext: input.insulationSystemContext,
    attachmentContext: attachmentContext || null,
    agentToolContext: agentToolContext || null,
    knowledgeContext: knowledgeContext || null,
    ruleContext: input.ruleContext,
    thermalContext: input.thermalContext,
    visionContext: input.visionContext
  });
  const system = systemMessages.map((message) => message.content).join("\n\n");

  const historyRows = await input.app.db.select({
    role: aiMessages.role,
    content: aiMessages.content,
    id: aiMessages.id
  }).from(aiMessages).where(and(
    eq(aiMessages.conversationId, input.conversation.id),
    inArray(aiMessages.status, ["COMPLETED", "STOPPED"]),
    excludeIds.length > 0 ? notInArray(aiMessages.id, excludeIds) : undefined
  )).orderBy(desc(aiMessages.createdAt)).limit(200);

  const historyMessages: ContextMessage[] = historyRows.reverse()
    .filter((message) => message.role === "USER" || message.role === "ASSISTANT")
    .map((message) => ({
      role: message.role === "USER" ? "user" as const : "assistant" as const,
      content: message.content
    }));

  const contextWindow = input.runtime.primary.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const currentMessageTokens = estimateTokens(input.currentMessage);
  const systemTokens = estimateTokens(system);
  const budgeted = budgetHistory({
    history: historyMessages,
    systemTokens,
    userMessageTokens: currentMessageTokens,
    contextWindow,
    maxOutputTokens: input.runtime.sceneMaxOutputTokens ?? input.runtime.primary.maxOutputTokens
  });
  const droppedEarlyMessages = budgeted.length < historyMessages.length;

  return {
    system,
    messages: [...budgeted, { role: "user", content: input.currentMessage }],
    history: budgeted,
    droppedEarlyMessages,
    attachmentContexts: attachments,
    budget: {
      systemTokens,
      summaryTokens: estimateTokens(summaryContext),
      memoryTokens: estimateTokens(memoryContext),
      historyTokens: budgeted.reduce((sum, message) => sum + estimateTokens(message.content), 0),
      knowledgeTokens: estimateTokens(knowledgeContext),
      toolTokens: estimateTokens(agentToolContext),
      currentMessageTokens
    }
  };
}

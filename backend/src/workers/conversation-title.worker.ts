/**
 * AI 会话自动标题 Worker：
 * 会话首条用户消息回答完成后投递，异步调用模型生成简短标题。
 * 仅当会话标题仍为空（未手动重命名）时写入；生成失败保持“未知对话”，不阻塞主对话。
 * 提示词与模型均走场景解析链路（conversation_title 场景），禁止写死模型。
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { generateText } from "ai";
import type { Database } from "../db/client.js";
import { aiConversations, aiMessages } from "../db/schema.js";
import { AI_SCENES, AUDIT_ACTIONS } from "../shared/constants.js";
import { writeAuditLog } from "../modules/audit-logs/audit-log.service.js";
import { resolveSceneRuntime } from "../modules/ai/ai-runtime.service.js";

const MAX_TITLE_LENGTH = 120;

/** 清洗模型输出：去掉首尾引号/破折号/空格，压缩换行，截断到允许长度 */
export function normalizeTitle(raw: string): string {
  return raw
    .trim()
    .replace(/^["''“”《》【】\s\-—:：]+|["''“”《》【】\s\-—:：]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, MAX_TITLE_LENGTH);
}

export interface ConversationTitleJob {
  conversationId?: string;
}

export function createConversationTitleProcessor(db: Database) {
  return async (job: { id?: string; name?: string; data: ConversationTitleJob }) => {
    const conversationId = job.data?.conversationId;
    if (!conversationId) throw new Error("会话标题任务缺少 conversationId 参数");

    // 仅处理仍处于活跃状态且尚未命名的会话（手动重命名后不再覆盖）
    const [conversation] = await db.select().from(aiConversations)
      .where(and(
        eq(aiConversations.id, conversationId),
        eq(aiConversations.status, "active"),
        isNull(aiConversations.title),
        isNull(aiConversations.deletedAt)
      ))
      .limit(1);
    if (!conversation) return { skipped: "conversation_titled_or_inactive" };

    // 取该会话最早一条用户消息作为标题素材
    const [firstUserMessage] = await db.select({ content: aiMessages.content })
      .from(aiMessages)
      .where(and(
        eq(aiMessages.conversationId, conversationId),
        eq(aiMessages.role, "USER"),
        eq(aiMessages.status, "COMPLETED")
      ))
      .orderBy(asc(aiMessages.createdAt))
      .limit(1);
    if (!firstUserMessage) return { skipped: "no_user_message" };

    const runtime = await resolveSceneRuntime(db, AI_SCENES.CONVERSATION_TITLE, "OFF");
    const result = await generateText({
      model: runtime.primary.languageModel,
      system: runtime.promptContent,
      prompt: `用户消息：${firstUserMessage.content.slice(0, 1000)}`,
      maxOutputTokens: runtime.sceneMaxOutputTokens ?? runtime.primary.maxOutputTokens ?? 60,
      temperature: runtime.sceneTemperature ?? runtime.primary.defaultTemperature ?? 0,
      timeout: runtime.primary.timeoutMs
    });
    const title = normalizeTitle(result.text);
    if (!title) return { skipped: "empty_title" };

    // 条件更新：仅当标题仍为空时写入，避免覆盖用户手动重命名
    const [updated] = await db.update(aiConversations)
      .set({ title, updatedAt: new Date() })
      .where(and(
        eq(aiConversations.id, conversationId),
        isNull(aiConversations.title)
      ))
      .returning({ id: aiConversations.id });
    if (!updated) return { skipped: "titled_by_user" };

    await writeAuditLog({
      db,
      action: AUDIT_ACTIONS.AI_CONVERSATION_TITLED,
      targetType: "ai_conversation",
      targetId: conversationId,
      afterJson: { title, source: "auto" }
    });
    return { conversationId, title };
  };
}
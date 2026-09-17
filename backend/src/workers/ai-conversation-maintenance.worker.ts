/**
 * 会话空闲整理：滚动摘要 + 项目记忆候选提取。
 * 不依赖用户点击“结束会话”；由延迟队列在长时间无消息后触发。
 */
import type { FastifyInstance } from "fastify";
import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import { aiConversations, users } from "../db/schema.js";
import { updateConversationSummary } from "../modules/ai/ai-conversation-state.service.js";
import { refreshProjectMemoryFromConversation } from "../modules/ai/ai-project-memory.service.js";
import type { AuthUser } from "../shared/auth-user.js";

export interface ConversationMaintenanceJob {
  conversationId?: string;
  reason?: "idle" | "end" | "agent" | "manual";
}

export function createConversationMaintenanceProcessor(appLike: Pick<FastifyInstance, "db">) {
  return async (job: Job<ConversationMaintenanceJob>) => {
    const conversationId = job.data?.conversationId;
    if (!conversationId) throw new Error("会话整理任务缺少 conversationId");
    const [conversation] = await appLike.db.select().from(aiConversations)
      .where(eq(aiConversations.id, conversationId)).limit(1);
    if (!conversation || conversation.deletedAt) return { skipped: true };
    const fakeApp = appLike as FastifyInstance;
    await updateConversationSummary(fakeApp, conversationId, { force: true });
    if (conversation.projectId) {
      const [actor] = await appLike.db.select().from(users).where(eq(users.id, conversation.userId)).limit(1);
      if (actor) {
        await refreshProjectMemoryFromConversation(fakeApp, conversationId, actor as unknown as AuthUser);
      }
    }
    return { conversationId, reason: job.data.reason ?? "idle" };
  };
}

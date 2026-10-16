import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { aiMessages } from "../../db/schema.js";
import { constructionCodes } from "./reference-candidate-selection.js";

/** 调用方已验证本人会话；只取完成的助手消息，用户声称不是历史证据。 */
export async function readReferenceFactHistory(app: FastifyInstance, conversationId: string) {
  return app.db.select({ id: aiMessages.id, content: aiMessages.content, metadata: aiMessages.metadata, createdAt: aiMessages.createdAt })
    .from(aiMessages).where(and(eq(aiMessages.conversationId, conversationId), eq(aiMessages.role, "ASSISTANT"), eq(aiMessages.status, "COMPLETED")))
    .orderBy(desc(aiMessages.createdAt)).limit(200);
}
export function historyMentionStatus(code: string, rows: Array<{ content: string }>) {
  return rows.some(row => constructionCodes(row.content).some(value => value === code));
}

import { and, asc, desc, eq, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { aiMessages } from "../../db/schema.js";
import { DOMAIN_INTENTS } from "./ai-domain-turn-decision.js";
import type { ConversationTaskState } from "./conversation-task.js";
import { adviceContextIsCurrent, type AdviceBusinessContext } from "./solution-advice-context.js";

/** 旧会话兼容：只取当前会话最近两轮目标，不从正文提取候选ID或工程事实。 */
export async function loadAdviceBusinessContext(app: FastifyInstance, conversation: { id: string; projectId: string | null }, state: ConversationTaskState, currentUserMessageId: string) {
  if (adviceContextIsCurrent(state.adviceBusinessContext, conversation, state)) return state.adviceBusinessContext;
  const rows = await app.db.select({ role: aiMessages.role, content: aiMessages.content, metadata: aiMessages.metadata, createdAt: aiMessages.createdAt })
    .from(aiMessages).where(and(eq(aiMessages.conversationId, conversation.id), eq(aiMessages.status, "COMPLETED"), ne(aiMessages.id, currentUserMessageId)))
    .orderBy(desc(aiMessages.createdAt), asc(aiMessages.role)).limit(4);
  const recentGoals: AdviceBusinessContext["recentGoals"] = [];
  let assistant: typeof rows[number] | undefined;
  for (const row of rows) {
    if (row.role === "ASSISTANT") assistant = row;
    if (row.role !== "USER" || !assistant) continue;
    const metadata = assistant.metadata as { backendDecision?: { domainIntent?: string; referenceRevision?: number; referenceQueryRevisionAfter?: number } } | null;
    const intent = metadata?.backendDecision?.domainIntent;
    if (intent && (DOMAIN_INTENTS as readonly string[]).includes(intent)) recentGoals.unshift({ intent, userGoal: row.content.slice(0, 300),
      assistantQuestion: assistant.content.slice(0, 300) });
    assistant = undefined;
  }
  const latest = recentGoals.at(-1);
  const lastCompleted = rows.find(row => row.role === "ASSISTANT");
  const revision = (lastCompleted?.metadata as { backendDecision?: { referenceQueryRevisionAfter?: number } } | null)?.backendDecision?.referenceQueryRevisionAfter;
  return { conversationId: conversation.id, projectId: conversation.projectId,
    candidateQueryRevision: revision, createdAt: lastCompleted?.createdAt.toISOString() ?? new Date(0).toISOString(),
    candidateScopeActive: Boolean(latest && (["REFERENCE_QUERY", "REFERENCE_REFINE", "REFERENCE_VIEW", "REFERENCE_DETAIL", "COMPARE_CANDIDATES", "COMPLIANCE_CHECK", "SOLUTION_ADVICE"].includes(latest.intent)
      )),
    recentGoals: recentGoals.slice(-2) } satisfies AdviceBusinessContext;
}

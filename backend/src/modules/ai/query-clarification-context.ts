import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { aiConversations, aiMessages } from "../../db/schema.js";
import { describeNumberRoles } from "../thermal/semantic-query.js";
import { parseThermalLookupMessage } from "../thermal/thermal-lookup-mode.js";
import type { DomainTurnSemantic } from "./ai-domain-semantic.js";

type Conversation = { id: string; userId: string; clientApp: string; projectId: string | null };
type Turn = { id: string; role: string; content: string; metadata: unknown; createdAt: Date; projectId: string | null };
/** SM-CLARIFY-EVIDENCE-01：指标由本轮明确说明，唯一数值由已核验的原问绑定；不改意图/置信度/作用域。 */
export function groundClarificationMetricEvidence(message: string, original: string, semantic: DomainTurnSemantic) {
  if (semantic.queryContext !== "CLARIFICATION_REPLY" || semantic.requestedEffect !== "QUERY" || !semantic.pageQuery) return semantic;
  const currentMetric = parseThermalLookupMessage(message).metric;
  const targetNumbers = (text: string) => describeNumberRoles(text).filter(number => number.role === "UNKNOWN" || number.role === "THERMAL_TARGET");
  if (!currentMetric || targetNumbers(message).length) return semantic;
  const numbers = targetNumbers(original);
  if (numbers.length !== 1) return semantic;
  return { ...semantic, pageQuery: { ...semantic.pageQuery, constraints: semantic.pageQuery.constraints.map(constraint =>
    constraint.type === "METRIC" && constraint.metric === currentMetric && constraint.value === Number(numbers[0]!.raw)
      && !targetNumbers(constraint.evidence).some(number => Number(number.raw) === constraint.value)
      ? { ...constraint, evidence: original } : constraint) } };
}
/** 待澄清原话不是有效查询/候选。仅最近已完成的问答对、本人同端同项目、24h内可用。 */
export function recentQueryClarification(rows: readonly Turn[], conversation: Conversation, now = Date.now()) {
  const [answer, question] = rows;
  const metadata = answer?.metadata as { queryScope?: Conversation; backendDecision?: { domainIntent?: string; requestedEffect?: string; relation?: string } } | null;
  if (!answer || !question || answer.role !== "ASSISTANT" || question.role !== "USER"
    || metadata?.backendDecision?.domainIntent !== "CLARIFY" || metadata.backendDecision.requestedEffect !== "READ_ONLY"
    || metadata.queryScope?.id !== conversation.id || metadata.queryScope.userId !== conversation.userId
    || metadata.queryScope.clientApp !== conversation.clientApp || metadata.queryScope.projectId !== conversation.projectId
    || answer.projectId !== conversation.projectId || question.projectId !== conversation.projectId
    || now - answer.createdAt.getTime() < 0 || now - question.createdAt.getTime() < 0
    || now - question.createdAt.getTime() > 24 * 3600_000 || answer.createdAt < question.createdAt) return null;
  return { messageId: question.id, message: question.content, question: answer.content,
    inheritPrevious: metadata.backendDecision.relation === "REFINE" || metadata.backendDecision.relation === "CONTINUE" };
}
export async function readQueryClarification(app: FastifyInstance, conversation: Conversation, currentUserMessageId?: string) {
  const rows = await app.db.select({ id: aiMessages.id, role: aiMessages.role, content: aiMessages.content,
    metadata: aiMessages.metadata, createdAt: aiMessages.createdAt, projectId: aiConversations.projectId })
    .from(aiMessages).innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
    .where(and(eq(aiMessages.conversationId, conversation.id), eq(aiConversations.userId, conversation.userId),
      eq(aiConversations.clientApp, conversation.clientApp), eq(aiConversations.status, "active"),
      inArray(aiMessages.status, ["COMPLETED"]), currentUserMessageId ? ne(aiMessages.id, currentUserMessageId) : undefined))
    // 同事务的user/assistant.createdAt可完全相同；UUID不能表达问答顺序。
    .orderBy(desc(sql`coalesce(${aiMessages.finishedAt}, ${aiMessages.createdAt})`), desc(aiMessages.id)).limit(2);
  return recentQueryClarification(rows, conversation);
}

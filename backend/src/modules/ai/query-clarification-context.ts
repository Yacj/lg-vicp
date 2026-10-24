import { messageChronology } from "./message-chronology.js";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { aiConversations, aiMessages } from "../../db/schema.js";
import { describeNumberRoles } from "../thermal/semantic-query.js";
import { normalizeEntityText } from "../thermal/thermal-query-state.js";
import { hasLambdaField } from "../../shared/lambda-field.js";
import { parseThermalLookupMessage } from "../thermal/thermal-lookup-mode.js";
import type { DomainTurnSemantic } from "./ai-domain-semantic.js";
import { pendingQueryNeedSchema, type QueryClarification } from "./query-need.js";

type Conversation = { id: string; userId: string; clientApp: string; projectId: string | null };
type Turn = { id: string; role: string; content: string; metadata: unknown; createdAt: Date; projectId: string | null };
/** 封闭工程字段名，不判用户意图；裸热阻字段未说明产品/层/整构造口径。 */
export function isUnscopedResistanceField(text: string) {
  const field = normalizeEntityText(text);
  return field === "热阻" || field === "r" || field === "传热阻";
}
/** SM-CLARIFY-EVIDENCE-01：指标由本轮明确说明，唯一数值由已核验的原问绑定；不改意图/置信度/作用域。 */
export function groundClarificationMetricEvidence(message: string, original: string, semantic: DomainTurnSemantic) {
  if (semantic.queryContext !== "CLARIFICATION_REPLY" || semantic.requestedEffect !== "QUERY" || !semantic.pageQuery) return semantic;
  const explicitMetric = parseThermalLookupMessage(message).metric;
  // 连续澄清可能先补“R”，再补“板材本身/整面墙”。第二个回复不含指标字面量，
  // 不能因此丢掉原问数值。只为提案已有的唯一R指标补原问数值证据，不推断口径或改写授权。
  const proposedResistance = [...new Set(semantic.pageQuery.constraints.flatMap(constraint => constraint.type === "METRIC"
    && (constraint.metric === "PRODUCT_R" || constraint.metric === "TOTAL_R") ? [constraint.metric] : []))];
  const currentMetric = explicitMetric ?? (!hasLambdaField(message) && original.split("\n").some(isUnscopedResistanceField)
    && proposedResistance.length === 1 ? proposedResistance[0] : undefined);
  const targetNumbers = (text: string) => describeNumberRoles(text).filter(number => number.role === "UNKNOWN" || number.role === "THERMAL_TARGET");
  if (!currentMetric || targetNumbers(message).length) return semantic;
  const numbers = targetNumbers(original);
  if (numbers.length !== 1) return semantic;
  return { ...semantic, pageQuery: { ...semantic.pageQuery, constraints: semantic.pageQuery.constraints.map(constraint =>
    constraint.type === "METRIC" && constraint.metric === currentMetric && constraint.value === Number(numbers[0]!.raw)
      && !targetNumbers(constraint.evidence).some(number => Number(number.raw) === constraint.value)
      ? { ...constraint, evidence: original } : constraint) } };
}
/** 待澄清原话不是有效查询/候选。仅最近已完成的问答对、本人同端同项目、24h内可用；指标类型澄清可能记录为 QUERY 或 READ_ONLY。 */
export function recentQueryClarification(rows: readonly Turn[], conversation: Conversation, now = Date.now()): QueryClarification | null {
  const answer = rows[0];
  const question = rows[1];
  const metadata = answer?.metadata as { queryScope?: Conversation; backendDecision?: { domainIntent?: string; requestedEffect?: string; relation?: string;
    pendingQueryNeed?: unknown; queryNeedsClarification?: boolean; pendingQueryContractVersion?: number;
    referenceQueryDiagnostics?: { issues?: string[] };
    parameterQueryDiagnostics?: { missingTolerance?: boolean; issues?: string[] } } } | null;
  // 参数Service的缺容差/名称未解析也是只读待澄清结果，不把成功参数读取或零命中当pending。
  // 新回复明确记录是否保存了查询澄清；没有pending时不能再走旧CLARIFY兼容恢复。
  const contractVersion = metadata?.backendDecision?.pendingQueryContractVersion;
  if (contractVersion != null && (contractVersion !== 1 || metadata?.backendDecision?.pendingQueryNeed == null)) return null;
  const parameterClarification = metadata?.backendDecision?.domainIntent === "PRODUCT_PARAMETER_QUERY"
    && (metadata.backendDecision.parameterQueryDiagnostics?.missingTolerance === true
      || metadata.backendDecision.parameterQueryDiagnostics?.issues?.includes("NAME_UNRESOLVED")
      || metadata.backendDecision.parameterQueryDiagnostics?.issues?.includes("RESULT_OBJECT_UNRESOLVED"));
  const referenceClarification = (metadata?.backendDecision?.domainIntent === "REFERENCE_QUERY" || metadata?.backendDecision?.domainIntent === "REFERENCE_REFINE")
    && metadata.backendDecision.referenceQueryDiagnostics?.issues?.includes("IDENTITY_NOT_FOUND");
  const explanationInterlude = metadata?.backendDecision?.pendingQueryNeed != null
    && metadata.backendDecision.relation === "CONTINUE"
    && (metadata.backendDecision.domainIntent === "KNOWLEDGE_EXPLAIN" || metadata.backendDecision.domainIntent === "GENERAL" || metadata.backendDecision.domainIntent === "SOLUTION_ADVICE");
  const serviceClarification = metadata?.backendDecision?.queryNeedsClarification === true && metadata.backendDecision.pendingQueryNeed != null;
  if (!answer || !question || answer.role !== "ASSISTANT" || question.role !== "USER"
    || metadata?.backendDecision?.domainIntent !== "CLARIFY" && !parameterClarification && !referenceClarification && !explanationInterlude && !serviceClarification
    || metadata?.backendDecision?.requestedEffect !== "READ_ONLY" && metadata?.backendDecision?.requestedEffect !== "QUERY"
    || metadata.queryScope?.id !== conversation.id || metadata.queryScope.userId !== conversation.userId
    || metadata.queryScope.clientApp !== conversation.clientApp || metadata.queryScope.projectId !== conversation.projectId
    || answer.projectId !== conversation.projectId || question.projectId !== conversation.projectId
    || !Number.isFinite(answer.createdAt.getTime()) || !Number.isFinite(question.createdAt.getTime())
    || now - answer.createdAt.getTime() < 0 || now - question.createdAt.getTime() < 0
    || now - question.createdAt.getTime() > 24 * 3600_000 || answer.createdAt < question.createdAt) return null;
  const saved = pendingQueryNeedSchema.safeParse(metadata.backendDecision.pendingQueryNeed);
  if (metadata.backendDecision.pendingQueryNeed != null) {
    if (!saved.success || saved.data.turns[0]?.messageId !== saved.data.rootMessageId
      || saved.data.turns.at(-1)?.messageId !== question.id || saved.data.turns.at(-1)?.message !== question.content
      || now < Date.parse(saved.data.createdAt) || now - Date.parse(saved.data.createdAt) > 24 * 3600_000) return null;
    return { messageId: saved.data.rootMessageId, message: saved.data.turns.map(turn => turn.message).join("\n"),
      question: answer.content, inheritPrevious: saved.data.inheritPrevious, need: saved.data };
  }
  // 旧消息只兼容紧邻问答；不跨未知消息追溯带数值原问。
  return { messageId: question.id, message: question.content, question: answer.content,
    originCreatedAt: question.createdAt.toISOString(),
    inheritPrevious: metadata.backendDecision.relation === "REFINE" || metadata.backendDecision.relation === "CONTINUE" };
}
/** 只补充“热阻/K”时，保留原问唯一数值并只问真正影响口径的一个问题。 */
export function specificClarificationQuestion(original: string | undefined, message: string): string | null {
  if (!original) return null;
  const currentNumbers = describeNumberRoles(message).filter(number => number.role === "UNKNOWN" || number.role === "THERMAL_TARGET");
  if (currentNumbers.length) return null;
  const numbers = describeNumberRoles(original).filter(number => number.role === "UNKNOWN" || number.role === "THERMAL_TARGET");
  if (numbers.length !== 1) return null;
  const value = numbers[0]!.raw;
  // λ/K 已经明确，不重复确认，也不把“小于”等范围改成等值。
  if (hasLambdaField(message) || !isUnscopedResistanceField(message) && parseThermalLookupMessage(message).metric != null) return null;
  const normalized = normalizeEntityText(message);
  if (normalized.includes("热阻") || normalized === "r") return `你说的“热阻 ${value}”是指产品整体热阻、芯材/构造层热阻，还是整构造传热阻？确认后我只按这个口径查。`;
  return null;
}

export async function readQueryClarification(app: FastifyInstance, conversation: Conversation, currentUserMessageId?: string) {
  const rows = await app.db.select({ id: aiMessages.id, role: aiMessages.role, content: aiMessages.content,
    metadata: aiMessages.metadata, createdAt: aiMessages.createdAt, projectId: aiConversations.projectId })
    .from(aiMessages).innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
    .where(and(eq(aiMessages.conversationId, conversation.id), eq(aiConversations.userId, conversation.userId),
      eq(aiConversations.clientApp, conversation.clientApp), eq(aiConversations.status, "active"),
      inArray(aiMessages.status, ["COMPLETED"]), currentUserMessageId ? ne(aiMessages.id, currentUserMessageId) : undefined))
    // 同事务的user/assistant.createdAt可完全相同；UUID不能表达问答顺序。
    .orderBy(...messageChronology("DESC")).limit(8);
  return recentQueryClarification(rows, conversation);
}

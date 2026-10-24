import { readReferenceFactHistory } from "./reference-fact-history.js";
import { assertSolutionAccess } from "./solution-state.service.js";
import { productParameterQuerySchema } from "./product-parameter-query.js";
import { parameterDiagnosticsSchema, renderParameterQueryExplanation } from "./product-parameter-diagnostics.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import type { ReferenceReadContext } from "./reference-candidate-resolver.service.js";

type Conversation = { id: string; userId: string; projectId: string | null; clientApp: string };
/** 只解释紧邻实际读取的分类诊断，不恢复参数事实、来源明细或任何操作授权。 */
export function previousParameterReadContext(rows: readonly { id: string; createdAt: Date; metadata: unknown }[], conversation: Conversation, now = Date.now()) {
  const row = rows[0];
  const metadata = row?.metadata as { queryScope?: Conversation; backendDecision?: { domainIntent?: string; parameterQuery?: unknown; parameterQueryDiagnostics?: unknown;
    parameterReadContext?: { query?: unknown; diagnostics?: unknown; createdAt?: string } } } | null;
  const scope = metadata?.queryScope;
  const carried = metadata?.backendDecision?.domainIntent === "CLARIFY" || metadata?.backendDecision?.domainIntent === "KNOWLEDGE_EXPLAIN"
    ? metadata.backendDecision.parameterReadContext : undefined;
  const createdAt = carried?.createdAt ? new Date(carried.createdAt) : row?.createdAt;
  if (!row || scope?.id !== conversation.id || scope.userId !== conversation.userId || scope.projectId !== conversation.projectId
    || !Number.isFinite(row.createdAt.getTime()) || row.createdAt.getTime() > now || !createdAt || !Number.isFinite(createdAt.getTime())
    || scope.clientApp !== conversation.clientApp || now < createdAt.getTime() || now - createdAt.getTime() > 24 * 3600_000
    || metadata?.backendDecision?.domainIntent !== "PRODUCT_PARAMETER_QUERY" && !carried) return undefined;
  const query = productParameterQuerySchema.safeParse(carried?.query ?? metadata?.backendDecision?.parameterQuery);
  const diagnostics = parameterDiagnosticsSchema.safeParse(carried?.diagnostics ?? metadata?.backendDecision?.parameterQueryDiagnostics);
  return query.success && diagnostics.success ? { messageId: row.id, query: query.data, diagnostics: diagnostics.data, createdAt: createdAt.toISOString() } : undefined;
}

export async function readProductParameterExplanation(ctx: ReferenceReadContext) {
  const semantic = ctx.domainDecision?.semantic;
  if (!semantic?.parameterExplanation || applyDomainPolicy(ctx.userMessage ?? "", semantic, ctx.taskState).intent !== "KNOWLEDGE_EXPLAIN")
    throw new Error("本轮没有已核验的参数查询解释目标");
  const session = await assertSolutionAccess(ctx.app.db, ctx.user, ctx.conversation.id);
  if (session.projectId !== ctx.conversation.projectId) throw new Error("会话项目已变化");
  const context = previousParameterReadContext(await readReferenceFactHistory(ctx.app, ctx.conversation.id), ctx.conversation);
  if (!context) return { answer: "当前没有可核验的紧邻参数查询记录，请重新说明要查看的产品或材料参数。", explanationOfMessageId: undefined };
  return { answer: renderParameterQueryExplanation(context.query, context.diagnostics), explanationOfMessageId: context.messageId };
}

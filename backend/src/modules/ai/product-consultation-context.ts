import { domainTurnSemanticSchema } from "./ai-domain-semantic.js";
import { z } from "zod";
import { parseProductParameterFocus, productContinuationTarget } from "./product-parameter-focus.js";
import { lambdaUnitIsValid } from "../../shared/lambda-field.js";
import { parseThermalLookupMessage } from "../thermal/thermal-lookup-mode.js";

const filterSchema = z.object({ field: z.enum(["LAMBDA", "CORRECTION", "THICKNESS"]),
  operator: z.enum(["READ", "EXACT", "LT", "LTE", "GT", "GTE"]), targetValue: z.number().positive().finite(),
  unit: z.string(), scope: z.enum(["CATALOG", "MATERIAL_LAYER", "CONSTRUCTION_OPTION"]), referenceName: z.string() }).strict();

type Conversation = { id: string; userId: string; projectId: string | null; clientApp: string };
/** 上轮实际读取/未命中产品目标；只供续问身份grounding，每轮仍重新读取当前目录。 */
export function previousProductQueryContext(rows: readonly { id: string; createdAt: Date; metadata: unknown }[], conversation: Conversation, now = Date.now()) {
  const row = rows[0];
  const metadata = row?.metadata as { queryScope?: Conversation; backendDecision?: { domainIntent?: string; productParameterFocus?: unknown;
    productContextCreatedAt?: string; productQueryDiagnostics?: { scope?: unknown; reason?: string; parameterFilter?: unknown } } } | null;
  const scope = metadata?.queryScope;
  const createdAt = metadata?.backendDecision?.productContextCreatedAt ? new Date(metadata.backendDecision.productContextCreatedAt) : row?.createdAt;
  if (!row || scope?.id !== conversation.id || scope.userId !== conversation.userId || scope.projectId !== conversation.projectId
    || !createdAt || !Number.isFinite(createdAt.getTime())
    || scope.clientApp !== conversation.clientApp || now < createdAt.getTime() || now - createdAt.getTime() > 24 * 3600_000
    || metadata?.backendDecision?.domainIntent !== "PRODUCT_DISCOVERY" && metadata?.backendDecision?.domainIntent !== "PRODUCT_DETAIL"
      && metadata?.backendDecision?.domainIntent !== "MATERIAL_COMPARE"
      && !((metadata?.backendDecision?.domainIntent === "CLARIFY" || metadata?.backendDecision?.domainIntent === "GENERAL" || metadata?.backendDecision?.domainIntent === "KNOWLEDGE_EXPLAIN" || metadata?.backendDecision?.domainIntent === "SOLUTION_ADVICE")
        && metadata.backendDecision.productQueryDiagnostics?.reason === "CONTINUATION_PENDING")) return undefined;
  const parsed = domainTurnSemanticSchema.shape.productQuery.safeParse(metadata.backendDecision?.productQueryDiagnostics?.scope);
  return parsed.success && parsed.data ? { messageId: row.id, query: parsed.data, createdAt: createdAt.toISOString(),
    parameterFilter: filterSchema.safeParse(metadata.backendDecision.productQueryDiagnostics?.parameterFilter).data,
    ...(metadata.backendDecision.productParameterFocus != null ? { parameterFocus: metadata.backendDecision.productParameterFocus } : {}) } : undefined;
}

/** 已执行的产品反查继续改条件时，统一到原读取合同；不从一句裸数值猜新任务或身份。 */
export function bindProductFilterContinuation(message: string, semantic: z.infer<typeof domainTurnSemanticSchema>,
  context: ReturnType<typeof previousProductQueryContext>) {
  const filter = context?.parameterFilter, q = semantic.parameterQuery;
  if (!context || !filter || context.query.scope !== "CATALOG" || filter.field !== "LAMBDA" || !q
    || semantic.intent !== "PRODUCT_PARAMETER_QUERY" || semantic.requestedEffect !== "READ_ONLY"
    || semantic.relation !== "CONTINUE" && semantic.relation !== "REFINE" || semantic.productContinuation
    || semantic.queryContext === "CLARIFICATION_REPLY" || semantic.effectRequest || semantic.pageQuery
    || semantic.constraintPatch.length || semantic.reference.scope !== "NONE" || semantic.reference.items.length
    || semantic.calculationRequest || semantic.calculationRead || semantic.complianceCheck?.required
    || semantic.productQuery || semantic.factRead || semantic.parameterExplanation || semantic.readGoal === "SCHEMES"
    || q.subjectText || q.systemText || q.operator === "APPROX" || !message.includes(q.evidence)
    || !lambdaUnitIsValid(message) || parseThermalLookupMessage(message).filters.length) return undefined;
  const focus = parseProductParameterFocus(context.parameterFocus);
  if (!focus?.length || focus.some(value => value.field !== "LAMBDA" || value.scope !== filter.scope)
    || q.subjectType !== "ANY" && q.subjectType !== (filter.scope === "CATALOG" ? "PRODUCT_EQUIVALENT" : "MATERIAL_LAYER")) return undefined;
  const target = productContinuationTarget(message, "LAMBDA", q.operator, filter.operator);
  if (target.error || target.value == null || q.targetValue != null && q.targetValue !== target.value || !target.match) return undefined;
  return { ...semantic, intent: "PRODUCT_DISCOVERY" as const, relation: "CONTINUE" as const, queryContext: "CURRENT_TURN" as const,
    parameterQuery: null, productQuery: { scope: "CATALOG" as const, entityText: null, granularity: "CATALOG" as const, evidence: q.evidence },
    productContinuation: { action: "FIND_OTHERS" as const, field: "LAMBDA" as const, match: target.match, evidence: q.evidence } };
}
/** 简称纠错建议只绑定最近一次实际展示的唯一建议，不能从旧回答文字里猜身份。 */
export function previousProductNameSuggestion(rows: readonly { id: string; createdAt: Date; metadata: unknown }[], conversation: Conversation, now = Date.now()) {
  const context = previousProductQueryContext(rows, conversation, now);
  if (!context) return undefined;
  const metadata = rows[0]?.metadata as { backendDecision?: { productQueryDiagnostics?: { reason?: string; suggestions?: Array<{ name?: string; matchedName?: string }> } } };
  const diagnostic = metadata?.backendDecision?.productQueryDiagnostics;
  if (diagnostic?.reason !== "NAME_UNRESOLVED" || diagnostic.suggestions?.length !== 1) return undefined;
  const suggestion = diagnostic.suggestions[0];
  return typeof suggestion?.name === "string" && suggestion.name.trim() ? { messageId: context.messageId, name: suggestion.name } : undefined;
}

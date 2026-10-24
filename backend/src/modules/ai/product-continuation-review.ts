import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { DomainTurnSemantic } from "./ai-domain-semantic.js";
import { languageModelSamplingOptions } from "../ai-config/ai-task-runtime-policy.js";
import { describeNumberRoles } from "../thermal/semantic-query.js";

const reviewSchema = z.object({
  action: z.enum(["REPHRASE", "EXPLAIN_PARAMETER", "PARAMETERS", "UNCHANGED"]),
  field: z.enum(["LAMBDA", "CORRECTION", "THICKNESS"]).nullable(),
  confidence: z.number().min(0).max(1), evidence: z.string().min(1).max(2000)
}).strict();

/** 只有原产品名称线索、没有新数值/来源/对象的查询形状，可以复核是否其实在读取参数。 */
export function isProductProjectionQuery(original: DomainTurnSemantic, previous: NonNullable<DomainTurnSemantic["productQuery"]>) {
  const page = original.pageQuery;
  return original.requestedEffect === "QUERY" && (original.intent === "REFERENCE_QUERY" || original.intent === "REFERENCE_REFINE")
    && !!page && !page.unresolved.length && !page.sourceScope && original.relation !== "SWITCH_TOPIC" && original.relation !== "CANCEL"
    && page.constraints.every(constraint => constraint.type === "ENTITY" && constraint.operation === "SET"
      && constraint.field === "systemHint" && constraint.entityText === previous.entityText && constraint.value == null && constraint.metric == null);
}

/** Review only an unresolved read goal; no names, values, IDs, scope or operation may be proposed. */
export function bindProductReadReview(message: string, original: DomainTurnSemantic,
  previous: NonNullable<DomainTurnSemantic["productQuery"]>, raw: unknown): DomainTurnSemantic | undefined {
  const parsed = reviewSchema.safeParse(raw);
  const emptyQuery = isProductProjectionQuery(original, previous);
  if (!parsed.success || parsed.data.action === "UNCHANGED" || parsed.data.confidence < .9
    || !message.includes(parsed.data.evidence) || original.relation !== "CONTINUE" && !emptyQuery
    || original.requestedEffect !== "READ_ONLY" && !emptyQuery
    || original.effectRequest || original.pageQuery && !emptyQuery || original.parameterQuery || original.calculationRequest
    || original.calculationRead || original.parameterExplanation || original.complianceCheck?.required
    || original.constraintPatch.length || original.reference.scope !== "NONE" || original.reference.items.length
    || original.productQuery?.entityText && original.productQuery.entityText !== previous.entityText
    || parsed.data.action === "REPHRASE" && parsed.data.field != null
    || parsed.data.action === "EXPLAIN_PARAMETER" && parsed.data.field == null
    || emptyQuery && describeNumberRoles(message).length > 0
    || emptyQuery && parsed.data.action !== "PARAMETERS") return undefined;
  return { ...original, intent: "PRODUCT_DETAIL", relation: "CONTINUE", requestedEffect: "READ_ONLY", readGoal: "PRODUCTS", pageQuery: null,
    referenceReadFields: null, queryBasis: null, factRead: null, confidence: parsed.data.confidence,
    productQuery: { ...previous, evidence: parsed.data.evidence },
    productContinuation: { action: parsed.data.action, field: parsed.data.field, match: null, evidence: parsed.data.evidence } };
}

export async function reviewProductReadGoal(model: LanguageModel, message: string, original: DomainTurnSemantic,
  previous: NonNullable<DomainTurnSemantic["productQuery"]>, abortSignal: AbortSignal) {
  const result = await generateObject({ model, output: "no-schema", maxRetries: 0, abortSignal,
    ...languageModelSamplingOptions("SEMANTIC_QUERY"),
    system: `只复核同一产品只读续问的表达目标，输出JSON：${JSON.stringify(z.toJSONSchema(reviewSchema))}。REPHRASE仅表示改写已有介绍的深浅、长度或用词，field必须null；EXPLAIN_PARAMETER表示解释参数含义；PARAMETERS表示查看这个产品已有的参数或厚度，用户要看全部可用参数时field=null，指定字段仍须由本轮原话确定。通俗、简短等措辞要求不能删除本轮读取参数的目标。导热能力属于LAMBDA，修正因子属于CORRECTION，几何厚薄属于THICKNESS。整体传热/热阻、比较筛选、换产品、方案操作或不清楚时UNCHANGED。不能根据产品上下文猜本轮所指参数，不能为执行提高置信度。evidence逐字取当前原话，不能补名称、数值、来源、身份或授权。`,
    prompt: JSON.stringify({ message, previousProduct: { scope: previous.scope, entityText: previous.entityText },
      originalGoal: { intent: original.intent, productContinuation: original.productContinuation, factRead: original.factRead } }) });
  return bindProductReadReview(message, original, previous, result.object);
}

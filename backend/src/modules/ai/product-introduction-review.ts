import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { DomainTurnSemantic } from "./ai-domain-semantic.js";
import { languageModelSamplingOptions } from "../ai-config/ai-task-runtime-policy.js";
import { constructionCodes } from "./reference-candidate-selection.js";
import { describeNumberRoles } from "../thermal/semantic-query.js";

const schema = z.object({ goal: z.enum(["INTRODUCTION", "UNCHANGED"]), name: z.string().min(1).max(200).nullable(),
  confidence: z.number().min(0).max(1), evidence: z.string().min(1).max(2000) }).strict();

/** 只复核已声明PRODUCTS但误用构造解释合同的提案，不接管具体构造、核数、比较或操作。 */
export function needsProductIntroductionReview(message: string, original: DomainTurnSemantic) {
  return (original.readGoal == null || original.readGoal === "PRODUCTS") && original.intent === "KNOWLEDGE_EXPLAIN" && original.factRead?.mode === "EXPLAIN"
    && original.factRead.metric == null
    && !original.factRead.historyClaim && original.requestedEffect === "READ_ONLY"
    && !original.pageQuery && !original.parameterQuery && !original.productQuery && !original.effectRequest
    && !original.calculationRequest && !original.calculationRead && !original.complianceCheck?.required
    && !original.constraintPatch.length && original.reference.scope === "NONE" && !original.reference.items.length
    && !constructionCodes(message).length && !describeNumberRoles(message).some(number => number.role === "THERMAL_TARGET" || number.role === "UNKNOWN");
}

export function bindProductIntroduction(message: string, original: DomainTurnSemantic, raw: unknown) {
  const result = schema.safeParse(raw);
  if (!needsProductIntroductionReview(message, original) || !result.success || result.data.goal !== "INTRODUCTION"
    || result.data.confidence < .9 || !result.data.name || !message.includes(result.data.name) || !message.includes(result.data.evidence)) return undefined;
  return { ...original, intent: "PRODUCT_DISCOVERY" as const, factRead: null, productContinuation: null,
    referenceReadFields: null, queryBasis: null,
    productQuery: { scope: "IDENTITY" as const, entityText: result.data.name, granularity: "PRODUCT" as const, evidence: result.data.evidence } };
}

export async function reviewProductIntroduction(model: LanguageModel, message: string, original: DomainTurnSemantic, abortSignal: AbortSignal) {
  const result = await generateObject({ model, output: "no-schema", maxRetries: 0, abortSignal,
    ...languageModelSamplingOptions("SEMANTIC_QUERY"),
    system: `只核验用户是否在认识/介绍一个产品名称，而非核对具体构造、某条数值或比较。输出JSON：${JSON.stringify(z.toJSONSchema(schema))}。INTRODUCTION时name和evidence逐字摘取当前原话，保留名称中的型号/括号说明，不补正式身份、数值、资料或别名。不清楚或不是产品介绍用UNCHANGED。不能为执行而提高置信度。`,
    prompt: JSON.stringify({ message, readGoal: original.readGoal, factRead: original.factRead }) });
  return bindProductIntroduction(message, original, result.object);
}

import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { domainTurnSemanticSchema, type DomainTurnSemantic } from "./ai-domain-semantic.js";
import { languageModelSamplingOptions } from "../ai-config/ai-task-runtime-policy.js";

const legacyGoalSchema = z.object({
  intent: z.enum(["SOLUTION_ACTION", "REFERENCE_DETAIL", "CLARIFY"]), confidence: z.number().min(0).max(1), evidence: z.string().min(1),
  readFields: domainTurnSemanticSchema.shape.referenceReadFields,
  effectRequest: domainTurnSemanticSchema.shape.effectRequest,
  scope: z.enum(["LAST_VISIBLE_CANDIDATES", "CURRENT_SELECTED", "NONE"]),
  operation: domainTurnSemanticSchema.shape.solutionOperation,
  unresolved: z.null()
}).strict();

/** 新窄合同只提交操作授权；读取字段与引用范围由Backend保留，不让模型重复重建业务状态。 */
export const operationAuthorizationSchema = z.object({
  intent: z.enum(["SOLUTION_ACTION", "READ_ONLY", "CLARIFY"]),
  operation: z.enum(["SELECT", "ADD", "REMOVE", "SET_FINAL", "COMPARE_SELECTED", "KEEP_CONFLICT", "REMOVE_CONFLICT"]).nullable(),
  confidence: z.number().min(0).max(1), evidence: z.string().min(1).max(2000),
  effectRequest: domainTurnSemanticSchema.shape.effectRequest
}).strict();
export const operationAuthorizationPrompt = `只判断完整本轮原话是否直接肯定要求一个方案操作。只做操作授权分类，不解释参数、不识别读取字段、不判断候选身份、工程条件、资料或执行可用性；这些由独立的Backend合同完成。confidence仅表示动作类型和整句直接授权的把握，不含其他目标的不确定；动作自身不明仍应CLARIFY或低置信度，不能为了执行提高confidence。多个诉求逐项理解，后面的解释或改写要求不能擦掉前面的直接操作请求。仅解释、否定、假设、引用或显示按钮不是选择授权，用READ_ONLY、operation=null、effectRequest=null。必须保留完整原话的否定、引用、限定和直接请求，effectRequest.evidence必须逐字保留完整本轮原话，且等于本轮整个消息，不能只摘取局部肯定句。SELECT表示选用当前方案，ADD追加，REMOVE移除；SET_FINAL只用于明确指定最终方案，不能确认快照或生成报告。不生成或补充任何正式身份、读取字段、范围、工程数值。仅输出JSON：${JSON.stringify(z.toJSONSchema(operationAuthorizationSchema))}`;
export type SolutionGoalContext = { visibleCandidateCount: number; focusedCandidateCount: number; selectedCandidateCount: number; hasReadOnlyExcludedRecords: boolean };
export async function reviewSolutionGoal(model: LanguageModel, message: string, abortSignal: AbortSignal, candidateContext?: SolutionGoalContext,
  knownReadFields?: DomainTurnSemantic["referenceReadFields"], knownScope?: DomainTurnSemantic["reference"]["scope"]) {
  const result = await generateObject({ model, output: "no-schema", system: operationAuthorizationPrompt,
    prompt: JSON.stringify({ message, candidateContext }), ...languageModelSamplingOptions("SEMANTIC_QUERY"), maxRetries: 0, abortSignal });
  const parsed = operationAuthorizationSchema.safeParse(result.object);
  // 兼容既有窄合同输出；不接受额外身份/参数字段，也不从旧输出覆盖Backend已有范围。
  const legacy = parsed.success ? undefined : legacyGoalSchema.parse(result.object);
  const goal = parsed.success ? parsed.data : legacy!;
  const intent = goal.intent === "READ_ONLY" ? "REFERENCE_DETAIL" : goal.intent;
  const semantic = domainTurnSemanticSchema.parse({
    intent, solutionOperation: intent === "SOLUTION_ACTION" ? goal.operation : null,
    referenceReadFields: knownReadFields?.length ? knownReadFields : legacy?.readFields ?? null,
    confidence: goal.confidence, evidence: goal.evidence, unresolved: null,
    relation: "CONTINUE", comparison: null, referenceTime: "CURRENT", adviceMode: null, constraintPatch: [],
    reference: { scope: knownScope ?? legacy?.scope ?? "LAST_VISIBLE_CANDIDATES", revision: null, items: [] },
    requestedEffect: intent === "SOLUTION_ACTION" ? "STATE_MUTATION" : "READ_ONLY",
    effectRequest: intent === "SOLUTION_ACTION" ? goal.effectRequest : null, ambiguity: []
  });
  return { ...result, object: semantic };
}

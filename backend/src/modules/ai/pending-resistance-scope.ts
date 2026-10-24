import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { domainTurnSemanticSchema } from "./ai-domain-semantic.js";
import type { QueryClarification } from "./query-need.js";
import { isUnscopedResistanceField } from "./query-clarification-context.js";
import { describeNumberRoles } from "../thermal/semantic-query.js";
import { inferThermalLookupMode } from "../thermal/thermal-lookup-mode.js";
import { languageModelSamplingOptions } from "../ai-config/ai-task-runtime-policy.js";

const schema = z.object({ reply: z.enum(["SCOPE", "OTHER"]), metric: z.enum(["PRODUCT_R", "TOTAL_R"]).nullable(),
  originalConditionsCovered: z.boolean(), confidence: z.number().min(0).max(1), evidence: z.string().min(1).max(2000) }).strict();
const targets = (text: string) => describeNumberRoles(text).filter(number => number.role === "UNKNOWN" || number.role === "THERMAL_TARGET");

/** 仅恢复服务端已经核验的紧邻、新查询澄清状态；不是从历史任意寻找一个数字。 */
export function canReviewPendingResistanceScope(message: string, pending: QueryClarification) {
  const need = pending.need;
  // goal是可选的展示对象分类，不是指标证据；已明确R家族时，不能因缺这个分类重新询问λ/K/R。
  return !!need && !pending.inheritPrevious && isUnscopedResistanceField(need.turns.at(-1)?.message ?? "")
    && targets(pending.message).length === 1 && !describeNumberRoles(message).length
    && !need.identityHints.length && !(need.pageQuery?.constraints.some(constraint => constraint.type === "METRIC"))
    && (need.pageQuery?.unresolved.every(item => item.field === "metric") ?? true);
}

/** 模型只提交口径变更；唯一原数值、比较符、已有条件和来源范围由Backend保留。 */
export function bindPendingResistanceScope(message: string, pending: QueryClarification, raw: unknown, contractVersion: 1 | 2 = 1) {
  const parsed = schema.safeParse(raw);
  if (!canReviewPendingResistanceScope(message, pending) || !parsed.success || parsed.data.reply !== "SCOPE"
    || !parsed.data.metric || !parsed.data.originalConditionsCovered || parsed.data.confidence < .9
    || parsed.data.evidence !== message) return undefined;
  const { metric, confidence } = parsed.data, old = pending.need!.pageQuery;
  const semantic = domainTurnSemanticSchema.parse({ intent: "REFERENCE_QUERY", relation: "CONTINUE", queryContext: "CLARIFICATION_REPLY",
    readGoal: pending.need!.goal, requestedEffect: "QUERY", effectRequest: null, confidence, evidence: message,
    unresolved: null, comparison: null, referenceTime: null, adviceMode: null, constraintPatch: [], ambiguity: [],
    reference: { scope: "NONE", revision: null, items: [] },
    pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence, sourceScope: old?.sourceScope ?? null,
      preferences: old?.preferences ?? [], unresolved: [], readFields: [metric === "PRODUCT_R" ? "productThermalResistance" : "totalThermalResistance"],
      constraints: [...(old?.constraints ?? []), { type: "METRIC", field: null, entityText: null, resolvedText: null, metric,
        value: Number(targets(pending.message)[0]!.raw), operator: inferThermalLookupMode(pending.message, contractVersion) ?? "APPROX",
        operation: "SET", evidence: pending.message, hard: true, confidence }] }
  });
  return { semantic, review: parsed.data };
}

export async function reviewPendingResistanceScope(model: LanguageModel, message: string, pending: QueryClarification, abortSignal: AbortSignal, contractVersion: 1 | 2 = 1) {
  const result = await generateObject({ model, output: "no-schema", maxRetries: 0, abortSignal,
    ...languageModelSamplingOptions("SEMANTIC_QUERY"),
    system: `当前是服务端已保存的新查询，只剩热阻口径需要补齐。原目标、数值、比较符及条件在savedConditions中，模型不重新构造查询，也不要求用户重复数字。仅理解当前完整回复是否补充口径：产品整体或保温产品自身这一层用PRODUCT_R；整面墙、屋面等完整构造用TOTAL_R；仅芯材、具体材料子层或仍无法区分时OTHER。如果当前回复同时修改数值、换具体产品、新开问题或执行方案/报告操作，也用OTHER；新增或改变口径以外的筛选条件（如对象或资料范围）也属于OTHER。只补口径不属于这些情况。originalConditionsCovered核对原问的具体产品、材料名称、体系、部位、来源、厚度条件是否都被savedConditions保留；未识别的名称也是具体条件，不能当成泛指。原问只有泛指材料或板材及已保存数值时为true，存在遗漏的具体条件必须false。evidence必须为完整当前回复。不输出或补充数值、ID、别名、计算、授权，不为执行提高置信度。只输出JSON：${JSON.stringify(z.toJSONSchema(schema))}。`,
    prompt: JSON.stringify({ message, original: pending.message, pendingQuestion: pending.question,
      savedConditions: { goal: pending.need?.goal, targetValue: Number(targets(pending.message)[0]!.raw),
        comparison: inferThermalLookupMode(pending.message, contractVersion) ?? "APPROX", conditions: pending.need?.pageQuery?.constraints ?? [],
        sourceScope: pending.need?.pageQuery?.sourceScope ?? null } }) });
  return bindPendingResistanceScope(message, pending, result.object, contractVersion);
}

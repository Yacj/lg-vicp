import { domainDecision, type DomainTurnDecision } from "./ai-domain-turn-decision.js";
import type { DomainTurnSemantic } from "./ai-domain-semantic.js";
import type { ConversationTaskState } from "./conversation-task.js";
import { parseThermalThicknessMessage } from "../thermal/thermal-lookup-thickness.js";
import { parseThermalLookupMessage } from "../thermal/thermal-lookup-mode.js";
import { candidateReferenceSchema, referenceEvidenceMatches } from "./solution-action-semantic.js";
import { customerDomainClarification } from "./domain-clarification.js";
/** 字符包含只校验原话证据，不判定意图。SM-EVIDENCE-01 */
export const hasVerbatimEvidence = (message: string, evidence: string) => evidence.trim().length > 0 && message.includes(evidence);
export function targetedDomainFallback(state?: ConversationTaskState | null, source: "LLM" | "UNAVAILABLE" = "LLM", reason = "SEMANTIC_UNRESOLVED"): DomainTurnDecision {
  return { ...domainDecision("CLARIFY", ""), parserSource: source, policyReason: reason, unresolved: [state?.pendingAdviceGoal
    ? "请明确继续当前参考建议，或指定要查看的候选参数。"
    : state?.lastReferenceLookup?.candidates.length && state.adviceBusinessContext?.candidateScopeActive !== false
      ? "请明确要查看当前候选的哪些参数，或说明新的查询目标。"
      : "这轮请求暂未能可靠理解，请补充要查询的产品、参数或参考构造；已明确的指标无需重复说明。"] };
}
const effectForIntent: Partial<Record<DomainTurnSemantic["intent"], DomainTurnSemantic["requestedEffect"]>> = { SOLUTION_ACTION: "STATE_MUTATION", REPORT_REQUEST: "REPORT_GENERATION", THERMAL_CALCULATE: "CALCULATE", REFERENCE_QUERY: "QUERY", REFERENCE_REFINE: "QUERY" };
/** 模型仅提案；正式写入仍经原状态机。 */
export function applyDomainPolicy(message: string, semantic: DomainTurnSemantic, state?: ConversationTaskState | null,
  readContext?: { productQuery?: DomainTurnSemantic["productQuery"] }): DomainTurnDecision {
  const reject = (reason: string) => {
    const result = targetedDomainFallback(state, "LLM", reason);
    if (reason === "EFFECT_NOT_AUTHORIZED") {
      const operation = { QUERY: "查询条件更新", STATE_MUTATION: "方案操作", REPORT_GENERATION: "正式报告生成", CALCULATE: "正式计算", READ_ONLY: "只读查看" }[semantic.requestedEffect];
      result.unresolved = [`本轮${operation}尚未可靠确认，请明确要执行的一项操作；也可以通过对应按钮继续。`];
    }
    if (reason === "REFERENCE_EVIDENCE_INVALID") result.unresolved = ["候选引用未能对应当前序号、构造编号或厚度，请明确当前候选后重试。"];
    if (reason === "FACT_READ_INVALID") result.unresolved = ["尚未可靠定位要核对的构造、厚度或指标，请指定对应原页；核对数字不会确认正式方案。"];
    if (reason === "PARAMETER_QUERY_INVALID") result.unresolved = ["产品或材料参数的读取目标尚未可靠确认，请核对参数名称、数值或单位。"];
    const singleConstraint = semantic.pageQuery?.constraints;
    if (reason === "QUERY_NOT_UNDERSTOOD" && singleConstraint?.length === 1) {
      const metric = singleConstraint[0]!;
      if (metric.type === "METRIC" && metric.value != null && metric.metric) {
        const label = metric.metric === "PRODUCT_R" ? "产品层热阻 R" : metric.metric === "TOTAL_R" ? "整构造总热阻 R₀" : "传热系数 K";
        result.unresolved = [`你说的“${metric.evidence}”我理解为${label}=${metric.value}；如果口径不对，请说明是产品层、芯材还是整构造。`];
      }
    }
    if (reason === "SEMANTIC_AMBIGUOUS" || reason === "QUERY_CONTEXT_INVALID" || reason === "PRODUCT_SCOPE_INVALID")
      result.unresolved = [customerDomainClarification(semantic, message)];
    return { ...result, semantic };
  };
  const productContext = semantic.relation === "CONTINUE" && semantic.requestedEffect === "READ_ONLY"
    && semantic.reference.scope === "NONE" && !semantic.reference.items.length && !semantic.constraintPatch.length
    && !semantic.effectRequest && !!readContext?.productQuery && !!semantic.productQuery
    && readContext.productQuery.scope === semantic.productQuery.scope && readContext.productQuery.entityText === semantic.productQuery.entityText
    && readContext.productQuery.granularity === semantic.productQuery.granularity;
  if (semantic.productContinuation && (!readContext?.productQuery || semantic.relation !== "CONTINUE"
    || semantic.intent !== "PRODUCT_DETAIL" && semantic.intent !== "PRODUCT_DISCOVERY"
    || semantic.requestedEffect !== "READ_ONLY" || !hasVerbatimEvidence(message, semantic.productContinuation.evidence)
    || semantic.pageQuery || semantic.parameterQuery || semantic.effectRequest || semantic.complianceCheck?.required
    || semantic.reference.scope !== "NONE" || semantic.reference.items.length || semantic.constraintPatch.length))
    return reject("PRODUCT_SCOPE_INVALID");
  if (semantic.calculationRequest && (semantic.intent !== "THERMAL_CALCULATE" || semantic.requestedEffect !== "CALCULATE"
    || !hasVerbatimEvidence(message, semantic.calculationRequest.evidence)
    || semantic.calculationRequest.thicknessMm != null && (!semantic.calculationRequest.thicknessEvidence
      || !hasVerbatimEvidence(message, semantic.calculationRequest.thicknessEvidence)
      || parseThermalThicknessMessage(semantic.calculationRequest.thicknessEvidence).query.thicknessMm !== semantic.calculationRequest.thicknessMm)))
    return reject("CALCULATION_INPUT_INVALID");
  if (semantic.calculationRead && (semantic.requestedEffect !== "READ_ONLY" || semantic.intent !== "REFERENCE_DETAIL" && semantic.intent !== "KNOWLEDGE_EXPLAIN"
    || semantic.relation !== "CONTINUE" || semantic.confidence < .8 || !hasVerbatimEvidence(message, semantic.calculationRead.evidence)
    || semantic.calculationRequest || semantic.pageQuery || semantic.effectRequest || semantic.complianceCheck?.required)) return reject("CALCULATION_INPUT_INVALID");
  if (semantic.parameterExplanation && (semantic.intent !== "KNOWLEDGE_EXPLAIN" || semantic.requestedEffect !== "READ_ONLY"
    || semantic.relation !== "CONTINUE" || semantic.queryContext !== "CURRENT_TURN" || semantic.confidence < .8
    || !hasVerbatimEvidence(message, semantic.parameterExplanation.evidence) || semantic.parameterQuery || semantic.productQuery
    || semantic.pageQuery || semantic.factRead || semantic.constraintPatch.length || semantic.reference.items.length
    || semantic.reference.scope !== "NONE" || semantic.reference.revision != null || semantic.effectRequest || semantic.complianceCheck?.required))
    return reject("PARAMETER_CONTEXT_INVALID");
  if (semantic.complianceExplanation && (semantic.intent !== "KNOWLEDGE_EXPLAIN" || semantic.requestedEffect !== "READ_ONLY"
    || semantic.relation !== "CONTINUE" || semantic.queryContext !== "CURRENT_TURN" || semantic.confidence < .8
    || !hasVerbatimEvidence(message, semantic.complianceExplanation.evidence) || semantic.parameterExplanation || semantic.calculationRead
    || semantic.calculationRequest || semantic.parameterQuery || semantic.productQuery || semantic.productContinuation || semantic.pageQuery
    || semantic.factRead || semantic.constraintPatch.length || semantic.reference.items.length || semantic.reference.scope !== "NONE"
    || semantic.reference.revision != null || semantic.effectRequest || semantic.complianceCheck?.required)) return reject("COMPLIANCE_CONTEXT_INVALID");
  if (semantic.solutionOperation && (semantic.intent !== "SOLUTION_ACTION" || semantic.requestedEffect !== "STATE_MUTATION")) return reject("EFFECT_INTENT_MISMATCH");
  if (semantic.pageQuery && semantic.intent !== "REFERENCE_QUERY" && semantic.intent !== "REFERENCE_REFINE") return reject("PAGE_QUERY_SCOPE_INVALID");
  if (semantic.queryBasis && (!semantic.pageQuery || semantic.intent !== "REFERENCE_REFINE" || semantic.relation !== "CONTINUE" && semantic.relation !== "REFINE"
    || semantic.requestedEffect !== "QUERY" || !hasVerbatimEvidence(message, semantic.queryBasis.evidence))) return reject("QUERY_CONTEXT_INVALID");
  if (semantic.referenceReadFields?.length && !(semantic.intent === "SOLUTION_ACTION" && semantic.requestedEffect === "STATE_MUTATION")
    && (semantic.intent !== "REFERENCE_VIEW" && semantic.intent !== "REFERENCE_DETAIL" && semantic.intent !== "SOLUTION_ADVICE" && semantic.intent !== "COMPARE_CANDIDATES" && semantic.intent !== "KNOWLEDGE_EXPLAIN"
      || semantic.requestedEffect !== "READ_ONLY")
    && !((semantic.intent === "PRODUCT_DETAIL" || semantic.intent === "PRODUCT_DISCOVERY") && semantic.requestedEffect === "READ_ONLY"
      && semantic.productQuery && semantic.referenceReadFields.every(field => field === "originalPage"))) return reject("PAGE_QUERY_SCOPE_INVALID");
  if (semantic.productQuery && (semantic.intent !== "PRODUCT_DISCOVERY" && semantic.intent !== "PRODUCT_DETAIL" && semantic.intent !== "MATERIAL_COMPARE" && semantic.intent !== "CLARIFY"
    || !hasVerbatimEvidence(message, semantic.productQuery.evidence)
    || semantic.productQuery.scope !== "CATALOG" && (!semantic.productQuery.entityText || !hasVerbatimEvidence(message, semantic.productQuery.entityText) && !productContext)
    || semantic.productQuery.scope === "CATALOG" && semantic.productQuery.entityText != null)) return reject("PRODUCT_SCOPE_INVALID");
  if (semantic.pageQuery && semantic.pageQuery.intent !== "REFERENCE_LOOKUP") return reject("PAGE_QUERY_INTENT_MISMATCH");
  const parameterRead = semantic.intent === "PRODUCT_PARAMETER_QUERY" && semantic.requestedEffect === "READ_ONLY" && !!semantic.parameterQuery;
  if (semantic.parameterQuery && !parameterRead || semantic.intent === "PRODUCT_PARAMETER_QUERY" && (!parameterRead || semantic.confidence < .8
    || semantic.pageQuery || semantic.factRead || semantic.constraintPatch.length || semantic.reference.items.length
    || semantic.reference.scope !== "NONE" || semantic.reference.revision != null || semantic.complianceCheck?.required
    || semantic.effectRequest && (!semantic.effectRequest.direct || semantic.effectRequest.polarity !== "AFFIRMATIVE" || semantic.effectRequest.speechAct !== "REQUEST" || !hasVerbatimEvidence(message, semantic.effectRequest.evidence))))
    return reject("PARAMETER_QUERY_INVALID");
  if (semantic.queryContext === "CLARIFICATION_REPLY" && (!parameterRead && (semantic.requestedEffect !== "QUERY"
    || semantic.intent !== "REFERENCE_QUERY" && semantic.intent !== "REFERENCE_REFINE"
    || !semantic.pageQuery) || semantic.relation !== "CONTINUE" && semantic.relation !== "REFINE")) return reject("QUERY_CONTEXT_INVALID");
  if (semantic.queryContext === "PREVIOUS_PARAMETER" && (!parameterRead || semantic.relation !== "CONTINUE" && semantic.relation !== "REFINE"))
    return reject("QUERY_CONTEXT_INVALID");
  if (!hasVerbatimEvidence(message, semantic.evidence) || semantic.constraintPatch.some(patch => !hasVerbatimEvidence(message, patch.evidence))) return reject("EVIDENCE_INVALID");
  if (semantic.factRead && (!hasVerbatimEvidence(message, semantic.factRead.evidence) || semantic.requestedEffect !== "READ_ONLY"
    || semantic.intent !== "KNOWLEDGE_EXPLAIN" && semantic.intent !== "REFERENCE_DETAIL" || semantic.confidence < .8
    || (semantic.factRead.explanationAspect != null || semantic.factRead.definitionSubjects != null)
      && semantic.factRead.mode !== "DEFINE")) return reject("FACT_READ_INVALID");
  if (semantic.comparison && (semantic.intent !== "COMPARE_CANDIDATES" || !hasVerbatimEvidence(message, semantic.comparison.evidence))) return reject("EVIDENCE_INVALID");
  if (semantic.complianceCheck && !hasVerbatimEvidence(message, semantic.complianceCheck.evidence)) return reject("EVIDENCE_INVALID");
  if (semantic.reference.revision != null && semantic.reference.revision !== state?.lastReferenceLookup?.candidateQueryRevision) return reject("REVISION_CHANGED");
  const positionalReference = !semantic.factRead && !semantic.reference.items.length || semantic.reference.items.some(item => item.type === "POSITION");
  if (semantic.requestedEffect !== "QUERY" && (semantic.referenceTime === "EARLIER" || semantic.referenceTime === "UNCERTAIN")
    && (semantic.requestedEffect !== "READ_ONLY" || positionalReference)
    && (semantic.intent === "REFERENCE_VIEW" || semantic.intent === "REFERENCE_DETAIL" || semantic.intent === "COMPARE_CANDIDATES"
      || semantic.intent === "SOLUTION_ACTION" || semantic.intent === "THERMAL_CALCULATE" || semantic.intent === "SOLUTION_ADVICE"))
    return { ...reject("REFERENCE_TIME_UNRESOLVED"), unresolved: [state?.lastReferenceLookup?.candidates.length
      ? "这次引用可能指更新前的候选列表。请明确原构造编号或进入原消息查看，不能把旧序号套用到当前列表。"
      : "当前没有可定位的候选方案，请先查询或明确对应原页；本轮没有可用于核对的最终方案。"] };
  if (semantic.reference.items.some(item => { const parsed = candidateReferenceSchema.safeParse(item);
    return !hasVerbatimEvidence(message, item.evidence) || !parsed.success || !referenceEvidenceMatches(parsed.data)
      || item.type === "CANDIDATE_LABEL" && item.thicknessEvidence != null && !hasVerbatimEvidence(message, item.thicknessEvidence); })) return reject("REFERENCE_EVIDENCE_INVALID");
  if (semantic.unresolved || semantic.ambiguity.length) return reject("SEMANTIC_AMBIGUOUS");
  if (semantic.relation === "CANCEL") return { ...domainDecision("GENERAL", semantic.evidence), semantic, parserSource: "LLM", policyReason: "CANCEL_READ_ONLY" };
  const requiredEffect = effectForIntent[semantic.intent] ?? "READ_ONLY";
  const queryConfidence = Math.min(semantic.confidence, semantic.pageQuery?.confidence ?? semantic.confidence);
  if (semantic.requestedEffect !== requiredEffect) return reject("EFFECT_INTENT_MISMATCH");
  if (requiredEffect === "QUERY") {
    // QUERY仅允许更新会话查询结果；不构成正式方案、计算或报告授权。
    const request = semantic.effectRequest;
    if (queryConfidence < .8 || queryConfidence < .9 && !semantic.pageQuery || request && (!request.direct || request.polarity !== "AFFIRMATIVE"
      || request.speechAct !== "REQUEST" || !hasVerbatimEvidence(message, request.evidence))) return reject("QUERY_NOT_UNDERSTOOD");
  } else if (requiredEffect !== "READ_ONLY") {
    const request = semantic.effectRequest;
    if (semantic.confidence < .9 || !request?.direct || request.polarity !== "AFFIRMATIVE" || request.speechAct !== "REQUEST" || request.evidence !== message || !hasVerbatimEvidence(message, request.evidence)) return reject("EFFECT_NOT_AUTHORIZED");
  }
  if (semantic.constraintPatch.some(patch => patch.op === "EXCLUDE_FROM_THIS_ADVICE" && (semantic.intent !== "SOLUTION_ADVICE" || patch.field !== "region" && patch.field !== "buildingType"))) return reject("PATCH_SCOPE_INVALID");
  const previous = state?.lastReferenceLookup?.query ?? {};
  const thickness = parseThermalThicknessMessage(message, previous);
  const metrics = parseThermalLookupMessage(message);
  const queryPatches = semantic.constraintPatch.filter(patch => patch.op === "SET" || patch.op === "CLEAR");
  if (semantic.intent === "SOLUTION_ADVICE" && metrics.filters.length && !queryPatches.some(patch => patch.field === "metric"))
    return reject("QUERY_CONDITIONS_DROPPED");
  if (semantic.intent === "SOLUTION_ADVICE" && queryPatches.some(patch => patch.field === "region" || patch.field === "buildingType")) return reject("ADVICE_SCOPE_REQUIRES_EXCLUDE");
  for (const patch of queryPatches) {
    if ((patch.field === "thicknessMm" || patch.field === "thicknessMin" || patch.field === "thicknessMax")
      && (thickness.needsClarification || !thickness.changed || (patch.op === "CLEAR"
        ? !thickness.remove && thickness.query[patch.field] !== undefined
        : typeof patch.value !== "number" || thickness.query[patch.field] !== patch.value))) return reject("THICKNESS_EVIDENCE_INVALID");
    if (patch.field === "metric" && (patch.op === "CLEAR" ? !metrics.removedMetrics.length : !metrics.filters.length)) return reject("METRIC_EVIDENCE_INVALID");
  }
  const requiresCandidateQuery = semantic.intent === "SOLUTION_ADVICE" && queryPatches.some(patch => patch.field !== "thicknessMm" || patch.op === "CLEAR" || previous.thicknessMm !== patch.value);
  if (requiresCandidateQuery && semantic.reference.items.some(item => item.type === "POSITION")) return reject("NEW_QUERY_OLD_POSITION_AMBIGUOUS");
  if (requiresCandidateQuery && semantic.reference.scope === "CURRENT_SELECTED") return reject("NEW_QUERY_SELECTED_SCOPE_AMBIGUOUS");
  if (requiresCandidateQuery && semantic.confidence < .8) return reject("QUERY_PATCH_LOW_CONFIDENCE");
  const continued = semantic.continuedGoal;
  const recentGoals = state?.adviceBusinessContext?.recentGoals;
  const recovered = continued ? recentGoals?.[continued.recentTurn] : undefined;
  const restoreAdviceGoal = Boolean(continued && semantic.intent === "SOLUTION_ADVICE" && semantic.relation === "CONTINUE"
    && semantic.reference.scope === "LAST_VISIBLE_CANDIDATES" && semantic.confidence >= .9 && !requiresCandidateQuery
    && recovered?.intent === "GENERAL" && hasVerbatimEvidence(recovered.userGoal, continued.evidence)
    && continued.recentTurn === (recentGoals?.length ?? 0) - 1
    && recentGoals?.[0]?.intent === "REFERENCE_QUERY");
  if (continued && !restoreAdviceGoal) return reject("CONTINUED_GOAL_INVALID");
  return { ...domainDecision(semantic.intent, semantic.evidence), semantic, parserSource: "LLM", requiresCandidateQuery, restoreAdviceGoal,
    ...(requiredEffect === "QUERY" && queryConfidence < .9 ? { queryResultMode: "FACTS_ONLY" as const } : {}),
    referenceScope: semantic.reference.scope === "CURRENT_SELECTED" || semantic.reference.scope === "CURRENT_CONFIRMED" ? semantic.reference.scope : "LATEST_VISIBLE",
    policyReason: requiredEffect === "QUERY" ? queryConfidence < .9 ? "VERIFY_QUERY_FACTS_ONLY" : "READ_ONLY_QUERY" : requiredEffect === "READ_ONLY" ? "READ_ONLY_SEMANTIC" : "EXPLICIT_EFFECT_PROPOSAL" };
}

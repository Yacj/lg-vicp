import { domainDecision, type DomainTurnDecision } from "./ai-domain-turn-decision.js";
import type { DomainTurnSemantic } from "./ai-domain-semantic.js";
import type { ConversationTaskState } from "./conversation-task.js";
import { parseThermalThicknessMessage } from "../thermal/thermal-lookup-thickness.js";
import { parseThermalLookupMessage } from "../thermal/thermal-lookup-mode.js";
import { candidateReferenceSchema, referenceEvidenceMatches } from "./solution-action-semantic.js";
/** 字符包含只校验原话证据，不判定意图。SM-EVIDENCE-01 */
export const hasVerbatimEvidence = (message: string, evidence: string) => evidence.trim().length > 0 && message.includes(evidence);
export function targetedDomainFallback(state?: ConversationTaskState | null, source: "LLM" | "UNAVAILABLE" = "LLM", reason = "SEMANTIC_UNRESOLVED"): DomainTurnDecision {
  return { ...domainDecision("CLARIFY", ""), parserSource: source, policyReason: reason, unresolved: [state?.pendingAdviceGoal
    ? "当前参考选型可以按实际基层匹配已有构造，暂不包含地区合规结论。请明确继续该参考建议，或指定要查看的候选参数。"
    : state?.lastReferenceLookup?.candidates.length && state.adviceBusinessContext?.candidateScopeActive !== false
      ? "你希望按现有候选分别给出参考选型，还是已确定某一种实际基层？"
      : "请指定这轮要讨论的保温体系或实际基层；可以先整理参考选型框架。"] };
}
const effectForIntent: Partial<Record<DomainTurnSemantic["intent"], DomainTurnSemantic["requestedEffect"]>> = { SOLUTION_ACTION: "STATE_MUTATION", REPORT_REQUEST: "REPORT_GENERATION", THERMAL_CALCULATE: "CALCULATE", REFERENCE_QUERY: "QUERY", REFERENCE_REFINE: "QUERY" };
/** 模型仅提案；正式写入仍经原状态机。 */
export function applyDomainPolicy(message: string, semantic: DomainTurnSemantic, state?: ConversationTaskState | null): DomainTurnDecision {
  const reject = (reason: string) => {
    const result = targetedDomainFallback(state, "LLM", reason);
    if (reason === "EFFECT_NOT_AUTHORIZED") {
      const operation = { QUERY: "查询条件更新", STATE_MUTATION: "方案操作", REPORT_GENERATION: "正式报告生成", CALCULATE: "正式计算", READ_ONLY: "只读查看" }[semantic.requestedEffect];
      result.unresolved = [`本轮${operation}尚未可靠确认，请明确要执行的一项操作；也可以通过对应按钮继续。`];
    }
    if (reason === "REFERENCE_EVIDENCE_INVALID") result.unresolved = ["候选引用未能对应当前序号、构造编号或厚度，请明确当前候选后重试。"];
    if (reason === "FACT_READ_INVALID") result.unresolved = ["尚未可靠定位要核对的构造、厚度或指标，请指定对应原页；核对数字不会确认正式方案。"];
    return { ...result, semantic };
  };
  if (semantic.pageQuery && semantic.intent !== "REFERENCE_QUERY" && semantic.intent !== "REFERENCE_REFINE") return reject("PAGE_QUERY_SCOPE_INVALID");
  if (semantic.pageQuery && semantic.pageQuery.intent !== "REFERENCE_LOOKUP") return reject("PAGE_QUERY_INTENT_MISMATCH");
  if (semantic.queryContext === "CLARIFICATION_REPLY" && (semantic.requestedEffect !== "QUERY"
    || semantic.intent !== "REFERENCE_QUERY" && semantic.intent !== "REFERENCE_REFINE"
    || semantic.relation !== "CONTINUE" && semantic.relation !== "REFINE" || !semantic.pageQuery)) return reject("QUERY_CONTEXT_INVALID");
  if (!hasVerbatimEvidence(message, semantic.evidence) || semantic.constraintPatch.some(patch => !hasVerbatimEvidence(message, patch.evidence))) return reject("EVIDENCE_INVALID");
  if (semantic.factRead && (!hasVerbatimEvidence(message, semantic.factRead.evidence) || semantic.requestedEffect !== "READ_ONLY"
    || semantic.intent !== "KNOWLEDGE_EXPLAIN" && semantic.intent !== "REFERENCE_DETAIL" || semantic.confidence < .8)) return reject("FACT_READ_INVALID");
  if (semantic.comparison && (semantic.intent !== "COMPARE_CANDIDATES" || !hasVerbatimEvidence(message, semantic.comparison.evidence))) return reject("EVIDENCE_INVALID");
  if (semantic.complianceCheck && !hasVerbatimEvidence(message, semantic.complianceCheck.evidence)) return reject("EVIDENCE_INVALID");
  if (semantic.reference.revision != null && semantic.reference.revision !== state?.lastReferenceLookup?.candidateQueryRevision) return reject("REVISION_CHANGED");
  const positionalReference = !semantic.factRead && !semantic.reference.items.length || semantic.reference.items.some(item => item.type === "POSITION");
  if (semantic.requestedEffect !== "QUERY" && (semantic.referenceTime === "EARLIER" || semantic.referenceTime === "UNCERTAIN")
    && (semantic.requestedEffect !== "READ_ONLY" || positionalReference)
    && (semantic.intent === "REFERENCE_VIEW" || semantic.intent === "REFERENCE_DETAIL" || semantic.intent === "COMPARE_CANDIDATES"
      || semantic.intent === "SOLUTION_ACTION" || semantic.intent === "THERMAL_CALCULATE" || semantic.intent === "SOLUTION_ADVICE"))
    return { ...reject("REFERENCE_TIME_UNRESOLVED"), unresolved: ["这次引用可能指更新前的候选列表。请明确原构造编号或进入原消息查看，不能把旧序号套用到当前列表。"] };
  if (semantic.reference.items.some(item => { const parsed = candidateReferenceSchema.safeParse(item);
    return !hasVerbatimEvidence(message, item.evidence) || !parsed.success || !referenceEvidenceMatches(parsed.data); })) return reject("REFERENCE_EVIDENCE_INVALID");
  if (semantic.unresolved || semantic.ambiguity.length) return { ...reject("SEMANTIC_AMBIGUOUS"), unresolved: [semantic.unresolved ?? semantic.ambiguity[0]!] };
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

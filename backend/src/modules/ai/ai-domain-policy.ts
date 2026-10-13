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
  const reject = (reason: string) => targetedDomainFallback(state, "LLM", reason);
  if (!hasVerbatimEvidence(message, semantic.evidence) || semantic.constraintPatch.some(patch => !hasVerbatimEvidence(message, patch.evidence))) return reject("EVIDENCE_INVALID");
  if (semantic.reference.revision != null && semantic.reference.revision !== state?.lastReferenceLookup?.candidateQueryRevision) return reject("REVISION_CHANGED");
  if (semantic.reference.items.some(item => { const parsed = candidateReferenceSchema.safeParse(item);
    return !hasVerbatimEvidence(message, item.evidence) || !parsed.success || !referenceEvidenceMatches(parsed.data); })) return reject("REFERENCE_EVIDENCE_INVALID");
  if (semantic.unresolved || semantic.ambiguity.length) return { ...reject("SEMANTIC_AMBIGUOUS"), unresolved: [semantic.unresolved ?? semantic.ambiguity[0]!] };
  if (semantic.relation === "CANCEL") return { ...domainDecision("GENERAL", semantic.evidence), semantic, parserSource: "LLM", policyReason: "CANCEL_READ_ONLY" };
  const requiredEffect = effectForIntent[semantic.intent] ?? "READ_ONLY";
  if (semantic.requestedEffect !== requiredEffect) return reject("EFFECT_INTENT_MISMATCH");
  if (requiredEffect !== "READ_ONLY") {
    const request = semantic.effectRequest;
    if (semantic.confidence < .9 || !request?.direct || request.polarity !== "AFFIRMATIVE" || request.speechAct !== "REQUEST" || request.evidence !== message || !hasVerbatimEvidence(message, request.evidence)) return reject("EFFECT_NOT_AUTHORIZED");
  }
  if (semantic.constraintPatch.some(patch => patch.op === "EXCLUDE_FROM_THIS_ADVICE" && (semantic.intent !== "SOLUTION_ADVICE" || patch.field !== "region" && patch.field !== "buildingType"))) return reject("PATCH_SCOPE_INVALID");
  const previous = state?.lastReferenceLookup?.query ?? {};
  const thickness = parseThermalThicknessMessage(message, previous);
  const metrics = parseThermalLookupMessage(message);
  const queryPatches = semantic.constraintPatch.filter(patch => patch.op === "SET" || patch.op === "CLEAR");
  if (semantic.intent === "SOLUTION_ADVICE" && queryPatches.some(patch => patch.field === "region" || patch.field === "buildingType")) return reject("ADVICE_SCOPE_REQUIRES_EXCLUDE");
  for (const patch of queryPatches) {
    if (patch.field === "thicknessMm" && (patch.op === "CLEAR" ? !thickness.remove : typeof patch.value !== "number" || thickness.query.thicknessMm !== patch.value)) return reject("THICKNESS_EVIDENCE_INVALID");
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
    referenceScope: semantic.reference.scope === "CURRENT_SELECTED" ? "CURRENT_SELECTED" : "LATEST_VISIBLE",
    policyReason: requiredEffect === "READ_ONLY" ? "READ_ONLY_SEMANTIC" : "EXPLICIT_EFFECT_PROPOSAL" };
}

import type { DomainTurnSemantic } from "./ai-domain-semantic.js";
/** 受控模型fixture，只构造显式给定的语义，不识别自然语言。 */
export function domainSemanticFixture(message: string, intent: DomainTurnSemantic["intent"], patch: Partial<DomainTurnSemantic> = {}): DomainTurnSemantic {
  const effects: Partial<Record<DomainTurnSemantic["intent"], DomainTurnSemantic["requestedEffect"]>> = {
    REFERENCE_QUERY: "QUERY", REFERENCE_REFINE: "QUERY", SOLUTION_ACTION: "STATE_MUTATION", REPORT_REQUEST: "REPORT_GENERATION", THERMAL_CALCULATE: "CALCULATE" };
  const requestedEffect = effects[intent] ?? "READ_ONLY";
  return { intent, reportType: null, confidence: .99, evidence: message, unresolved: null, relation: "CONTINUE", continuedGoal: null, adviceMode: intent === "SOLUTION_ADVICE" ? "GENERAL_REFERENCE" : null,
    constraintPatch: [], reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: null, items: [] }, requestedEffect,
    effectRequest: requestedEffect === "READ_ONLY" ? null : { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: message }, ambiguity: [], ...patch };
}

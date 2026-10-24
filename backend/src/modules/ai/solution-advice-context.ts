import { z } from "zod";
import type { ConversationTaskState } from "./conversation-task.js";
import { isClosedGreeting, type DomainTurnDecision } from "./ai-domain-turn-decision.js";

const scope = { conversationId: z.string().min(1), projectId: z.string().nullable(),
  candidateQueryRevision: z.number().int().positive().optional(), createdAt: z.iso.datetime() };
export const adviceBusinessContextSchema = z.object({ ...scope, candidateScopeActive: z.boolean(),
  recentGoals: z.array(z.object({ intent: z.string().max(64), userGoal: z.string().max(300), assistantQuestion: z.string().max(300).optional() })).max(2) });
export const pendingAdviceGoalSchema = z.object({ ...scope, candidateQueryRevision: z.number().int().positive(),
  validUntil: z.iso.datetime(), kind: z.literal("REFERENCE_SELECTION"), generic: z.boolean(),
  goal: z.literal("PRELIMINARY_ADVICE").default("PRELIMINARY_ADVICE"),
  requestedMode: z.enum(["GENERAL_REFERENCE", "PRELIMINARY", "PROJECT_SPECIFIC", "OUTLINE"]).default("GENERAL_REFERENCE"),
  pendingQuestion: z.enum(["REGION", "BUILDING_TYPE", "SUBSTRATE"]).nullable().default(null),
  excludedAssessments: z.array(z.enum(["REGIONAL_COMPLIANCE", "BUILDING_TYPE_COMPLIANCE"])).default([]) });
export type AdviceBusinessContext = z.infer<typeof adviceBusinessContextSchema>;
export type PendingAdviceGoal = z.infer<typeof pendingAdviceGoalSchema>;
const TTL = 24 * 3600_000;
const isAcknowledgement = isClosedGreeting;
function continuesReferenceExplanation(state: ConversationTaskState, decision?: DomainTurnDecision) {
  return decision?.intent === "KNOWLEDGE_EXPLAIN" && decision.mutation === "NONE" && decision.semantic?.relation === "CONTINUE"
    && decision.semantic.reference.scope !== "NONE"
    && decision.referenceFocusIds?.some(id => state.lastReferenceLookup?.candidates.some(candidate => candidate.id === id));
}

/** 新话题即刻中断建议作用域；后续回答失败也不能恢复旧候选目标。 */
export function invalidateAdviceOnTopicChange(state: ConversationTaskState, intent: string | undefined, message: string, decision?: DomainTurnDecision): ConversationTaskState {
  const relation = decision?.semantic?.relation;
  if (state.adviceBusinessContext && (relation === "CANCEL" || relation === "SWITCH_TOPIC" || intent === "SOLUTION_ACTION"
    || intent === "SOLUTION_ADVICE" && decision?.semantic?.reference.scope === "NONE"))
    return { ...state, pendingAdviceGoal: undefined, adviceBusinessContext: { ...state.adviceBusinessContext, candidateScopeActive: false } };
  if (continuesReferenceExplanation(state, decision)) return state;
  if (!state.adviceBusinessContext || isAcknowledgement(message)
    || !["GENERAL", "PRODUCT_DISCOVERY", "PRODUCT_DETAIL", "MATERIAL_COMPARE", "KNOWLEDGE_EXPLAIN", "REPORT_REQUEST", "REFERENCE_QUERY", "REFERENCE_REFINE", "THERMAL_CALCULATE"].includes(intent ?? "")) return state;
  return { ...state, pendingAdviceGoal: undefined, adviceBusinessContext: { ...state.adviceBusinessContext, candidateScopeActive: false } };
}

export function adviceContextIsCurrent(context: AdviceBusinessContext | PendingAdviceGoal | undefined, conversation: { id: string; projectId: string | null }, state?: ConversationTaskState | null, now = Date.now()) {
  const created = Date.parse(context?.createdAt ?? "");
  return Boolean(context && context.conversationId === conversation.id && context.projectId === conversation.projectId
    && Number.isFinite(created) && created <= now + 60_000 && now - created <= TTL
    && context.candidateQueryRevision === state?.lastReferenceLookup?.candidateQueryRevision);
}
export function currentPendingAdviceGoal(state: ConversationTaskState | null | undefined, conversation: { id: string; projectId: string | null }, now = Date.now()) {
  const goal = state?.pendingAdviceGoal;
  return goal && state?.adviceBusinessContext?.candidateScopeActive !== false && adviceContextIsCurrent(goal, conversation, state, now) && Date.parse(goal.validUntil) > now
    && Date.parse(goal.validUntil) <= Date.parse(goal.createdAt) + TTL ? goal : undefined;
}

/** 仅维护业务目标，不改变候选、正式筛选条件或SolutionState。 */
export function advanceAdviceBusinessContext(state: ConversationTaskState, conversation: { id: string; projectId: string | null },
  intent: string, userGoal: string, assistantAnswer: string, now = Date.now(), verifiedAdvice = false, decision?: DomainTurnDecision): ConversationTaskState {
  const previous = adviceContextIsCurrent(state.adviceBusinessContext, conversation, state, now) ? state.adviceBusinessContext : undefined;
  const referenceTurn = ["REFERENCE_QUERY", "REFERENCE_REFINE", "REFERENCE_VIEW", "REFERENCE_DETAIL", "COMPARE_CANDIDATES", "THERMAL_CALCULATE", "COMPLIANCE_CHECK"].includes(intent)
    || continuesReferenceExplanation(state, decision);
  const adviceTurn = intent === "SOLUTION_ADVICE";
  const acknowledgement = isAcknowledgement(userGoal);
  const candidateScopeActive = referenceTurn || adviceTurn && verifiedAdvice || acknowledgement && Boolean(previous?.candidateScopeActive);
  const createdAt = new Date(now).toISOString();
  const next: AdviceBusinessContext = { conversationId: conversation.id, projectId: conversation.projectId,
    candidateQueryRevision: state.lastReferenceLookup?.candidateQueryRevision, createdAt, candidateScopeActive,
    recentGoals: [...(previous?.recentGoals ?? []), { intent, userGoal: userGoal.slice(0, 300),
      assistantQuestion: assistantAnswer.slice(0, 300) }].slice(-2) };
  return { ...state, adviceBusinessContext: next, pendingAdviceGoal: adviceTurn && verifiedAdvice && state.lastReferenceLookup?.candidateQueryRevision
    ? { conversationId: conversation.id, projectId: conversation.projectId, candidateQueryRevision: state.lastReferenceLookup.candidateQueryRevision,
      createdAt, validUntil: new Date(Math.min(now + TTL, Date.parse(state.lastReferenceLookup.createdAt) + TTL)).toISOString(),
      kind: "REFERENCE_SELECTION", generic: decision?.semantic?.adviceMode !== "PROJECT_SPECIFIC",
      goal: "PRELIMINARY_ADVICE", requestedMode: decision?.semantic?.adviceMode ?? "GENERAL_REFERENCE", pendingQuestion: null,
      excludedAssessments: [...new Set([...(state.pendingAdviceGoal?.excludedAssessments ?? []), ...(decision?.semantic?.constraintPatch.filter(patch => patch.op === "EXCLUDE_FROM_THIS_ADVICE")
        .map(patch => patch.field === "region" ? "REGIONAL_COMPLIANCE" as const : "BUILDING_TYPE_COMPLIANCE" as const)
        ?? [])])] } : acknowledgement ? state.pendingAdviceGoal : undefined };
}

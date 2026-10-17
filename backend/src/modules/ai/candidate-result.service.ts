import type { ToolRuntimeContext } from "./tools/tool-runtime.js";
import { saveConversationTaskState } from "./ai-conversation-state.service.js";
import type { LastReferenceLookup } from "./conversation-task.js";
import { recordCandidateResult, assertSolutionAccess } from "./solution-state.service.js";

export type CandidateResultContext = Pick<ToolRuntimeContext, "app" | "request" | "user" | "conversation" | "taskState" | "onEvent"> & { candidatePublication?: "READ_ONLY_ADVICE" };
/** Candidate Result不表达选择/Final/方案阶段，也不含签名URL。 */
export function candidateResultDto(lookup: LastReferenceLookup) {
  return { queryRevision: lookup.candidateQueryRevision, candidates: lookup.candidates.map((candidate, index) => ({
    // 仅说明当前来源资格，不构成CONFIRM授权；最终仍由事务内来源/版本重验决定。
    confirmationEligible: candidate.sourceType === "CALCULATED" ? Boolean(candidate.calculationId)
      : candidate.referenceKind !== "KNOWLEDGE_PAGE" && Boolean(candidate.sourcePageId && candidate.sourceVersionId && candidate.optionId),
    candidateId: candidate.id, position: index + 1, sourceType: candidate.sourceType ?? "REFERENCE",
    referenceKind: candidate.referenceKind ?? "THERMAL_ROW", sourceVersionId: candidate.sourceVersionId,
    constructionCode: candidate.constructionCode ?? candidate.schemeCode, systemName: candidate.systemName,
    productName: candidate.productName, thicknessMm: candidate.thicknessMm,
    productThermalResistance: candidate.productThermalResistance, totalThermalResistance: candidate.totalThermalResistance,
    kValue: candidate.kValue, sourcePageId: candidate.sourcePageId, sourcePageLabel: candidate.sourcePageLabel,
    optionId: candidate.optionId, calculationId: candidate.calculationId
  })) };
}
export async function publishCandidateResult(ctx: CandidateResultContext, snapshot: LastReferenceLookup, append = false) {
  let lookup: LastReferenceLookup;
  let solutionState = null;
  if (ctx.candidatePublication === "READ_ONLY_ADVICE") {
    const conversation = await assertSolutionAccess(ctx.app.db, ctx.user, ctx.conversation.id);
    if (conversation.projectId !== ctx.conversation.projectId) throw new Error("会话所属项目已变化，请重新查询。");
    lookup = { ...snapshot, candidateQueryRevision: (ctx.taskState?.lastReferenceLookup?.candidateQueryRevision ?? 0) + 1, projectId: conversation.projectId };
    await saveConversationTaskState(ctx.app, ctx.conversation.id, { ...(ctx.taskState ?? { taskType: "GENERAL" }), lastReferenceLookup: lookup,
      pendingAdviceGoal: undefined, adviceBusinessContext: undefined });
  } else if (ctx.user.clientType === "C_APP" || ctx.user.clientType === "PC_AI") {
    const recorded = await recordCandidateResult(ctx, snapshot, append);
    lookup = recorded.lookup;
    solutionState = recorded.solutionState;
  } else {
    lookup = { ...snapshot, candidateQueryRevision: (ctx.taskState?.lastReferenceLookup?.candidateQueryRevision ?? 0) + 1,
      projectId: ctx.conversation.projectId };
    await saveConversationTaskState(ctx.app, ctx.conversation.id, { ...(ctx.taskState ?? { taskType: "GENERAL" }), lastReferenceLookup: lookup });
  }
  ctx.taskState ??= { taskType: "GENERAL" };
  ctx.taskState.lastReferenceLookup = lookup;
  ctx.onEvent?.("reference_candidates", candidateResultDto(lookup));
  if (solutionState) ctx.onEvent?.("solution_state", { solutionState });
  return { lookup, solutionState };
}

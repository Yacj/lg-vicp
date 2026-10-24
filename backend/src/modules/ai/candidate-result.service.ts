import { validateCandidateAgainstQueryState, type ThermalQueryState } from "../thermal/thermal-query-state.js";
import { currentConfirmedPageLookup } from "./confirmed-page-lookup-state.js";
import type { ToolRuntimeContext } from "./tools/tool-runtime.js";
import { saveConversationTaskState } from "./ai-conversation-state.service.js";
import type { LastReferenceLookup } from "./conversation-task.js";
import { recordCandidateResult, assertSolutionAccess } from "./solution-state.service.js";
import { hasPublishedReferenceSource } from "./published-reference-source.js";
import { getConversationTaskState } from "./ai-conversation-state.service.js";
import { referenceRowsStillCurrent } from "./reference-candidate-source.service.js";

export type CandidateResultContext = Pick<ToolRuntimeContext, "app" | "request" | "user" | "conversation" | "taskState" | "onEvent"> & { candidatePublication?: "READ_ONLY_ADVICE" };
/** Candidate Result不表达选择/Final/方案阶段，也不含签名URL。 */
export function candidateResultDto(lookup: LastReferenceLookup, latestQuery?: ThermalQueryState) {
  return { queryRevision: lookup.candidateQueryRevision, matchesCurrentQuery: !latestQuery || lookup.candidates.every(candidate =>
    validateCandidateAgainstQueryState(candidate, latestQuery).passed), candidates: lookup.candidates.map((candidate, index) => ({
    // 仅说明当前来源资格，不构成CONFIRM授权；最终仍由事务内来源/版本重验决定。
    confirmationEligible: candidate.sourceType === "CALCULATED" ? Boolean(candidate.calculationId)
      : candidate.referenceKind !== "KNOWLEDGE_PAGE" && Boolean(candidate.sourcePageId && candidate.sourceVersionId && candidate.optionId || hasPublishedReferenceSource(candidate)),
    candidateId: candidate.id, position: index + 1, sourceType: candidate.sourceType ?? "REFERENCE",
    referenceKind: candidate.referenceKind ?? "THERMAL_ROW", sourceVersionId: candidate.sourceVersionId,
    constructionCode: candidate.constructionCode ?? candidate.schemeCode, schemeName: candidate.schemeName, systemName: candidate.systemName,
    substrateMaterial: candidate.substrateMaterial, substrateThickness: candidate.substrateThickness,
    inputThicknessLayerName: candidate.inputThicknessLayerName, productThermalResistanceScope: candidate.productThermalResistanceScope,
    productName: candidate.productName, thicknessMm: candidate.thicknessMm,
    productThermalResistance: candidate.productThermalResistance, totalThermalResistance: candidate.totalThermalResistance,
    kValue: candidate.kValue, sourcePageId: candidate.sourcePageId, sourcePageLabel: candidate.sourcePageLabel,
    optionId: candidate.optionId, calculationId: candidate.calculationId
  })) };
}
/** 历史重载只恢复当前有效正式候选；旧revision、过期、撤回或项目改变均不复活。 */
export async function currentCandidateResult(ctx: CandidateResultContext) {
  const conversation = await assertSolutionAccess(ctx.app.db, ctx.user, ctx.conversation.id);
  const taskState = await getConversationTaskState(ctx.app, conversation.id);
  const lookup = taskState.lastReferenceLookup;
  if (!lookup?.candidateQueryRevision || lookup.candidateResultInvalid || lookup.projectId !== conversation.projectId
    || !Number.isFinite(Date.parse(lookup.createdAt)) || Date.now() - Date.parse(lookup.createdAt) > 24 * 3600_000
    || Date.parse(lookup.createdAt) > Date.now() + 60_000) return null;
  const eligibleIds = new Set(candidateResultDto(lookup).candidates.filter(candidate => candidate.confirmationEligible).map(candidate => candidate.candidateId));
  const candidates = lookup.candidates.filter(candidate => eligibleIds.has(candidate.id));
  if (!await referenceRowsStillCurrent(ctx.app.db, candidates, { userId: ctx.user.id, projectId: conversation.projectId })) return null;
  const { emitReferencePages } = await import("./tools/thermal-calculate.tool.js");
  const verified = await emitReferencePages({ app: ctx.app, conversation }, candidates);
  const ids = new Set(verified.candidates.filter(candidate => {
    const saved = candidates.find(item => item.id === candidate.id)!;
    return saved.optionId === candidate.optionId && saved.sourceVersionId === candidate.sourceVersionId;
  }).map(candidate => candidate.id));
  const latest = currentConfirmedPageLookup(taskState.confirmedPageLookup, conversation);
  const latestQuery = latest && Date.parse(latest.createdAt) >= Date.parse(lookup.createdAt) ? latest.requestQuery ?? latest.query : undefined;
  const dto = candidateResultDto(lookup, latestQuery);
  return { ...dto, candidates: dto.candidates.filter(candidate => ids.has(candidate.candidateId)) };
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

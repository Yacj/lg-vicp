import { z } from "zod";
import { AppError } from "../../shared/errors.js";
import { referenceLookupCandidateSchema, type ReferenceLookupCandidate } from "./conversation-task.js";
import { thermalQueryStateSchema, validateCandidateAgainstQueryState, rankByPreferences, entityFields, type ThermalQueryState } from "../thermal/thermal-query-state.js";
import { normalizeThermalLookupQuery } from "../thermal/thermal-lookup-mode.js";
import { hasPublishedReferenceSource } from "./published-reference-source.js";
import { pageAttributeFields } from "../../shared/confirmed-page-query.js";

export const solutionStages = ["COLLECTING_REQUIREMENTS", "CANDIDATE_SELECTION", "REFINING", "READY_TO_CONFIRM", "CONFIRMED", "GENERATING", "GENERATED"] as const;
export type SolutionStage = typeof solutionStages[number];
export const solutionCandidateSchema = referenceLookupCandidateSchema.extend({
  candidateId: z.string().min(1), sourceType: z.enum(["REFERENCE", "CALCULATED", "PRODUCT"]),
  referenceKind: z.enum(["THERMAL_ROW", "KNOWLEDGE_PAGE"]).optional(), productName: z.string().optional(),
  thermalReferenceRowId: z.string().optional(), constructionCode: z.string().optional(), productId: z.string().nullable().optional(),
  calculationId: z.string().optional(), calcMode: z.string().optional(), ruleVersion: z.unknown().optional(),
  inputSnapshot: z.record(z.string(), z.unknown()).optional(), resultSnapshot: z.record(z.string(), z.unknown()).optional(),
  provenanceSnapshot: z.record(z.string(), z.unknown()).optional()
}).refine(value => value.id === value.candidateId, { message: "候选身份与正式 ID 必须一致" });
export type SolutionCandidateSnapshot = z.infer<typeof solutionCandidateSchema>;
export type SolutionConflict = { candidateId: string; code: string; message: string; relatedConstraint: string; keptForComparison: boolean };
export type SolutionCandidateState = { candidate: SolutionCandidateSnapshot; sourceRevision: number; status: "AVAILABLE" | "SELECTED" | "REJECTED" | "CONFLICT" | "FINAL" };
export type SolutionPayload = {
  queryStateSnapshot: ThermalQueryState; conditions: ThermalQueryState; preferences: NonNullable<ThermalQueryState["preferences"]>;
  candidateSetRevision: number; poolCandidateIds: string[]; candidates: SolutionCandidateState[];
  selectedCandidateIds: string[]; rejectedCandidateIds: string[]; finalCandidateIds: string[];
  conflicts: SolutionConflict[]; keptForComparisonIds: string[]; recommendedCandidateIds: string[];
};
export const solutionActionSchema = z.object({
  action: z.enum(["SELECT", "ADD", "REMOVE", "REMOVE_CONFLICT", "KEEP_FOR_COMPARISON", "SET_FINAL", "COMPARE", "CONFIRM", "START_NEW", "REVISE"]),
  expectedVersion: z.number().int().positive(), candidateSetRevision: z.number().int().nonnegative().optional(),
  candidateIds: z.array(z.string().min(1)).max(100).optional(), positions: z.array(z.number().int().positive()).max(100).optional()
  , comparisonCandidateIds: z.array(z.string().min(1)).max(100).optional()
}).strict();
export type SolutionAction = z.infer<typeof solutionActionSchema>;
export function solutionError(code: string, message: string): never { throw new AppError(code, message, 400, { errorCode: code }); }
export function emptySolution(): SolutionPayload {
  return { queryStateSnapshot: {}, conditions: {}, preferences: {}, candidateSetRevision: 0, poolCandidateIds: [], candidates: [],
    selectedCandidateIds: [], rejectedCandidateIds: [], finalCandidateIds: [], conflicts: [], keptForComparisonIds: [], recommendedCandidateIds: [] };
}
export function referenceSolutionCandidate(candidate: ReferenceLookupCandidate): SolutionCandidateSnapshot {
  return solutionCandidateSchema.parse({ ...candidate, candidateId: candidate.id, thermalReferenceRowId: candidate.id,
    sourceType: "REFERENCE", referenceKind: "THERMAL_ROW", constructionCode: candidate.schemeCode, productId: candidate.catalogProductId });
}
const unique = (ids: string[]) => [...new Set(ids)];
/** 只比较有效硬条件，不把来源追踪、解析置信度、意图或偏好算成条件变化。 */
export function solutionConstraintFingerprint(query: ThermalQueryState): string {
  const constraints: Record<string, unknown> = {};
  for (const field of [...entityFields, ...pageAttributeFields, "substrateThickness", "thicknessMm", "thicknessMin", "thicknessMax", "thicknessMinExclusive", "thicknessMaxExclusive"] as const)
    if (query[field] !== undefined) constraints[field] = query[field];
  for (const field of ["systemIds", "documentIds", "knowledgeVersionIds", "referenceSetIds", "specClasses", "placements", "constructionCodes"] as const)
    if (query[field]) constraints[field] = [...new Set(query[field])].sort();
  constraints.filters = normalizeThermalLookupQuery(query).filters.map(({ metric, targetValue, mode, tolerance }) =>
    JSON.stringify([metric, targetValue, mode, tolerance ?? null])).sort();
  constraints.exclusions = (query.exclusions ?? []).map(item => JSON.stringify([item.field, item.value])).sort();
  constraints.unresolved = (query.unresolved ?? []).map(item => JSON.stringify([item.field, item.reason])).sort();
  return JSON.stringify(constraints);
}
function conflictCode(field: string) {
  if (field.startsWith("thickness")) return "THICKNESS_MISMATCH";
  if (field.includes("system")) return "SYSTEM_MISMATCH";
  if (/product|spec/i.test(field)) return "PRODUCT_MISMATCH";
  if (/^(K|TOTAL_R|PRODUCT_R):/.test(field)) return "METRIC_MISMATCH";
  if (field === "regionCode") return "REGION_MISMATCH";
  if (field === "standardLimitId") return "STANDARD_MISMATCH";
  return "CONDITION_MISMATCH";
}
export function reconcileSolution(input: SolutionPayload): SolutionPayload {
  const state = structuredClone(input);
  state.conflicts = state.candidates.filter(item => state.selectedCandidateIds.includes(item.candidate.candidateId)).flatMap(item =>
    validateCandidateAgainstQueryState(item.candidate, state.conditions).failed.map(field => ({ candidateId: item.candidate.candidateId,
      code: conflictCode(field), relatedConstraint: field, message: `该方案不满足当前条件：${field}。`,
      keptForComparison: state.keptForComparisonIds.includes(item.candidate.candidateId) })));
  for (const item of state.candidates) {
    const id = item.candidate.candidateId;
    item.status = state.conflicts.some(conflict => conflict.candidateId === id) ? "CONFLICT"
      : state.finalCandidateIds.includes(id) ? "FINAL" : state.selectedCandidateIds.includes(id) ? "SELECTED"
      : state.rejectedCandidateIds.includes(id) ? "REJECTED" : "AVAILABLE";
  }
  state.recommendedCandidateIds = rankByPreferences(state.candidates.filter(item => state.selectedCandidateIds.includes(item.candidate.candidateId)
    && !state.conflicts.some(conflict => conflict.candidateId === item.candidate.candidateId)).map(item => item.candidate), state.queryStateSnapshot)
    .slice(0, 1).map(item => item.candidateId);
  return state;
}
export function refreshSolution(input: SolutionPayload, query: ThermalQueryState, candidates: SolutionCandidateSnapshot[]): SolutionPayload {
  const state = structuredClone(input), next = state.candidateSetRevision + 1;
  const parsed = candidates.map(candidate => solutionCandidateSchema.parse(candidate));
  if (unique(parsed.map(item => item.candidateId)).length !== parsed.length) solutionError("SOLUTION_DUPLICATE_CANDIDATE", "候选身份重复");
  state.queryStateSnapshot = thermalQueryStateSchema.parse(query);
  const { preferences, preferThinner, ...conditions } = state.queryStateSnapshot;
  if (solutionConstraintFingerprint(state.conditions) !== solutionConstraintFingerprint(conditions)) state.keptForComparisonIds = [];
  state.conditions = conditions; state.preferences = { ...preferences, ...(preferThinner ? { preferThinner: true } : {}) };
  state.poolCandidateIds = parsed.map(item => item.candidateId);
  const retained = state.candidates.filter(item => !state.poolCandidateIds.includes(item.candidate.candidateId)
    && (state.selectedCandidateIds.includes(item.candidate.candidateId) || state.rejectedCandidateIds.includes(item.candidate.candidateId)));
  state.candidates = [...parsed.map(candidate => ({ candidate, sourceRevision: next, status: "AVAILABLE" as const })), ...retained];
  state.candidateSetRevision = next;
  // 所有条件/候选刷新都要求重新指定 Final，已选方案始终保留。
  state.finalCandidateIds = [];
  return reconcileSolution(state);
}
export function resolveActionCandidateIds(state: SolutionPayload, action: SolutionAction): string[] {
  if (action.positions?.length && action.candidateIds?.length) solutionError("SOLUTION_SELECTION_AMBIGUOUS", "请只使用序号或正式候选 ID 选择");
  if (action.positions?.length && action.candidateSetRevision !== state.candidateSetRevision)
    solutionError("SOLUTION_REVISION_CONFLICT", "候选列表已变化，请刷新后重新选择");
  const ids = action.positions?.map(position => state.poolCandidateIds[position - 1] ?? solutionError("SOLUTION_POSITION_INVALID", "候选序号超出当前列表"))
    ?? action.candidateIds ?? [];
  if (ids.some(id => !state.candidates.some(item => item.candidate.candidateId === id))) solutionError("SOLUTION_CANDIDATE_INVALID", "候选不属于当前方案池");
  return unique(ids);
}
export function applySolutionAction(input: SolutionPayload, action: SolutionAction): SolutionPayload {
  const state = structuredClone(input);
  const comparisonIds = action.comparisonCandidateIds ?? [];
  if (comparisonIds.length && action.action !== "SET_FINAL") solutionError("SOLUTION_CANDIDATE_INVALID", "参考候选只能随指定最终方案保留");
  if (comparisonIds.length) resolveActionCandidateIds(state, { ...action, candidateIds: comparisonIds, positions: undefined });
  let ids = resolveActionCandidateIds(state, action);
  if (action.action === "REMOVE_CONFLICT" && !ids.length) ids = unique(state.conflicts.map(item => item.candidateId));
  if (action.action === "SET_FINAL" && !ids.length) ids = [...state.selectedCandidateIds];
  if (["SELECT", "ADD", "REMOVE", "KEEP_FOR_COMPARISON"].includes(action.action) && !ids.length)
    solutionError("SOLUTION_SELECTION_REQUIRED", "请明确要操作的候选方案");
  if (action.action === "SELECT" || action.action === "ADD" || action.action === "SET_FINAL") {
    state.selectedCandidateIds = action.action === "SELECT" ? ids : unique([...state.selectedCandidateIds, ...ids]);
    state.rejectedCandidateIds = state.rejectedCandidateIds.filter(id => !ids.includes(id));
  }
  if (action.action === "REMOVE" || action.action === "REMOVE_CONFLICT") {
    state.selectedCandidateIds = state.selectedCandidateIds.filter(id => !ids.includes(id));
    state.rejectedCandidateIds = unique([...state.rejectedCandidateIds, ...ids]);
    state.keptForComparisonIds = state.keptForComparisonIds.filter(id => !ids.includes(id));
  }
  if (action.action === "KEEP_FOR_COMPARISON") {
    if (ids.some(id => !state.conflicts.some(item => item.candidateId === id))) solutionError("SOLUTION_CONFLICT_REQUIRED", "该操作只适用于已选冲突方案");
    state.keptForComparisonIds = unique([...state.keptForComparisonIds, ...ids]);
  }
  if (["SELECT", "ADD", "REMOVE", "REMOVE_CONFLICT"].includes(action.action)) state.finalCandidateIds = [];
  if (action.action === "SET_FINAL") {
    if (!ids.length) solutionError("SOLUTION_FINAL_REQUIRED", "请先选择最终方案");
    state.finalCandidateIds = ids;
    state.selectedCandidateIds = unique([...state.selectedCandidateIds, ...comparisonIds]);
    state.rejectedCandidateIds = state.rejectedCandidateIds.filter(id => !comparisonIds.includes(id));
  }
  return reconcileSolution(state);
}
export function compareSelectedSolution(state: SolutionPayload) {
  if (state.selectedCandidateIds.length < 2) solutionError("SOLUTION_COMPARE_MINIMUM", "请至少选择两个方案");
  return { scope: "SELECTED_CANDIDATES" as const, candidates: state.selectedCandidateIds.map(id => {
    const item = state.candidates.find(item => item.candidate.candidateId === id)!;
    return { ...structuredClone(item.candidate), conflicts: state.conflicts.filter(conflict => conflict.candidateId === id) };
  }), recommendedCandidateIds: state.recommendedCandidateIds };
}
export function validateFinalSolution(state: SolutionPayload): SolutionCandidateSnapshot[] {
  if (!state.finalCandidateIds.length) solutionError("SOLUTION_FINAL_REQUIRED", "请先指定最终方案，再明确确认");
  const candidates = state.finalCandidateIds.map(id => state.candidates.find(item => item.candidate.candidateId === id)?.candidate
    ?? solutionError("SOLUTION_CANDIDATE_INVALID", "最终候选不存在"));
  if (state.conflicts.some(conflict => state.finalCandidateIds.includes(conflict.candidateId)))
    solutionError("SOLUTION_HARD_CONFLICT", "最终方案存在硬条件冲突，请移除该方案或调整条件；保留用于比较不能解除冲突");
  if (state.conflicts.some(conflict => !conflict.keptForComparison))
    solutionError("SOLUTION_CONFLICT_UNHANDLED", "已选备选方案仍有未处理冲突，请明确移除或保留用于比较");
  for (const candidate of candidates) {
    if (![candidate.thicknessMm, candidate.kValue, candidate.productThermalResistance, candidate.totalThermalResistance].every(value => typeof value === "number" && Number.isFinite(value) && value > 0)
      || !candidate.systemId || !candidate.schemeId || !candidate.productSpecId || !candidate.systemName || !candidate.constructionCode)
      solutionError("SOLUTION_FACTS_INCOMPLETE", "最终方案缺少关键正式事实，请补齐资料后确认");
    if (candidate.sourceType === "REFERENCE" && !hasPublishedReferenceSource(candidate) && (!candidate.sourcePageId || !candidate.sourceDocumentId || !candidate.optionId
      || candidate.referenceKind !== "KNOWLEDGE_PAGE" && !candidate.thermalReferenceRowId))
      solutionError("SOLUTION_SOURCE_REQUIRED", "参考方案缺少可追溯原页或正式参考行");
    if (candidate.sourceType === "CALCULATED" && (!candidate.calculationId || !candidate.calcMode || !candidate.inputSnapshot || !candidate.resultSnapshot || !candidate.provenanceSnapshot))
      solutionError("SOLUTION_CALC_SNAPSHOT_REQUIRED", "计算方案缺少完整计算快照");
    if (candidate.sourceType === "PRODUCT" && !candidate.productId) solutionError("SOLUTION_SOURCE_REQUIRED", "产品方案缺少正式产品来源");
  }
  return structuredClone(candidates);
}
export function solutionCards(state: SolutionPayload) {
  return state.candidates.map(({ candidate, status, sourceRevision }) => ({ ...candidate, title: candidate.constructionCode ?? candidate.systemName ?? candidate.productName ?? candidate.candidateId,
    position: state.poolCandidateIds.indexOf(candidate.candidateId) + 1 || null, sourceRevision, status,
    selected: state.selectedCandidateIds.includes(candidate.candidateId), final: state.finalCandidateIds.includes(candidate.candidateId),
    conflict: status === "CONFLICT", conflictMessages: state.conflicts.filter(item => item.candidateId === candidate.candidateId).map(item => item.message) }));
}

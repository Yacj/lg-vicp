import { queryThermalCandidates } from "../thermal/thermal-candidate.service.js";
import { rankByPreferences, traceQueryState, validateCandidateAgainstQueryState, type ThermalQueryState } from "../thermal/thermal-query-state.js";
import { compactCandidateResult } from "./tools/thermal-lookup.js";
import type { SolutionContext } from "./solution-state.service.js";
import { emitReferencePages } from "./tools/thermal-calculate.tool.js";

import { DEFAULT_SOLUTION_QUERY_POLICY, type SolutionCandidateQueryPolicy } from "./solution-candidate-query-policy.js";
export { DEFAULT_SOLUTION_QUERY_POLICY } from "./solution-candidate-query-policy.js";
/** 内部覆写必须写明业务用途，不能让不同入口静默改变默认口径。 */
export type SolutionQueryOverride = { reason: string; policy: Partial<Pick<SolutionCandidateQueryPolicy, "neighborTolerance" | "maxCandidates" | "nearbyLimit" | "identityLimit">> };

/** Chat/REST/Agent/refine/refresh 共用。正式库读取、硬条件、偏好、排序、截断与说明候选只在这里处理。 */
export async function querySolutionCandidates(ctx: SolutionContext, query: ThermalQueryState, override?: SolutionQueryOverride) {
  const policy = { ...DEFAULT_SOLUTION_QUERY_POLICY, ...override?.policy };
  if (override && !override.reason.trim()) throw new Error("候选查询策略覆写必须说明业务用途");
  const outcome = query.unresolved?.length ? null : await queryThermalCandidates(ctx.app, ctx.request, ctx.user, {
    ...query, intent: "REFERENCE_LOOKUP", targetResistance: query.targetR,
    neighborTolerance: policy.neighborTolerance, projectId: ctx.conversation.projectId ?? undefined
  });
  const queryState = traceQueryState({ ...query, ...outcome?.queryState });
  const formal = rankByPreferences((outcome?.candidates ?? []).map(compactCandidateResult)
    .filter(candidate => validateCandidateAgainstQueryState(candidate, queryState).passed), queryState);
  const nearbyRaw = (outcome?.nearbyCandidates ?? []).map(compactCandidateResult);
  const nearbyCandidates = nearbyRaw.filter(candidate => !validateCandidateAgainstQueryState(candidate, queryState).passed).slice(0, policy.nearbyLimit);
  const identityMatchedButMetricFailed = (outcome?.identityMatchedButMetricFailed ?? []).map(compactCandidateResult).slice(0, policy.identityLimit);
  const pages = await emitReferencePages(ctx, formal.slice(0, policy.maxCandidates));
  const pageContext = { app: ctx.app, conversation: ctx.conversation };
  const nearbyPages = await emitReferencePages(pageContext, nearbyCandidates);
  const identityPages = await emitReferencePages(pageContext, identityMatchedButMetricFailed);
  const matchedCandidates = pages.candidates;
  return { policy, queryState, outcome, pages, nearbyPages, identityPages, candidates: matchedCandidates, matchedCandidates,
    nearbyCandidates: nearbyPages.candidates, nearbyRaw, identityMatchedButMetricFailed: identityPages.candidates,
    matchedCount: outcome?.matchedCandidates?.length ?? formal.length,
    matchedSystemHint: query.systemHint ? formal.length > 0 : null, isFallback: false,
    notes: [...(outcome?.notes ?? [])] };
}

import { normalizeThermalLookupQuery, type ThermalLookupFilter } from "./thermal-lookup-mode.js";
import { validateCandidateAgainstQueryState, type ConstraintCandidate, type ThermalQueryState } from "./thermal-query-state.js";

/** constructionCode 只供筛选；事实身份始终使用 row.id 或完整联合身份。 */
export function candidateIdentity(candidate: ConstraintCandidate & { id?: string; sourcePageId?: string | null }): string {
  return candidate.id ?? JSON.stringify([candidate.systemId, candidate.schemeId, candidate.productSpecId, candidate.schemeCode, candidate.sourcePageId, candidate.thicknessMm]);
}

export function identityMetricFailures<T extends ConstraintCandidate>(candidates: T[], query: ThermalQueryState): Array<{ candidate: T; failedConstraints: ThermalLookupFilter[] }> {
  if (!query.schemeId && !query.schemeCode && !query.productSpecId) return [];
  const filters = normalizeThermalLookupQuery(query).filters;
  if (!filters.length) return [];
  const identityQuery = { ...query, filters: [], metric: undefined, targetValue: undefined, targetK: undefined, targetR: undefined };
  return candidates.filter(candidate => validateCandidateAgainstQueryState(candidate, identityQuery).passed)
    .map(candidate => ({ candidate, failedConstraints: filters.filter(filter => !validateCandidateAgainstQueryState(candidate, { filters: [filter] }).passed) }))
    .filter(item => item.failedConstraints.length > 0);
}

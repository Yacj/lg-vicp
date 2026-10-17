export type SolutionCandidateQueryPolicy = {
  neighborTolerance: number; maxCandidates: number; nearbyLimit: number; identityLimit: number;
  ranking: "PUBLISHED_RULES_THEN_PREFERENCES"; nearby: "EXPLAIN_ONLY"; fallback: "NONE";
  sources: "FORMAL_AND_CONFIRMED"; knowledgeQualification: "READ_ONLY";
};
export const DEFAULT_SOLUTION_QUERY_POLICY: Readonly<SolutionCandidateQueryPolicy> = Object.freeze({
  neighborTolerance: 1, maxCandidates: 12, nearbyLimit: 12, identityLimit: 12,
  ranking: "PUBLISHED_RULES_THEN_PREFERENCES", nearby: "EXPLAIN_ONLY", fallback: "NONE", sources: "FORMAL_AND_CONFIRMED", knowledgeQualification: "READ_ONLY"
});

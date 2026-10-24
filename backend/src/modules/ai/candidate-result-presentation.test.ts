import "dotenv/config";
import { expect, it } from "vitest";
import { candidateResultDto } from "./candidate-result.service.js";
import type { LastReferenceLookup } from "./conversation-task.js";

const lookup = { query: {}, candidateQueryRevision: 4, createdAt: new Date().toISOString(),
  candidates: [{ id: "row", kValue: .2322, thicknessMm: 25, sourceType: "REFERENCE", sourcePageId: "p", sourceVersionId: "v", optionId: "o" }] } as LastReferenceLookup;
it("旧候选不能冒充最新严格查询命中；不修改候选来源资格或revision", () => {
  const before = candidateResultDto(lookup);
  const after = candidateResultDto(lookup, { filters: [{ metric: "K", mode: "GT", targetValue: .2322 }] });
  expect(before.matchesCurrentQuery).toBe(true);
  expect(after.matchesCurrentQuery).toBe(false);
  expect(after.queryRevision).toBe(before.queryRevision);
  expect(after.candidates).toEqual(before.candidates);
  expect(after.candidates[0]?.confirmationEligible).toBe(true);
});
it("包含边界仍符合，厚度开边界和其他身份条件均独立核验", () => {
  expect(candidateResultDto(lookup, { filters: [{ metric: "K", mode: "MAX_LIMIT", targetValue: .2322 }] }).matchesCurrentQuery).toBe(true);
  expect(candidateResultDto(lookup, { thicknessMax: 25, thicknessMaxExclusive: true }).matchesCurrentQuery).toBe(false);
  expect(candidateResultDto(lookup, { substrateThickness: 180 }).matchesCurrentQuery).toBe(false);
});

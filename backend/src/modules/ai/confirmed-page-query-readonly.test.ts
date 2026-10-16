import "dotenv/config";
import { expect, it, vi } from "vitest";
vi.mock("../thermal/thermal-query-dictionary.service.js", () => ({ loadThermalQueryDictionary: vi.fn(async () => ({ entities: [], aliases: [] })) }));
vi.mock("./semantic-query.service.js", () => ({ parseSemanticQuery: vi.fn(async () => ({ query: { intent: "REFERENCE_LOOKUP", parserSource: "LLM", applicationPart: "ROOF", placement: "INVERTED", thicknessMm: 25 }, needsClarification: false })) }));
vi.mock("./solution-candidate-query.service.js", () => ({ querySolutionCandidates: vi.fn() }));
vi.mock("./candidate-result.service.js", () => ({ publishCandidateResult: vi.fn() }));
import { resolveReferenceQueryWithoutAgent } from "./reference-query.service.js";
import { querySolutionCandidates } from "./solution-candidate-query.service.js";
import { publishCandidateResult } from "./candidate-result.service.js";

it("确认页事实查询不调用正式Candidate查询或发布，不刷新已有候选/方案", async () => {
  const state = { taskType: "GENERAL", lastReferenceLookup: { candidates: [{ id: "existing" }], query: {}, createdAt: "old" } };
  const before = JSON.stringify(state);
  const result = await resolveReferenceQueryWithoutAgent({ app: {}, conversation: {}, taskState: state,
    domainDecision: { intent: "REFERENCE_QUERY", mutation: "QUERY", semantic: { pageQuery: {} } } } as any);
  expect(result.needsClarification).toBe(false);
  expect(result.facts.query).toMatchObject({ applicationPart: "ROOF", placement: "INVERTED", thicknessMm: 25 });
  expect(querySolutionCandidates).not.toHaveBeenCalled(); expect(publishCandidateResult).not.toHaveBeenCalled();
  expect(JSON.stringify(state)).toBe(before);
});

import "dotenv/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), save: vi.fn() }));
vi.mock("./solution-candidate-query.service.js", () => ({ querySolutionCandidates: mocks.query }));
vi.mock("./semantic-query.service.js", () => ({ parseSemanticQuery: async () => ({ query: { intent: "REFERENCE_LOOKUP", filters: [{ metric: "PRODUCT_R", targetValue: .3, mode: "APPROX" }] }, needsClarification: false }) }));
vi.mock("../thermal/thermal-query-dictionary.service.js", () => ({ loadThermalQueryDictionary: async () => ({ entities: [], aliases: [] }) }));
vi.mock("./candidate-result.service.js", () => ({ publishCandidateResult: mocks.save }));
import { resolveReferenceQueryWithoutAgent } from "./reference-query.service.js";
import { diagnoseReferenceQuery, renderReferenceQueryDiagnostics } from "../thermal/reference-query-diagnostics.js";
import { normalizeReferenceLookupForModel } from "./tools/tool-result-normalizer.js";
const ctx: any = { app: { log: {} }, user: {}, request: {}, conversation: { id: "c", projectId: null },
  domainDecision: { intent: "REFERENCE_QUERY", mutation: "QUERY" }, taskState: { taskType: "GENERAL" } };
beforeEach(() => { mocks.query.mockReset(); mocks.save.mockReset(); });
describe("零候选的Service诊断贯通AnswerFacts及Tool", () => {
  it.each(["missing", "value", "unpublished"])("%s原样进入用户可见回复，不交模型猜测", async kind => {
    const query = { filters: [{ metric: "PRODUCT_R" as const, targetValue: .3, mode: "APPROX" as const }] };
    const rows = kind === "unpublished" ? [] : [{ thicknessMm: 35, ...(kind === "value" ? { productThermalResistance: 5 } : {}) }];
    const diagnostic = diagnoseReferenceQuery(query, rows, "JOINT");
    const page = { candidates: [], sources: [], blocks: [], warnings: [] };
    mocks.query.mockResolvedValue({ queryState: query, candidates: [], pages: page, identityPages: page, nearbyPages: page, nearbyRaw: [],
      nearbyCandidates: [], identityMatchedButMetricFailed: [], matchedCount: 0, queryDiagnostics: diagnostic, missingMetricFields: diagnostic.missingMetrics,
      metricScope: diagnostic.metricScopes[0], readOnlyReferences: { answer: renderReferenceQueryDiagnostics(diagnostic), pages: [] }, readOnlyFacts: [] });
    const actual = await resolveReferenceQueryWithoutAgent({ ...ctx, taskState: { taskType: "GENERAL" } });
    expect(actual.facts.queryDiagnostics).toEqual(diagnostic); expect(actual.facts.canonicalAnswers[0]).toBe(renderReferenceQueryDiagnostics(diagnostic));
    const tool = normalizeReferenceLookupForModel({ allowedFacts: actual.facts, canonicalAnswers: actual.facts.canonicalAnswers, found: false, candidates: [] });
    expect(tool.allowedFacts?.queryDiagnostics?.issues).toEqual(diagnostic.issues); expect(tool.instruction).toContain("不猜测原因");
    expect(mocks.save.mock.calls.at(-1)?.[1].candidates).toEqual([]);
  });
});

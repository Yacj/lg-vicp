import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { resolveReferenceQueryWithoutAgent } from "./reference-query.service.js";

const mocks = vi.hoisted(() => ({ dictionary: vi.fn(), query: vi.fn(), save: vi.fn() }));
vi.mock("../thermal/thermal-query-dictionary.service.js", () => ({ loadThermalQueryDictionary: mocks.dictionary }));
vi.mock("../thermal/thermal-candidate.service.js", () => ({ queryThermalCandidates: mocks.query }));
vi.mock("./ai-conversation-state.service.js", () => ({ saveConversationTaskState: mocks.save }));

describe("非Agent候选对比只读冻结记录", () => {
  it("第一和第三个直接构建事实集，不读目录或全库重查，不受旧选择影响", async () => {
    const candidates = [1, 2, 3].map(index => ({ id: `row-${index}`, schemeCode: `A1-${index}`, thicknessMm: 20, kValue: 0.3 }));
    const ctx = { app: { db: {} }, conversation: { id: "c" }, request: {}, user: {}, userMessage: "第一个和第三个哪个好",
      taskState: { taskType: "GENERAL", lastReferenceLookup: { query: {}, candidates, selectedCandidateIds: ["row-1", "row-2"], createdAt: "2026-10-10" } } };
    const result = await resolveReferenceQueryWithoutAgent(ctx as any);
    expect(result.facts.candidates.map(candidate => candidate.id)).toEqual(["row-1", "row-3"]);
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.dictionary).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalled();
  });
});

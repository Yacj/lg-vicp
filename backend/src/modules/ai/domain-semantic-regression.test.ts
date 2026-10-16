import "dotenv/config";
import { beforeEach, expect, it, vi } from "vitest";
import { resolveDomainTurn } from "./ai-domain-turn-decision.service.js";
const mocks = vi.hoisted(() => ({ model: vi.fn(), runtime: vi.fn() }));
vi.mock("ai", () => ({ generateObject: mocks.model }));
vi.mock("./ai-runtime.service.js", () => ({ resolveSceneRuntime: mocks.runtime }));
beforeEach(() => { vi.clearAllMocks(); mocks.runtime.mockResolvedValue({ primary: { languageModel: {} } }); });
const cases = [
  ["能不能出个方案", "SOLUTION_ADVICE", "READ_ONLY"],
  ["不要出方案，直接列原表", "REFERENCE_VIEW", "READ_ONLY"],
  ["不要推荐方案", "GENERAL", "READ_ONLY"],
  ["暂不确认，先给建议", "SOLUTION_ADVICE", "READ_ONLY"],
  ["帮我确认一下 A3-2 的 K", "REFERENCE_DETAIL", "READ_ONLY"],
  ["给我45mm的初步方案，顺便比较基层", "SOLUTION_ADVICE", "READ_ONLY"],
  ["不用生成报告，只给个大致方案", "SOLUTION_ADVICE", "READ_ONLY"],
  ["仅给我报告提纲", "SOLUTION_ADVICE", "READ_ONLY"],
  ["他说‘确认最终方案’，请解释这句话", "KNOWLEDGE_EXPLAIN", "READ_ONLY"],
  ["假如把第一个加入方案，会有什么变化", "KNOWLEDGE_EXPLAIN", "READ_ONLY"],
  ["不要把第一个加入方案", "GENERAL", "READ_ONLY"],
  ["先比较，再给通用建议", "SOLUTION_ADVICE", "READ_ONLY"],
  ["先不考虑地区，来个参考选型", "SOLUTION_ADVICE", "READ_ONLY"],
  ["不需要合规结论，只做参考选型", "SOLUTION_ADVICE", "READ_ONLY"],
  ["上海住宅能达标吗", "COMPLIANCE_CHECK", "READ_ONLY"],
  ["正式生成PDF", "REPORT_REQUEST", "REPORT_GENERATION"],
] as const;
it.each(cases)("开放表达必须经过同一个语义合同：%s", async (message, intent, requestedEffect) => {
  mocks.model.mockResolvedValue({ object: { intent, comparison: null, referenceTime: null, confidence: .99, evidence: message, unresolved: null,
    relation: message === "不要推荐方案" ? "CANCEL" : "CONTINUE", adviceMode: "GENERAL_REFERENCE",
    constraintPatch: [], reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: 7 },
    requestedEffect, effectRequest: requestedEffect === "READ_ONLY" ? null : { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: message },
    ambiguity: [] } });
  const result = await resolveDomainTurn({ app: { db: {}, log: { warn: vi.fn() } },
    conversation: { id: "semantic-case", projectId: null }, userMessage: message,
    taskState: { taskType: "GENERAL", lastReferenceLookup: { query: { thicknessMm: 45 }, candidates: [], candidateQueryRevision: 7 } } } as any);
  expect(mocks.model).toHaveBeenCalledOnce();
  expect(result).toMatchObject({ intent, mutation: requestedEffect === "REPORT_GENERATION" ? "REPORT" : "NONE" });
});

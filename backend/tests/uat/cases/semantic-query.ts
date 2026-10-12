import type { UatCase } from "../schema.js";
import { A13 } from "../fixtures/facts.js";
import { turn, filter } from "./helpers.js";

/** 来自本轮用户登记的真实业务失败表达；预期真值手工指定。 */
export const semanticQueryCases: UatCase[] = [
  { id: "SEMANTIC-001", persona: "SALES", scenario: "开放口语、新问题重置与省略厚度", tags: ["SEMANTIC", "NEW_QUERY", "CONTINUE_QUERY"], turns: [
    turn("板自身R做到8.3有吗", { query: { filters: [filter("PRODUCT_R", "APPROX", 8.3)] }, candidateCount: 0, clarification: false }),
    turn("我想看看那种薄抹灰的，K差不多0.3，别超过20厚", { query: { filters: [filter("K", "APPROX", 0.3)], thicknessMax: 20 }, expectedCandidate: A13, clarification: false }),
    turn("那25以内呢", { query: { thicknessMax: 25 }, inheritPreviousFilters: true, expectedCandidate: A13 })
  ] },
  { id: "SEMANTIC-002", persona: "DESIGN_INSTITUTE", scenario: "EXACT身份未命中与近似模式恢复", tags: ["SEMANTIC", "EXACT_MISS", "IDENTITY"], turns: [
    turn("I型薄抹灰A1-3 18mm的K卡在0.3附近吗", { query: { filters: [filter("K", "APPROX", 0.3)], thicknessMm: 18 }, expectedCandidate: A13 }),
    turn("A1-3 18mm的K是不是正好0.300", { query: { filters: [filter("K", "EXACT", 0.3)], thicknessMm: 18 }, candidateCount: 0, answerFacts: [{ pattern: "K[=＝≈]([0-9.]+)", value: 0.303 }] }),
    turn("K还是大概0.3就行", { query: { filters: [filter("K", "APPROX", 0.3)] }, expectedCandidate: A13 })
  ] }
];

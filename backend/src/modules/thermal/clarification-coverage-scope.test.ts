import { describe, expect, it } from "vitest";
import { applySemanticQuery } from "./semantic-query.js";

/**
 * 真实会话：
 *   用户：保温薄抹灰0.3传热系数方案
 *   AI：想确认一下：0.3未说明是整墙传热系数K、整构造热阻R还是产品热阻。
 *   用户：产品热阻
 *   AI：想确认一下：部分明确指标条件未被完整解析，请确认。   ← 明确回答了却被拒
 *
 * 根因：澄清回复的校验把「上一轮原问 + 本轮」拼在一起做覆盖检查，
 * 上一轮的 K 0.3 与「薄抹灰」被当成「模型本轮漏掉的条件」，于是 reject。
 * 覆盖校验应只看本轮原话；拼接文本只用于证据核验。
 */

const dictionary = {
  entities: [
    { field: "systemId", value: "sys-1", names: ["VICP薄抹灰外保温系统", "薄抹灰"] },
    { field: "specClass", value: "I", names: ["I", "I型"] }
  ], aliases: []
} as never;

const metric = (m: string, evidence: string, value: number | null) => ({ type: "METRIC", field: null, operation: "SET",
  value, metric: m, operator: "APPROX", evidence, entityText: null, resolvedText: null, hard: true, confidence: .9 });

const run = (text: string, currentMessage: string | undefined, constraints: unknown[]) => applySemanticQuery(text, {
  queryMode: "REFINE_QUERY", intent: "REFERENCE_LOOKUP", confidence: .9, unresolved: [], preferences: [], constraints
} as never, dictionary, undefined, currentMessage === undefined ? undefined : { currentMessage });

const original = "保温薄抹灰0.3传热系数方案";

describe("澄清纠正指标时只核验本轮原话", () => {
  it("本轮只回答产品热阻：不再把上一轮的 K 0.3 与薄抹灰当成漏项", () => {
    const query = run(`${original}\n产品热阻`, "产品热阻", [metric("PRODUCT_R", "0.3", 0.3)]);
    expect(query.unresolved ?? []).toEqual([]);
    expect(query.filters).toHaveLength(1);
    expect(query.filters?.[0]).toMatchObject({ metric: "PRODUCT_R", targetValue: 0.3 });
  });

  it("对照：不限定本轮范围时旧口径会误拒（说明修复不是放宽校验）", () => {
    const query = run(`${original}\n产品热阻`, undefined, [metric("PRODUCT_R", "0.3", 0.3)]);
    const fields = (query.unresolved ?? []).map(item => item.field);
    expect(fields).toContain("metric");
    expect(fields).toContain("systemId");
  });

  it("本轮明确写了体系而模型漏字段，仍然拒绝", () => {
    const query = run("产品热阻，薄抹灰体系\n产品热阻，薄抹灰体系", "产品热阻，薄抹灰体系", [metric("PRODUCT_R", "0.3", 0.3)]);
    expect(query.unresolved?.some(item => item.field === "systemId")).toBe(true);
  });

  it("本轮明确写了两个指标而模型只给一个，仍然拒绝", () => {
    const message = "传热系数0.3和产品热阻2.9";
    const query = run(`${message}\n${message}`, message, [metric("PRODUCT_R", "2.9", 2.9)]);
    expect(query.unresolved?.some(item => item.field === "metric")).toBe(true);
  });
});

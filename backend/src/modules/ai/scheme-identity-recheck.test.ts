import { describe, expect, it } from "vitest";
import { applySemanticQuery } from "../thermal/semantic-query.js";

/**
 * 修复轮（阶段4 F2）：构造编号已解析成正式构造ID时，逐字段复核不得再判「未完整保留」。
 *
 * 真实失败：隔离 UAT「A1-3 I型18mm图集参数」
 * → schemeCode=A1-3、schemeId 未定义（模型按合同给文本编号），
 *   复核把 schemeId 的缺失当作身份丢失 → PAGE_QUERY_CONSTRAINTS_INVALID，
 *   任何按构造编号的查表都会被无条件拒绝。
 * 隔离环境实测：explicit={"schemeId":"a989363b-…"}，query={"schemeCode":"A1-3","specClass":"I","thicknessMm":18}。
 */

const dictionary = (code = "A1-3") => ({
  entities: [
    { field: "schemeId", value: "scheme-uuid", names: ["VICP 薄抹灰外保温系统", code] },
    { field: "specClass", value: "I", names: ["I", "I型"] }
  ], aliases: []
}) as never;

const run = (constraints: unknown[], text = "A1-3 I型18mm图集参数") => applySemanticQuery(text, {
  queryMode: "NEW_QUERY", intent: "REFERENCE_LOOKUP", confidence: .95, unresolved: [], preferences: [], constraints
} as never, dictionary(), undefined);

const codeConstraint = { type: "ENTITY", field: "schemeCode", operation: "SET", value: null, metric: null, operator: null,
  evidence: "A1-3", entityText: "A1-3", resolvedText: null, hard: true, confidence: .95 };
const specConstraint = { type: "ENTITY", field: "specClass", operation: "SET", value: null, metric: null, operator: null,
  evidence: "I型", entityText: "I型", resolvedText: "I", hard: true, confidence: .95 };
const thicknessConstraint = { type: "THICKNESS", field: null, operation: "SET", value: 18, metric: null, operator: "EXACT",
  evidence: "18mm", entityText: "18mm", resolvedText: null, hard: true, confidence: .95 };

describe("构造编号与构造ID是同一条身份的两种表示", () => {
  it("模型给 schemeCode、字典能解析出 schemeId 时不再拒绝", () => {
    const result = run([codeConstraint, specConstraint, thicknessConstraint]);
    expect(result.unresolved ?? []).toEqual([]);
    expect(result.schemeCode).toBe("A1-3");
    expect(result.specClass).toBe("I");
    expect(result.thicknessMm).toBe(18);
  });

  it("完全没有保留编号时才拒绝（保护只在身份已保留时生效）", () => {
    const result = run([thicknessConstraint]);
    expect(result.unresolved?.some(item => item.field === "schemeId")).toBe(true);
  });

  it("无从解析时保持文本条件，不签发目录ID", () => {
    const result = applySemanticQuery("A1-3 I型18mm图集参数", {
      queryMode: "NEW_QUERY", intent: "REFERENCE_LOOKUP", confidence: .95, unresolved: [], preferences: [],
      constraints: [codeConstraint, thicknessConstraint]
    } as never, { entities: [], aliases: [] } as never, undefined);
    expect(result.unresolved ?? []).toEqual([]);
    expect(result.schemeCode).toBe("A1-3");
    expect(result.schemeId).toBeUndefined();
  });
});

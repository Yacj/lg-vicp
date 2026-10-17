import { describe, expect, it } from "vitest";
import { diagnoseReferenceQuery, renderReferenceQueryDiagnostics } from "./reference-query-diagnostics.js";
import type { ConstraintCandidate, ThermalQueryState } from "./thermal-query-state.js";
const row: ConstraintCandidate = { systemId: "s", systemName: "薄抹灰", specClass: "III", substrateMaterial: "混凝土", substrateThickness: 200,
  thicknessMm: 35, kValue: .2, productThermalResistance: 5, totalThermalResistance: 6, sourceDocumentId: "d", sourceVersionId: "v" };
const query: ThermalQueryState = { filters: [{ metric: "PRODUCT_R", targetValue: .3, mode: "APPROX" }] };
describe("查询诊断只读取当前条件范围", () => {
  it.each([{ specClass: "I" }, { thicknessMm: 20 }, { substrateMaterial: "砖墙" }, { systemId: "other" }, { sourceVersionId: "other" }])("%j不能进入当前身份的取值概览", changed => {
    const q = { ...query, systemId: "s", specClass: "III" as const, thicknessMm: 35, substrateMaterial: "混凝土", knowledgeVersionIds: ["v"] };
    const d = diagnoseReferenceQuery(q, [{ ...row, ...changed }], "THERMAL_ROW");
    expect(d.identityCount).toBe(0); expect(d.metricScopes).toEqual([]); expect(d.issues).toEqual(["IDENTITY_NOT_FOUND"]);
  });
  it("当前身份缺列，不受其他型号已有字段掩盖", () => {
    const d = diagnoseReferenceQuery({ ...query, specClass: "III" }, [{ ...row, productThermalResistance: undefined }, { ...row, specClass: "I" }], "THERMAL_ROW");
    expect(d.missingMetrics).toEqual(["PRODUCT_R"]); expect(d.issues).toEqual(["METRIC_NOT_PROVIDED"]);
  });
  it("解释某指标仍保留其他指标硬条件", () => {
    const d = diagnoseReferenceQuery({ filters: [...query.filters!, { metric: "K", targetValue: .2, mode: "MAX_LIMIT" }] },
      [row, { ...row, kValue: .9, productThermalResistance: 99 }], "JOINT");
    expect(d.metricScopes.find(s => s.metric === "PRODUCT_R")?.values).toEqual([5]);
  });
  it("数值不满足和字段不存在分开，解释值不提升成命中", () => {
    const d = diagnoseReferenceQuery(query, [row], "JOINT");
    expect(d.matchedCount).toBe(0); expect(d.missingMetrics).toEqual([]); expect(d.issues).toEqual(["NO_MATCHING_VALUE"]);
    expect(renderReferenceQueryDiagnostics(d)).toContain("未作为命中");
  });
  it("部分值及覆盖范围显式说明，不能宣称全库不存在", () => {
    const d = diagnoseReferenceQuery(query, Array.from({ length: 12 }, (_, i) => ({ ...row, productThermalResistance: i + 1 })), "JOINT");
    expect(d.metricScopes[0]).toMatchObject({ count: 12, truncated: true, rowCount: 12 });
    expect(renderReferenceQueryDiagnostics(d)).toContain("仅列前 8 种"); expect(renderReferenceQueryDiagnostics(d)).toContain("未发布、不可访问及未确认资料不在本次范围");
  });
  it("无可读数据不伪称无目标值；结构化冲突优先说明", () => {
    expect(diagnoseReferenceQuery(query, [], "JOINT").issues).toEqual(["NO_READABLE_PUBLISHED_DATA"]);
    expect(diagnoseReferenceQuery({ ...query, unresolved: [{ field: "conflict:K", reason: "边界冲突" }] }, [row], "JOINT").issues).toEqual(["CONDITIONS_CONFLICT"]);
  });
  it("无可靠体系的提案不猜测成目标值未命中", () => {
    const d = diagnoseReferenceQuery({ unresolved: [{ field: "systemHint", reason: "待确认" }] }, [row], "JOINT");
    expect(d.issues).toEqual(["QUERY_UNRESOLVED"]); expect(d.metricScopes).toEqual([]);
  });
});

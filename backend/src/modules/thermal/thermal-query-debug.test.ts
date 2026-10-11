import { describe, expect, it, vi } from "vitest";
import { buildThermalQueryDebug, logThermalQueryDebug, summarizeThermalQueryDebug, toRejectedCandidateDebug } from "./thermal-query-debug.js";

describe("热工查询诊断快照", () => {
  it("matched=0 但 nearby>0 时给出「差得最少」的失败条件", () => {
    const snapshot = buildThermalQueryDebug({
      query: { intent: "REFERENCE_LOOKUP", systemIds: ["sys-i", "sys-ii"], thicknessMax: 20,
        filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX" }] },
      lifecycle: "CONTINUE_QUERY",
      matchedCount: 0,
      returnedCandidateIds: [],
      nearby: [
        toRejectedCandidateDebug("A1-3", { passed: false, matched: ["systemIds"], failed: ["thicknessMax", "K:0"] }),
        toRejectedCandidateDebug("A4-1", { passed: false, matched: ["systemIds", "thicknessMax"], failed: ["K:0"] })
      ]
    });
    expect(snapshot.counts).toEqual({ matched: 0, nearby: 2, returned: 0 });
    // 只差一个条件的候选排在最前
    expect(snapshot.nearestFailure.map(item => item.id)).toEqual(["A4-1", "A1-3"]);
    expect(snapshot.nearestFailure[0]!.failed).toEqual(["K:0"]);
    expect(snapshot.lifecycle).toBe("CONTINUE_QUERY");
    expect(snapshot.familyHints).toEqual(["sys-i", "sys-ii"]);
    expect(snapshot.queryModes).toEqual([{ metric: "K", mode: "APPROX", targetValue: 0.3, tolerance: 0.02 }]);
  });
  it("有正式命中时不再给 nearestFailure（避免误导）", () => {
    const snapshot = buildThermalQueryDebug({
      query: { filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX" }] },
      matchedCount: 2,
      returnedCandidateIds: ["A1-3", "A1-5"],
      nearby: [toRejectedCandidateDebug("A4-1", { passed: false, matched: [], failed: ["K:0"] })]
    });
    expect(snapshot.counts).toEqual({ matched: 2, nearby: 1, returned: 2 });
    expect(snapshot.nearestFailure).toEqual([]);
  });
  it("把 unresolved 与硬条件完整暴露出来", () => {
    const snapshot = buildThermalQueryDebug({
      query: { schemeId: "sch-1", thicknessMm: 60, unresolved: [{ field: "metric", reason: "产品层热阻还是总热阻" }] }
    });
    expect(snapshot.entities.schemeId).toBe("sch-1");
    expect(snapshot.entities.thicknessMm).toBe("60");
    expect(snapshot.unresolved).toEqual([{ field: "metric", reason: "产品层热阻还是总热阻" }]);
    expect(snapshot.hardConstraints).toContainEqual({ field: "thicknessMm", value: "60" });
  });
  it("单行摘要包含关键字段", () => {
    const summary = summarizeThermalQueryDebug(buildThermalQueryDebug({
      query: { filters: [{ metric: "TOTAL_R", targetValue: 3.3, mode: "MIN_LIMIT" }], thicknessMax: 20 },
      lifecycle: "REFINE_QUERY", matchedCount: 0, nearby: [toRejectedCandidateDebug("A1-3", { passed: false, matched: [], failed: ["thicknessMax"] })]
    }));
    expect(summary).toContain("lifecycle=REFINE_QUERY");
    expect(summary).toContain("TOTAL_R>=3.3");
    expect(summary).toContain("nearby=1");
    expect(summary).toContain("blockedBy=A1-3:thicknessMax");
  });
  it("宿主 logger 缺级别时不影响主流程，且只在无命中但接近时 warn", () => {
    const debug = vi.fn(); const warn = vi.fn();
    const snapshot = buildThermalQueryDebug({ query: { filters: [{ metric: "K", targetValue: 0.3, mode: "APPROX" }] },
      matchedCount: 0, nearby: [toRejectedCandidateDebug("A1-3", { passed: false, matched: [], failed: ["K:0"] })] });
    expect(() => logThermalQueryDebug(undefined, snapshot)).not.toThrow();
    expect(() => logThermalQueryDebug({}, snapshot)).not.toThrow();
    logThermalQueryDebug({ debug, warn }, snapshot);
    expect(debug).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockClear();
    logThermalQueryDebug({ debug, warn }, buildThermalQueryDebug({ query: {}, matchedCount: 1 }));
    expect(warn).not.toHaveBeenCalled();
  });
});

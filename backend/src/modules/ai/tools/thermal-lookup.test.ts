import { describe, expect, it } from "vitest";
import {
  filterCandidatesBySystemHint,
  filterReusableCandidates,
  inheritLookupQuery,
  parseSpecClassHint,
  sanitizeSystemHint
} from "./thermal-lookup.js";
import type { LastReferenceLookup } from "../conversation-task.js";

const last: LastReferenceLookup = {
  query: { targetK: 0.3, systemHint: "薄抹灰" },
  candidates: [
    {
      id: "ii",
      specClass: "II",
      thicknessMm: 55,
      kValue: 0.294,
      systemName: "Ⅱ型VICP复合保温板 + 热固复合聚苯板（G型）薄抹灰外保温系统",
      schemeId: "s2",
      productSpecId: "p2"
    },
    {
      id: "i",
      specClass: "I",
      thicknessMm: 50,
      kValue: 0.3,
      systemName: "薄抹灰外保温",
      schemeId: "s1",
      productSpecId: "p1"
    }
  ],
  createdAt: "2026-09-21T00:00:00.000Z"
};

describe("thermal lookup helpers", () => {
  it("解析 Ⅱ型为 II", () => {
    expect(parseSpecClassHint("Ⅱ型")).toBe("II");
    expect(parseSpecClassHint("III型")).toBe("III");
    expect(parseSpecClassHint("I型")).toBe("I");
  });

  it("追问Ⅱ型优先过滤上一轮候选", () => {
    const reused = filterReusableCandidates(last, { targetK: 0.3, specClass: "II", systemHint: "薄抹灰" });
    expect(reused).toEqual([last.candidates[0]]);
  });

  it("比 0.3 更低的Ⅱ型过滤上一轮 K<= 目标的候选", () => {
    const reused = filterReusableCandidates(last, { targetK: 0.295, specClass: "II", systemHint: "薄抹灰" });
    expect(reused?.map((item) => item.id)).toEqual(["ii"]);
  });

  it("体系提示明显变化时不复用上一轮", () => {
    expect(filterReusableCandidates(last, { targetK: 0.3, systemHint: "岩棉" })).toBeNull();
  });

  it("缺省字段继承上一轮查询，不继承猜测的体系 UUID", () => {
    expect(inheritLookupQuery({ specClass: "II" }, last)).toEqual({
      targetK: 0.3,
      systemHint: "薄抹灰",
      specClass: "II"
    });
    expect(sanitizeSystemHint(" 薄%抹_灰 ")).toBe("薄抹灰");
  });

  it("薄抹灰按名称收窄，猜不中时保留全部候选", () => {
    const narrowed = filterCandidatesBySystemHint(last.candidates, "薄抹灰");
    expect(narrowed).toHaveLength(2);
    const unmatched = filterCandidatesBySystemHint(last.candidates, "屋面");
    expect(unmatched).toHaveLength(2);
  });
});

import { describe, it, expect } from "vitest";
import { sameFrozenPageFacts } from "./readable-page-render.js";
describe("冻结来源的显示投影兼容", () => {
  const original = { pageId: "p", confirmedRevision: "hash", pageLabel: "6", warnings: [], constructions: [{ constructionId: "kp-hash-0", sourceColumns: { kValue: "K" }, sourceTableHeaders: { name: "旧显示" }, options: [{ optionId: "o", kValue: .293 }] }] };
  it("页码勘核与原表表头显示不使历史快照图片失效，也不改写快照", () => {
    const frozen = structuredClone(original), current = structuredClone(original);
    current.pageLabel = "26"; current.constructions[0]!.sourceTableHeaders.name = "客户原表头";
    expect(sameFrozenPageFacts(current, frozen)).toBe(true); expect(frozen).toEqual(original);
  });
  it("任何实际数值、档位或revision变化仍拒绝旧图片", () => {
    for (const changed of [{ ...original, confirmedRevision: "new" }, { ...original, constructions: [{ ...original.constructions[0], options: [{ optionId: "o", kValue: .29 }] }] }, { ...original, pageId: "other" }])
      expect(sameFrozenPageFacts(changed, original)).toBe(false);
  });
});

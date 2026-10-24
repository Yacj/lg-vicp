import { describe, expect, it } from "vitest";
import { hasPublishedReferenceSource, publishedReferenceSource, samePublishedReferenceSource } from "./published-reference-source.js";
import { emptySolution, referenceSolutionCandidate, refreshSolution, applySolutionAction, validateFinalSolution } from "./solution-workflow.js";
const row = { id: "formal-row", setId: "set", setVersion: 1, schemeVersion: 2, specVersion: 3, schemeId: "scheme", productSpecId: "spec", systemId: "system",
  systemName: "正式体系", schemeCode: "FORMAL", evidenceSource: "已发布参考集", evidenceRef: "Sheet1", thicknessMm: 25, kValue: .2322, productThermalResistance: 4, totalThermalResistance: 4.3068 };
describe("正式参考行独立来源证明（不伪造原图/文档）", () => {
  it("数据库JSONB属性重排不改变证明；任一合同字段变化仍拒绝", () => {
    const proof = publishedReferenceSource(row)!;
    expect(samePublishedReferenceSource(proof, Object.fromEntries(Object.entries(proof).reverse()))).toBe(true);
    for (const key of Object.keys(proof) as (keyof typeof proof)[]) {
      const value = proof[key];
      expect(samePublishedReferenceSource(proof, { ...proof, [key]: typeof value === "number" ? value + 1 : `${value}changed` })).toBe(false);
    }
    expect(samePublishedReferenceSource(proof, { ...proof, extra: true })).toBe(false);
  });
  it("完整发布行冻结身份、各参数版本、值和Sheet来源，Final准入不补图页", () => {
    const candidate = { ...row, publishedReferenceSource: publishedReferenceSource(row) };
    expect(hasPublishedReferenceSource(candidate)).toBe(true);
    const saved = referenceSolutionCandidate(candidate);
    const state = applySolutionAction(refreshSolution(emptySolution(), {}, [saved]), { action: "SET_FINAL", candidateIds: [row.id], expectedVersion: 1 });
    expect(validateFinalSolution(state)).toEqual([saved]);
    expect(saved.sourcePageId).toBeUndefined(); expect(saved.optionId).toBeUndefined(); expect(saved.sourceDocumentId).toBeUndefined();
  });
  it("缺正式身份/版本/来源及有文档却没绑定页的行不能取得这种独立来源证明", () => {
    for (const patch of [{ schemeId: undefined }, { productSpecId: undefined }, { setId: undefined }, { setVersion: 0 }, { schemeVersion: undefined }, { specVersion: undefined }, { evidenceRef: "" }, { sourceDocumentId: "unbound-document" }])
      expect(publishedReferenceSource({ ...row, ...patch })).toBeUndefined();
  });
  it("任何版本、数值、归属或来源变化都会使旧指纹失效", () => {
    const proof = publishedReferenceSource(row);
    for (const patch of [{ kValue: .1 }, { totalThermalResistance: 9 }, { thicknessMm: 35 }, { setVersion: 2 }, { schemeVersion: 3 }, { specVersion: 4 }, { evidenceRef: "Sheet2" }, { productSpecId: "other" }])
      expect(hasPublishedReferenceSource({ ...row, ...patch, publishedReferenceSource: proof })).toBe(false);
    expect(hasPublishedReferenceSource({ ...row, publishedReferenceSource: { ...proof, contentHash: "a".repeat(64) } })).toBe(false);
    expect(hasPublishedReferenceSource(row)).toBe(false);
  });
});

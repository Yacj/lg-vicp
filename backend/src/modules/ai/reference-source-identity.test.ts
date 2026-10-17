import "dotenv/config";
import { describe, expect, it } from "vitest";
import { sameReferenceConstruction } from "./reference-source-identity.js";
import { detectReferenceSourceConflicts } from "./thermal-answer-validation.js";
import type { ReferenceLookupCandidate } from "./conversation-task.js";
const formal: ReferenceLookupCandidate = { id: "row", sourceDocumentId: "doc", sourceVersionId: "v", sourcePageId: "p", systemId: "sys", schemeId: "scheme", productSpecId: "spec",
  schemeCode: "A1-1", specClass: "III", substrateMaterial: "混凝土", substrateThickness: 200, thicknessMm: 35, kValue: .2 };
const page: ReferenceLookupCandidate = { ...formal, id: "option", optionId: "option", referenceKind: "KNOWLEDGE_PAGE", kValue: .25 };
describe("来源关联必须有完整身份证据", () => {
  it("明确同页同版本正式映射可比较来源冲突", () => { expect(sameReferenceConstruction(formal, page)).toBe(true); expect(detectReferenceSourceConflicts([formal, page])).toHaveLength(1); });
  it.each([{ systemId: "other" }, { schemeId: "other" }, { productSpecId: "other" }, { specClass: "I" as const }, { substrateMaterial: "砖墙" },
    { sourceVersionId: "old" }, { sourcePageId: "other" }, { thicknessMm: 20 }, { placement: "INVERTED" }])("同编号同值仍不能合并不同身份：%j", patch => {
    const a = { ...formal, placement: "UPRIGHT" };
    const b = { ...page, ...patch };
    expect(sameReferenceConstruction(a, b)).toBe(false); expect(detectReferenceSourceConflicts([a, b])).toEqual([]);
  });
  it("只有编号/数值，没有来源身份时不判冲突", () => {
    expect(detectReferenceSourceConflicts([{ id: "a", schemeCode: "A1-1", thicknessMm: 35, kValue: .2 },
      { id: "b", referenceKind: "KNOWLEDGE_PAGE", constructionCode: "A1-1", thicknessMm: 35, kValue: .3 }])).toEqual([]);
  });
  it("已绑定optionId不同、过期或多处映射均不能反选", () => {
    expect(sameReferenceConstruction({ ...formal, optionId: "old" }, page)).toBe(false);
    expect(detectReferenceSourceConflicts([formal, page, { ...page, id: "second", optionId: "second" }])).toEqual([]);
  });
  it("同一已证明映射的多条正式行分别核对，不静默只取第一条", () => {
    const conflicts = detectReferenceSourceConflicts([formal, { ...formal, id: "second", kValue: .3 }, page]);
    expect(conflicts.map(c => c.thermalRow)).toEqual([.2, .3]);
  });
});

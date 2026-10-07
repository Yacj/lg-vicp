import { describe, expect, it } from "vitest";
import { buildHighlights, buildReferencePageBlocks, REFERENCE_PAGE_MISSING_NOTE } from "./reference-page.js";

const overall = {
  id: "row-overall",
  systemName: "外墙外保温",
  schemeCode: "VICP-OVERALL",
  productName: "VICP复合保温板",
  thicknessMm: 25,
  productThermalResistance: 4,
  totalThermalResistance: 4.306822098,
  kValue: 0.2321897625,
  sourceDocumentId: "doc-1",
  sourcePageId: "page-1",
  sourcePageLabel: "1"
};

describe("REFERENCE_PAGE", () => {
  it("无坐标时仍返回参数条", () => {
    const highlights = buildHighlights(overall);
    expect(highlights.map((item) => item.field)).toEqual(["thicknessMm", "productR", "rValue", "kValue"]);
    expect(highlights.every((item) => !("rect" in item))).toBe(true);
  });

  it("有页图时返回一张 REFERENCE_PAGE", () => {
    const built = buildReferencePageBlocks([overall], [{
      pageId: "page-1",
      documentId: "doc-1",
      documentTitle: "VICP热工计算参考表",
      pageNumber: 1,
      pageLabel: "1",
      pageImageObjectKey: "knowledge/previews/p1.png",
      imageUrl: "https://example.test/p1.png"
    }]);
    expect(built.blocks).toHaveLength(1);
    expect(built.blocks[0]?.type).toBe("REFERENCE_PAGE");
    expect(built.blocks[0]?.page.imageUrl).toContain("p1.png");
    expect(built.blocks[0]?.summary.kValue).toBe(0.2321897625);
    expect(built.blocks[0]?.summary.productThermalResistance).toBe(4);
    expect(built.blocks[0]?.summary.totalThermalResistance).toBe(4.306822098);
    expect(built.blocks[0]?.summary.rValue).toBe(4.306822098);
    expect(built.missingPage).toBe(false);
  });

  it("同一页多个命中只保留一张图，并按 matches 分组参数", () => {
    const built = buildReferencePageBlocks([
      overall,
      { ...overall, id: "row-2", thicknessMm: 35, kValue: 0.1884366918, totalThermalResistance: 5.306822098 }
    ], [{
      pageId: "page-1",
      documentId: "doc-1",
      documentTitle: "参考表",
      physicalPageNumber: 1,
      pageNumber: 1,
      pageImageObjectKey: "k",
      imageUrl: "https://example.test/p.png"
    }]);
    expect(built.blocks).toHaveLength(1);
    expect(built.blocks[0]?.matches).toHaveLength(2);
    expect(built.blocks[0]?.matches[0]?.highlights.map((item) => item.field)).toEqual([
      "thicknessMm", "productR", "rValue", "kValue"
    ]);
    expect(built.blocks[0]?.matches[1]?.summary.thicknessMm).toBe(35);
    expect(built.blocks[0]?.highlights.length).toBeGreaterThan(4);
    expect(built.stored[0]?.matches).toHaveLength(2);
  });

  it("physicalPageNumber 优先使用真实字段", () => {
    const built = buildReferencePageBlocks([overall], [{
      pageId: "page-1",
      documentId: "doc-1",
      documentTitle: "参考表",
      physicalPageNumber: 103,
      pageNumber: 5,
      pageLabel: "A5",
      pageImageObjectKey: "k",
      imageUrl: "https://example.test/p.png"
    }]);
    expect(built.blocks[0]?.page.physicalPageNumber).toBe(103);
    expect(built.blocks[0]?.page.pageNumber).toBe(103);
    expect(built.stored[0]?.physicalPageNumber).toBe(103);
  });

  it("没有页图时不伪造 REFERENCE_PAGE", () => {
    const built = buildReferencePageBlocks([{ ...overall, sourcePageId: null }], []);
    expect(built.blocks).toEqual([]);
    expect(built.missingPage).toBe(true);
    expect(REFERENCE_PAGE_MISSING_NOTE).toContain("尚未关联原始页面");
  });

  it("最多返回 3 个不同页面", () => {
    const candidates = [1, 2, 3, 4].map((index) => ({
      ...overall,
      id: `row-${index}`,
      sourcePageId: `page-${index}`
    }));
    const pages = candidates.map((item, index) => ({
      pageId: item.sourcePageId!,
      documentId: "doc-1",
      documentTitle: "参考表",
      pageNumber: index + 1,
      pageImageObjectKey: `k-${index}`,
      imageUrl: `https://example.test/${index}.png`
    }));
    expect(buildReferencePageBlocks(candidates, pages).blocks).toHaveLength(3);
  });
});

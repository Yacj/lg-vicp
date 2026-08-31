import { describe, expect, it } from "vitest";
import { buildPageMappings, normalizeMappingTitle } from "./knowledge-page-mapping.js";

/**
 * 检索页 → 原文页映射测试（Case B：转曲印刷件 + 配套检索源）：
 * 禁止按物理页硬对齐；优先级 TOC 标题 → 插值/边缘补齐 → 页数相等恒等兜底。
 */

describe("normalizeMappingTitle", () => {
  it("全角/空白/大小写折叠", () => {
    expect(normalizeMappingTitle("　A  VICP 薄抹灰外保温系统 ")).toBe(normalizeMappingTitle("a vicp 薄抹灰外保温系统"));
  });
});

describe("buildPageMappings", () => {
  const originalPages = [
    { physical: 1, label: "1" },
    { physical: 2, label: "2" },
    { physical: 3, label: "3" },
    { physical: 4, label: "A1" },
    { physical: 5, label: "A5" }
  ];

  it("TOC 标题对齐：检索源书签命中原文 TOC 条目（pageLabel 反查物理页）", () => {
    const mappings = buildPageMappings({
      originalPages,
      searchTotalPages: 5,
      tocItems: [
        { title: "A VICP薄抹灰外保温系统", pageLabel: "A1", physicalPageNumber: null },
        { title: "基本构造", pageLabel: "A5", physicalPageNumber: 5 }
      ],
      searchOutline: [
        { title: "A VICP 薄抹灰外保温系统", pageNumber: 3 },
        { title: "基本构造", pageNumber: 5 }
      ]
    });
    const bySearch = new Map(mappings.map((m) => [m.searchPhysicalPageNumber, m]));
    expect(bySearch.get(3)).toMatchObject({ originalPhysicalPageNumber: 4, mappingMethod: "TOC_TITLE", confidence: 0.9, pageLabel: "A1" });
    expect(bySearch.get(5)).toMatchObject({ originalPhysicalPageNumber: 5, mappingMethod: "TOC_TITLE" });
    // 锚点之间线性插值（4 → 5 之间）
    expect(bySearch.get(4)).toMatchObject({ originalPhysicalPageNumber: 5, mappingMethod: "PAGE_LABEL" });
  });

  it("无锚点且页数相等：恒等映射兜底（低置信，verified=false 待人工）", () => {
    const mappings = buildPageMappings({
      originalPages: [{ physical: 1, label: "1" }, { physical: 2, label: "2" }],
      searchTotalPages: 2,
      tocItems: [],
      searchOutline: []
    });
    expect(mappings).toHaveLength(2);
    expect(mappings.every((m) => m.mappingMethod === "PAGE_LABEL" && m.confidence === 0.3)).toBe(true);
    expect(mappings.map((m) => m.originalPhysicalPageNumber)).toEqual([1, 2]);
  });

  it("无锚点且页数不等：不产生任何自动映射（禁止硬对齐，留给人工）", () => {
    const mappings = buildPageMappings({
      originalPages: [{ physical: 1, label: "1" }],
      searchTotalPages: 12,
      tocItems: [],
      searchOutline: []
    });
    expect(mappings).toEqual([]);
  });

  it("首锚点之前的页映射到首锚点原文页（边缘补齐，保证内容有归属）", () => {
    const mappings = buildPageMappings({
      originalPages,
      searchTotalPages: 6,
      tocItems: [{ title: "基本构造", pageLabel: "A5", physicalPageNumber: 5 }],
      searchOutline: [{ title: "基本构造", pageNumber: 4 }]
    });
    const bySearch = new Map(mappings.map((m) => [m.searchPhysicalPageNumber, m]));
    expect(bySearch.get(1)).toMatchObject({ originalPhysicalPageNumber: 5, confidence: 0.15 });
    expect(bySearch.get(4)).toMatchObject({ originalPhysicalPageNumber: 5, mappingMethod: "TOC_TITLE" });
    expect(bySearch.get(6)).toMatchObject({ originalPhysicalPageNumber: 5 });
  });
});

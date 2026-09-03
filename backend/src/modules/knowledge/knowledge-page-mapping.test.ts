import { describe, expect, it } from "vitest";
import { buildPageMappings, normalizeMappingTitle } from "./knowledge-page-mapping.js";

/** 双源页映射只接受明确证据；无证据的物理页相同、插值和边缘填充都不能进入 AI 索引。 */
describe("normalizeMappingTitle", () => {
  it("全角、空白与大小写折叠", () => {
    expect(normalizeMappingTitle("　A  VICP 薄抹灰外保温系统 "))
      .toBe(normalizeMappingTitle("a vicp 薄抹灰外保温系统"));
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

  it("以书签标题和原文 TOC 的明确页签定位", () => {
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
    expect(mappings).toEqual([
      expect.objectContaining({ searchPhysicalPageNumber: 3, originalPhysicalPageNumber: 4, mappingMethod: "TOC_TITLE", confidence: 0.9, pageLabel: "A1" }),
      expect.objectContaining({ searchPhysicalPageNumber: 5, originalPhysicalPageNumber: 5, mappingMethod: "TOC_TITLE", confidence: 0.9 })
    ]);
  });

  it("精确页签优先于其他自动候选", () => {
    const mappings = buildPageMappings({
      originalPages,
      searchPages: [{ physical: 7, label: "A5" }],
      searchTotalPages: 7,
      tocItems: [],
      searchOutline: []
    });
    expect(mappings).toEqual([
      expect.objectContaining({ searchPhysicalPageNumber: 7, originalPhysicalPageNumber: 5, mappingMethod: "PAGE_LABEL", confidence: 0.98 })
    ]);
  });

  it("无锚点时不按相同页数恒等映射，也不进行边缘或线性补齐", () => {
    expect(buildPageMappings({
      originalPages: [{ physical: 1, label: "1" }, { physical: 2, label: "2" }],
      searchTotalPages: 2,
      tocItems: [],
      searchOutline: []
    })).toEqual([]);
    expect(buildPageMappings({
      originalPages,
      searchTotalPages: 6,
      tocItems: [{ title: "基本构造", pageLabel: "A5", physicalPageNumber: 5 }],
      searchOutline: [{ title: "基本构造", pageNumber: 4 }]
    })).toEqual([
      expect.objectContaining({ searchPhysicalPageNumber: 4, originalPhysicalPageNumber: 5, mappingMethod: "TOC_TITLE" })
    ]);
  });

  it("接受唯一且达到最低分数的视觉候选", () => {
    const mappings = buildPageMappings({
      originalPages,
      searchTotalPages: 3,
      tocItems: [],
      searchOutline: [],
      visualMatches: [{ searchPhysicalPageNumber: 2, originalPhysicalPageNumber: 4, confidence: 0.91 }]
    });
    expect(mappings).toEqual([
      expect.objectContaining({ searchPhysicalPageNumber: 2, originalPhysicalPageNumber: 4, mappingMethod: "VISUAL_MATCH", confidence: 0.91 })
    ]);
  });
});

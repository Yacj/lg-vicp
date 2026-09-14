import { describe, expect, it } from "vitest";
import {
  buildPrintedPageLabelMap,
  detectFooterPageLabel,
  detectPrintedPageLabel,
  fallbackPageLabel,
  isReliablePageLabel,
  pageLabelMappingStatus,
  resolveTocPhysicalPage
} from "./knowledge-page-label.js";

describe("detectFooterPageLabel", () => {
  it("只识别页面底部的字符串印刷页码", () => {
    expect(detectFooterPageLabel([
      { text: "基本构造", x: 60, y: 600, width: 80, height: 12 },
      { text: "A5", x: 280, y: 20, width: 16, height: 10 }
    ], 700)).toEqual({ pageLabel: "A5", confidence: 0.82 });
  });

  it("忽略图纸元数据和非页脚候选", () => {
    expect(detectFooterPageLabel([
      { text: "图集号 22J01", x: 20, y: 15, width: 80, height: 10 },
      { text: "比例 1:100", x: 160, y: 15, width: 60, height: 10 },
      { text: "D16", x: 300, y: 650, width: 20, height: 10 }
    ], 700)).toBeNull();
  });

  it("支持纯数字页码，回退明确标为 FALLBACK", () => {
    expect(detectFooterPageLabel([
      { text: "21", x: 280, y: 8, width: 12, height: 10 }
    ], 700)).toEqual({ pageLabel: "21", confidence: 0.82 });
    expect(fallbackPageLabel(103)).toEqual({
      pageLabel: "103", pageLabelSource: "FALLBACK", pageLabelConfidence: null, pageLabelVerified: false
    });
  });

  it("可靠性不把 FALLBACK 误当作已识别页签", () => {
    expect(isReliablePageLabel("FALLBACK", null, false, 0.85)).toBe(false);
    expect(isReliablePageLabel("PDF_PAGE_LABEL", 1, false, 0.85)).toBe(true);
    expect(isReliablePageLabel("MANUAL", null, true, 0.85)).toBe(true);
  });
});

describe("detectPrintedPageLabel", () => {
  it("优先使用图框「页次」右侧标签，而不是物理页号", () => {
    expect(detectPrintedPageLabel([
      { text: "页 次", x: 585, y: 57, width: 19, height: 10 },
      { text: "4", x: 643, y: 57, width: 4, height: 10 },
      { text: "总说明", x: 466, y: 62, width: 46, height: 12 }
    ], 524)).toEqual({ pageLabel: "4", confidence: 0.9 });
  });
});

describe("buildPrintedPageLabelMap", () => {
  it("忽略 FALLBACK，不把 TOC 的 4 映射到物理第 4 页", () => {
    const map = buildPrintedPageLabelMap([
      { physical: 4, label: "4", source: "FALLBACK", confidence: null },
      { physical: 6, label: "4", source: "FOOTER_TEXT", confidence: 0.9 },
      { physical: 103, label: "A5", source: "FOOTER_TEXT", confidence: 0.9 }
    ]);
    expect(map.get("4")).toBe(6);
    expect(map.get("A5")).toBe(103);
    expect(resolveTocPhysicalPage("A5", map)).toBe(103);
    expect(pageLabelMappingStatus({ source: "FOOTER_TEXT", confidence: 0.9 })).toBe("HIGH_CONFIDENCE");
    expect(pageLabelMappingStatus({ source: "FALLBACK", confidence: null })).toBe("UNMAPPED");
  });
});

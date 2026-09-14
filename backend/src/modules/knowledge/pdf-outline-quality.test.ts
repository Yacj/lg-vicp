import { describe, expect, it } from "vitest";
import { detectRepeatedTreePattern, validatePdfOutline } from "./pdf-outline-quality.js";

describe("validatePdfOutline", () => {
  it("拒绝 CAD 每页重复的「图纸和视图 / 模型」导航树", () => {
    const outline = Array.from({ length: 194 }, (_, index) => ([
      { title: "图纸和视图", level: 1, pageNumber: null as number | null },
      { title: "模型", level: 2, pageNumber: index + 1 }
    ])).flat();
    const result = validatePdfOutline(outline, 194);
    expect(result.valid).toBe(false);
    expect(result.metrics.uniqueTitleCount).toBe(2);
    expect(result.metrics.repeatedTreePattern).toBe(true);
    expect(result.reasons).toEqual(expect.arrayContaining([
      "UNIQUE_TITLE_RATIO_VERY_LOW",
      "REPEATED_TREE_PATTERN",
      "SOFTWARE_NAV_TITLES"
    ]));
  });

  it("接受条目少、标题多样且可定位的真实书签", () => {
    const result = validatePdfOutline([
      { title: "总说明", level: 1, pageNumber: 6 },
      { title: "建筑外墙热工计算参考选用表", level: 1, pageNumber: 23 },
      { title: "A VICP薄抹灰外保温系统", level: 1, pageNumber: 99 }
    ], 194);
    expect(result.valid).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });

  it("空大纲无效但不误报软件导航", () => {
    expect(validatePdfOutline([], 10)).toMatchObject({ valid: false, reasons: ["EMPTY_OUTLINE"] });
  });
});

describe("detectRepeatedTreePattern", () => {
  it("识别短周期重复", () => {
    expect(detectRepeatedTreePattern(Array.from({ length: 20 }, (_, index) => (index % 2 === 0 ? "图纸和视图" : "模型")))).toBe(true);
    expect(detectRepeatedTreePattern(["总说明", "选用表", "外保温", "内保温", "屋面", "夹芯板", "附录", "索引"])).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  detectTocPages,
  parseSectionHeaderLine,
  parseTocFromPageTexts,
  parseTocLeaderLine
} from "./pdf-toc-page.js";

describe("parseTocLeaderLine", () => {
  it("解析图集点线目录行，保留字母页码", () => {
    expect(parseTocLeaderLine("总说明¨¨¨¨¨¨¨¨¨¨¨¨4")).toEqual({ title: "总说明", pageLabel: "4" });
    expect(parseTocLeaderLine("建筑外墙热工计算参考选用表¨¨¨¨¨¨21")).toEqual({
      title: "建筑外墙热工计算参考选用表",
      pageLabel: "21"
    });
    expect(parseTocLeaderLine("VICP薄抹灰外保温系统部分说明¨¨¨¨¨¨A1")).toEqual({
      title: "VICP薄抹灰外保温系统部分说明",
      pageLabel: "A1"
    });
    expect(parseTocLeaderLine("VICP薄抹灰外保温系统基本构造¨¨¨¨A5")).toEqual({
      title: "VICP薄抹灰外保温系统基本构造",
      pageLabel: "A5"
    });
  });

  it("正文中偶然出现的页码不算目录行", () => {
    expect(parseTocLeaderLine("本图集适用于高度小于100m的建筑 4")).toBeNull();
  });
});

describe("parseSectionHeaderLine", () => {
  it("识别 A/B 分章父节点，不把 A VICP 误压成 AVICP", () => {
    expect(parseSectionHeaderLine("A VICP薄抹灰外保温系统")).toEqual({
      title: "A VICP薄抹灰外保温系统"
    });
    expect(parseSectionHeaderLine("H VICP金属面夹芯板系统")).toEqual({
      title: "H VICP金属面夹芯板系统"
    });
    expect(parseSectionHeaderLine("总说明¨¨¨4")).toBeNull();
  });
});

describe("parseTocFromPageTexts", () => {
  const tocText = [
    "目录",
    "目录¨¨¨¨¨¨1",
    "总说明¨¨¨¨¨¨4",
    "建筑外墙热工计算参考选用表¨¨¨¨¨¨21",
    "A VICP薄抹灰外保温系统",
    "VICP薄抹灰外保温系统部分说明¨¨¨¨¨¨A1",
    "VICP薄抹灰外保温系统基本构造¨¨¨¨¨¨A5",
    "VICP薄抹灰外保温系统阴阳角构造¨¨¨¨¨¨A6",
    "VICP薄抹灰外保温系统窗洞口构造¨¨¨¨¨¨A7",
    "B VICP薄抹灰内保温系统",
    "VICP薄抹灰内保温系统部分说明¨¨¨¨¨¨B1",
    "C VICP复合保温装饰板保温系统",
    "D VICP保温结构一体化系统",
    "E VICP屋面保温系统",
    "F VICP复合混凝土外墙板系统",
    "G VICP复合加气混凝土板墙体系统",
    "H VICP金属面夹芯板系统"
  ].join("\n");

  it("保留层级：A 为父节点，A1/A5 为子节点，跳过目录自引用", () => {
    const items = parseTocFromPageTexts([tocText]);
    const titles = items.map((item) => item.title);
    expect(titles).not.toContain("图纸和视图");
    expect(titles).not.toContain("模型");
    expect(titles).not.toContain("目录");
    expect(titles).toEqual(expect.arrayContaining([
      "总说明",
      "建筑外墙热工计算参考选用表",
      "A VICP薄抹灰外保温系统",
      "VICP薄抹灰外保温系统部分说明",
      "VICP薄抹灰外保温系统基本构造",
      "B VICP薄抹灰内保温系统",
      "C VICP复合保温装饰板保温系统",
      "D VICP保温结构一体化系统",
      "E VICP屋面保温系统",
      "F VICP复合混凝土外墙板系统",
      "G VICP复合加气混凝土板墙体系统",
      "H VICP金属面夹芯板系统"
    ]));
    const parent = items.find((item) => item.title === "A VICP薄抹灰外保温系统");
    const child = items.find((item) => item.title.includes("基本构造"));
    expect(parent).toMatchObject({ level: 1, pageLabel: null });
    expect(child).toMatchObject({ level: 2, pageLabel: "A5" });
    expect(items.find((item) => item.pageLabel === "A1")?.level).toBe(2);
    expect(items.find((item) => item.pageLabel === "A7")?.level).toBe(2);
  });
});

describe("detectTocPages", () => {
  it("需要目录标题 + 点线页码，不把正文里的「目录」当目录页", () => {
    const pages = [
      { physical: 1, text: "图集编审名单\n主编单位" },
      { physical: 2, text: "目 录\n总说明¨¨¨¨4\n建筑外墙热工计算参考选用表¨¨¨¨21\nA VICP薄抹灰外保温系统\n部分说明¨¨¨¨A1\n基本构造¨¨¨¨A5\n阴阳角构造¨¨¨¨A6\n窗洞口构造¨¨¨¨A7\n凸窗构造¨¨¨¨A8" },
      { physical: 3, text: "B VICP薄抹灰内保温系统\n部分说明¨¨¨¨B1\n基本构造¨¨¨¨B3\n窗洞口构造¨¨¨¨B4\n凸窗构造¨¨¨¨B5\n热桥构造¨¨¨¨B6\nC VICP复合保温装饰板保温系统\n部分说明¨¨¨¨C1" },
      { physical: 6, text: "一、概述\n本图集目录仅供参考。\n二、编制依据" }
    ];
    expect(detectTocPages(pages)).toEqual([2, 3]);
  });
});

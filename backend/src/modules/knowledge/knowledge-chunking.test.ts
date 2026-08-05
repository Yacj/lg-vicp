import { describe, expect, it } from "vitest";
import {
  buildChunksFromPages,
  buildChunksFromSheet,
  detectHeading,
  detectTableRegions,
  extractAnchors,
  extractKeywords,
  splitText
} from "./knowledge-chunking.js";

describe("章节标题检测", () => {
  it("识别第X章", () => {
    expect(detectHeading("第3章 外墙外保温系统")).toMatchObject({ level: 1, title: "外墙外保温系统", isClause: false });
  });

  it("识别数字编号并推算层级", () => {
    expect(detectHeading("1.1 一般规定")?.level).toBe(2);
    expect(detectHeading("1.1.2 材料要求")?.level).toBe(3);
  });

  it("识别第X条", () => {
    expect(detectHeading("第4.1.2条 保温板厚度")?.level).toBe(3);
  });

  it("识别第X条为条款标题", () => {
    const heading = detectHeading("第4.1.2条 保温板应采用专用锚栓固定，间距不应大于600mm");
    expect(heading?.isClause).toBe(true);
    expect(heading?.anchor).toBe("第4.1.2条");
    expect(heading?.title).toContain("保温板应采用");
  });

  it("普通正文行不识别为标题", () => {
    expect(detectHeading("真空绝热复合保温板应采用专用锚栓固定。")).toBeNull();
    expect(detectHeading("")).toBeNull();
  });
});

describe("引用锚点提取", () => {
  it("提取表格、图片与条款编号", () => {
    const anchors = extractAnchors("参见表3.2-1及图4-1，并按第4.1.2条执行");
    expect(anchors).toContain("表3.2-1");
    expect(anchors).toContain("图4-1");
    expect(anchors).toContain("第4.1.2条");
  });

  it("无锚点返回空数组", () => {
    expect(extractAnchors("普通正文内容")).toEqual([]);
  });
});

describe("别名词典关键词提取", () => {
  const aliases = [
    { term: "真空绝热复合保温板", alias: "VICP" },
    { term: "真空绝热复合保温板", alias: "真空绝热板" }
  ];

  it("命中别名记录原文并将规范词写入关键词", () => {
    const result = extractKeywords("本项目采用 VICP 保温板", aliases);
    expect(result.aliasTerms).toContain("VICP");
    expect(result.keywords).toContain("真空绝热复合保温板");
  });

  it("同规范词不重复写入", () => {
    const result = extractKeywords("VICP 与真空绝热板均为同一材料", aliases);
    expect(result.keywords).toEqual(["真空绝热复合保温板"]);
    expect(result.aliasTerms).toHaveLength(2);
  });

  it("未命中不产生关键词", () => {
    expect(extractKeywords("岩棉板性能对比", aliases)).toEqual({ keywords: [], aliasTerms: [] });
  });
});

describe("按页构建分块", () => {
  it("正文切块继承页码与章节路径", () => {
    const chunks = buildChunksFromPages([
      { page: 1, text: "第1章 总则\n本章适用于建筑外墙外保温工程的设计与施工。" }
    ]);
    const title = chunks.find((chunk) => chunk.contentType === "TITLE");
    const body = chunks.find((chunk) => chunk.contentType === "SECTION");
    expect(title?.sourcePage).toBe(1);
    expect(title?.headingLevel).toBe(1);
    expect(body?.sourceSection).toBe("总则");
    expect(body?.searchText).toBe("本章适用于建筑外墙外保温工程的设计与施工。");
  });

  it("条款行整行保留为 CLAUSE 块", () => {
    const chunks = buildChunksFromPages([
      { page: 1, text: "第1章 总则\n第4.1.2条 保温板应采用专用锚栓固定，间距不应大于600mm。" }
    ]);
    const clause = chunks.find((chunk) => chunk.contentType === "CLAUSE");
    expect(clause?.content).toContain("保温板应采用专用锚栓固定");
    expect(clause?.content.length).toBeGreaterThan(30);
    expect(clause?.citationAnchor).toBe("第4.1.2条");
  });

  it("超长页文本按边界切分为多块", () => {
    const source = Array.from({ length: 90 }, (_, index) => `建筑节能资料第${index + 1}项，请按照条文要求执行并记录。`).join("\n");
    expect(source.length).toBeGreaterThan(1200);
    const chunks = buildChunksFromPages([{ page: 1, text: source }]);
    expect(chunks.filter((chunk) => chunk.contentType === "PARAGRAPH").length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= 1200)).toBe(true);
  });

  it("别名命中写入分块", () => {
    const chunks = buildChunksFromPages(
      [{ page: 2, text: "VICP 板导热系数满足设计要求。" }],
      [{ term: "真空绝热复合保温板", alias: "VICP" }]
    );
    expect(chunks[0].aliasTerms).toContain("VICP");
    expect(chunks[0].keywords).toContain("真空绝热复合保温板");
  });

  it("空页面不生成分块", () => {
    expect(buildChunksFromPages([{ page: 1, text: "  " }])).toEqual([]);
  });
});

describe("splitText 兼容行为", () => {
  it("空白文本不生成切片", () => {
    expect(splitText("  \n\n  ")).toEqual([]);
  });
});

describe("表格区域检测（PDF/DOCX 文本流）", () => {
  const tablePage = [
    "第3章 热工性能",
    "表3.2-1 VICP板热工参数表",
    "厚度(mm)    导热系数    修正系数",
    "120    0.008    1.0",
    "140    0.008    1.0",
    "注：导热系数为干态实测值。",
    "本工程应按表3.2-1选用。"
  ];

  it("识别表标题起始的连续表格行区间", () => {
    const regions = detectTableRegions(tablePage);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.anchor).toBe("表3.2-1");
    expect(regions[0]?.startLine).toBe(1);
    expect(regions[0]?.endLine).toBe(5);
  });

  it("表格行不与相邻条文混为一块", () => {
    const chunks = buildChunksFromPages([{ page: 1, text: tablePage.join("\n") }]);
    const table = chunks.find((chunk) => chunk.contentType === "TABLE");
    expect(table).toBeDefined();
    expect(table?.content).toContain("表3.2-1 VICP板热工参数表");
    expect(table?.content).toContain("120");
    expect(table?.content).not.toContain("本工程应按表3.2-1选用");
    expect(table?.citationAnchor).toBe("表3.2-1");
    const body = chunks.find((chunk) => chunk.contentType === "SECTION" && chunk.content.includes("本工程应按"));
    expect(body).toBeDefined();
  });

  it("无表格锚点的纯条文页不产生表格块", () => {
    expect(detectTableRegions(["第1章 总则", "本章适用于外墙外保温工程。"])).toEqual([]);
  });
});

describe("电子表格分块构建（XLSX）", () => {
  it("每行一个 TABLE 块并保留行列与合并单元格元数据", () => {
    const chunks = buildChunksFromSheet({
      name: "热工参数",
      rows: [
        [{ col: 0, value: "厚度" }, { col: 1, value: "导热系数" }],
        [{ col: 0, value: "120" }, { col: 1, value: "0.008" }],
        [{ col: 0, value: "140" }, { col: 1, value: "0.008" }]
      ],
      // 0-based：合并行 1-2、列 0-1
      mergedCells: [{ rowStart: 1, rowEnd: 2, colStart: 0, colEnd: 1 }]
    });
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.contentType).toBe("TABLE");
    expect(chunks[0]?.sourceSection).toBe("热工参数");
    expect(chunks[0]?.content).toBe("厚度\t导热系数");
    expect(chunks[0]?.metadata).toMatchObject({ sheet: "热工参数", rowIndex: 0 });
    expect(chunks[0]?.metadata?.mergedCells).toEqual([]);
    expect(chunks[1]?.metadata?.mergedCells).toEqual([{ rowStart: 1, rowEnd: 2, colStart: 0, colEnd: 1 }]);
  });

  it("空行不产生分块", () => {
    expect(buildChunksFromSheet({ name: "空表", rows: [[]], mergedCells: [] })).toEqual([]);
  });

  it("别名命中写入表格分块", () => {
    const chunks = buildChunksFromSheet(
      { name: "材料", rows: [[{ col: 0, value: "VICP板导热系数" }]], mergedCells: [] },
      [{ term: "真空绝热复合保温板", alias: "VICP" }]
    );
    expect(chunks[0]?.aliasTerms).toContain("VICP");
    expect(chunks[0]?.keywords).toContain("真空绝热复合保温板");
  });
});
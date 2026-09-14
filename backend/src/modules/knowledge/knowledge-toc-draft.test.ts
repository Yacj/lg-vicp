import { describe, expect, it } from "vitest";
import { buildKnowledgeTocDraft } from "./knowledge-toc-draft.js";

describe("buildKnowledgeTocDraft", () => {
  it("CAD 噪声 Outline 被拒绝后改走目录页，父节点不填物理第 1 页", () => {
    const outline = Array.from({ length: 10 }, (_, index) => ([
      { title: "图纸和视图", level: 1, pageNumber: null as number | null },
      { title: "模型", level: 2, pageNumber: index + 1 }
    ])).flat();
    const draft = buildKnowledgeTocDraft({
      outline,
      pages: [
        { physical: 1, text: "封面", label: null, labelSource: null, labelConfidence: null },
        {
          physical: 2,
          text: [
            "目录",
            "总说明¨¨¨¨4",
            "建筑外墙热工计算参考选用表¨¨¨¨21",
            "A VICP薄抹灰外保温系统",
            "VICP薄抹灰外保温系统部分说明¨¨¨¨A1",
            "VICP薄抹灰外保温系统基本构造¨¨¨¨A5",
            "VICP薄抹灰外保温系统阴阳角构造¨¨¨¨A6",
            "VICP薄抹灰外保温系统窗洞口构造¨¨¨¨A7",
            "B VICP薄抹灰内保温系统",
            "部分说明¨¨¨¨B1"
          ].join("\n"),
          label: "1",
          labelSource: "FOOTER_TEXT",
          labelConfidence: 0.9
        },
        { physical: 6, text: "一、概述", label: "4", labelSource: "FOOTER_TEXT", labelConfidence: 0.9 },
        { physical: 99, text: "部分说明", label: "A1", labelSource: "FOOTER_TEXT", labelConfidence: 0.9 },
        { physical: 103, text: "基本构造", label: "A5", labelSource: "FOOTER_TEXT", labelConfidence: 0.9 }
      ]
    });
    expect(draft.outlineQuality.valid).toBe(false);
    expect(draft.source).toBe("TOC_PAGE");
    expect(draft.items.map((item) => item.title)).not.toContain("图纸和视图");
    expect(draft.items.find((item) => item.title === "总说明")?.physicalPageNumber).toBe(6);
    expect(draft.items.find((item) => item.title.startsWith("A VICP"))).toMatchObject({
      level: 1,
      physicalPageNumber: null
    });
    expect(draft.items.find((item) => item.pageLabel === "A5")?.physicalPageNumber).toBe(103);
  });
});

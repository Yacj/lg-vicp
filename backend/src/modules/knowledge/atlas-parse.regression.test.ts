import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractPdfDocumentInWorker } from "../../workers/pdf-text-extractor.js";
import { buildKnowledgeTocDraft } from "./knowledge-toc-draft.js";

const ATLAS_PDF = process.env.VICP_ATLAS_PDF
  ?? "C:\\Users\\admin\\OneDrive\\桌面\\蓝格\\【图集文本】《真空绝热复合保温板（VICP）外墙保温系统建筑构造图集》(已修改).pdf";

const REQUIRED_TOP_TITLES = [
  "总说明",
  "建筑外墙热工计算参考选用表",
  "A VICP薄抹灰外保温系统",
  "B VICP薄抹灰内保温系统",
  "C VICP复合保温装饰板保温系统",
  "D VICP保温结构一体化系统",
  "E VICP屋面保温系统",
  "F VICP复合混凝土外墙板系统",
  "G VICP复合加气混凝土板墙体系统",
  "H VICP金属面夹芯板系统"
];

describe.skipIf(!existsSync(ATLAS_PDF))("实际图集 PDF 回归", () => {
  it("拒绝 CAD Outline，从目录页解析真实 TOC，并正确映射 pageLabel", async () => {
    const extraction = await extractPdfDocumentInWorker(readFileSync(ATLAS_PDF));
    const totalText = extraction.pages.reduce((sum, text) => sum + text.trim().length, 0);
    expect(totalText).toBeGreaterThan(1000);
    expect(extraction.pageDetails).toHaveLength(194);

    const uniqueOutlineTitles = [...new Set(extraction.outline.map((item) => item.title))];
    expect(extraction.outline.length).toBeGreaterThan(100);
    expect(uniqueOutlineTitles).toEqual(["图纸和视图", "模型"]);

    const draft = buildKnowledgeTocDraft({
      outline: extraction.outline,
      pages: extraction.pageDetails.map((page) => ({
        physical: page.pageNumber,
        text: page.text,
        label: page.pageLabel,
        labelSource: page.pageLabelSource ?? "FALLBACK",
        labelConfidence: page.pageLabelConfidence
      }))
    });

    expect(draft.outlineQuality.valid).toBe(false);
    expect(draft.source).toBe("TOC_PAGE");
    const titles = draft.items.map((item) => item.title);
    expect(titles).not.toContain("图纸和视图");
    expect(titles).not.toContain("模型");
    for (const title of REQUIRED_TOP_TITLES) {
      expect(titles.some((item) => item === title || item.includes(title.replace(/^[A-H] /, "")))).toBe(true);
    }

    const parentA = draft.items.find((item) => item.title.startsWith("A VICP薄抹灰外保温系统"));
    expect(parentA).toMatchObject({ level: 1, physicalPageNumber: null });

    expect(draft.items.find((item) => item.pageLabel === "A1")?.physicalPageNumber).toBe(99);
    expect(draft.items.find((item) => item.pageLabel === "A5")?.physicalPageNumber).toBe(103);
    expect(draft.items.find((item) => item.pageLabel === "A7")?.physicalPageNumber).toBe(105);

    const page6 = extraction.pageDetails[5]!;
    expect(page6.pageLabel).toBe("4");
    expect(page6.pageLabelSource).toBe("FOOTER_TEXT");
    const general = draft.items.find((item) => item.title === "总说明");
    expect(general?.physicalPageNumber).toBe(6);
    expect(general?.physicalPageNumber).not.toBe(1);

    expect(page6.text).toContain("一、概述");
    expect(page6.text).toContain("二、编制依据");
    expect(page6.text).toContain("三、适用范围");
    expect(page6.text.indexOf("一、概述")).toBeLessThan(page6.text.indexOf("二、编制依据"));
    expect(page6.text.indexOf("一、概述")).toBeLessThan(page6.text.indexOf("三、适用范围"));
    expect(page6.text.indexOf("一、概述")).toBeLessThan(page6.text.indexOf("《民用建筑热工设计规范》"));
  }, 180_000);
});

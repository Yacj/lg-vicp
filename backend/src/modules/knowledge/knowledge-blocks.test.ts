import { describe, expect, it, vi } from "vitest";

// env 模块在导入链顶层解析环境变量，须先于被测模块完成注入
vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
});

import {
  buildChunksFromBlocks,
  buildSectionDrafts,
  createPageBlockScanState,
  parsePageToBlocks,
  buildChunksFromPages
} from "./knowledge-chunking.js";
import { evaluateVersionAiReadiness } from "./knowledge-original.service.js";

/**
 * Case A：有文本层图集的块级归属（P0-5 修复：同页多个小节各归各，不再整页绑定一个 Section）。
 */

function scanPages(pages: Array<{ page: number | null; text: string }>) {
  const state = createPageBlockScanState();
  const blocks = pages.flatMap((page) => parsePageToBlocks(page, [], state));
  return blocks;
}

describe("Case A：同页多 Section 的 Block 归属（概述/编制依据/适用范围）", () => {
  const blocks = scanPages([{
    page: 12,
    text: [
      "一、概述",
      "VICP 板以真空绝热芯材为保温主体。",
      "二、编制依据",
      "本图集依据 GB 55016 编制。",
      "三、适用范围",
      "适用于新建、扩建和改建的民用建筑。",
      "",
      "表1-1 规格表",
      "20  0.32",
      "25  0.25"
    ].join("\n")
  }]);

  it("同页的三个小节各自成块归属，不再整页挂到同一 Section", () => {
    const sectionPaths = blocks
      .filter((block) => block.contentType === "SECTION" && block.sectionDraftPath.length > 0)
      .map((block) => block.sectionDraftPath[0]);
    expect([...new Set(sectionPaths)]).toEqual(["概述", "编制依据", "适用范围"]);
  });

  it("标题行产生标题块并归属它打开的章节；表格区域整体独立为 TABLE 块", () => {
    const headingBlocks = blocks.filter((block) => block.contentType === "TITLE" || block.contentType === "SECTION");
    const selfHeadings = headingBlocks.filter((block) =>
      ["概述", "编制依据", "适用范围"].includes(block.content));
    expect(selfHeadings.map((block) => block.sectionDraftPath)).toEqual([
      ["概述"], ["编制依据"], ["适用范围"]
    ]);
    const table = blocks.find((block) => block.contentType === "TABLE");
    expect(table?.sectionDraftPath).toEqual(["适用范围"]);
    expect(table?.sourceAnchor).toBe("表1-1");
  });

  it("buildSectionDrafts：三个小节 + 根章节，按首次出现排序，页码区间正确", () => {
    const drafts = buildSectionDrafts("VICP图集", blocks);
    expect(drafts[0]).toMatchObject({ sectionKey: "root", title: "VICP图集", startPage: 12, endPage: 12 });
    const sections = drafts.slice(1);
    expect(sections.map((draft) => draft.title)).toEqual(["概述", "编制依据", "适用范围"]);
    expect(sections.every((draft) => draft.startPage === 12 && draft.endPage === 12)).toBe(true);
    expect(sections[0]!.headingPath).toEqual(["VICP图集", "概述"]);
  });

  it("buildChunksFromBlocks：chunk 保留 sourceSection 继承（辅助索引语义兼容）", () => {
    const chunks = buildChunksFromBlocks(blocks);
    const overview = chunks.find((chunk) => chunk.content.includes("真空绝热芯材"));
    expect(overview?.sourceSection).toBe("概述");
    const table = chunks.find((chunk) => chunk.contentType === "TABLE");
    expect(table?.sourceSection).toBe("适用范围");
  });

  it("Section 跨页：栈在多页之间延续（下一页正文归属上一页最后的小节）", () => {
    const blocks = scanPages([
      { page: 1, text: "第一章 总说明\n本图集适用于民用建筑。" },
      { page: 2, text: "跨页正文继续描述适用范围。" }
    ]);
    const crossPage = blocks.find((block) => block.content.includes("跨页正文"));
    expect(crossPage?.sectionDraftPath).toEqual(["总说明"]);
    expect(crossPage?.sourcePage).toBe(2);
  });

  it("兼容包装 buildChunksFromPages 与块化管线同源（回归保护）", () => {
    const pages = [{ page: 1, text: "1 总说明\n本图集适用于民用建筑。" }];
    const viaWrapper = buildChunksFromPages(pages);
    const viaBlocks = buildChunksFromBlocks(scanPages(pages));
    expect(viaWrapper.map((chunk) => chunk.content)).toEqual(viaBlocks.map((chunk) => chunk.content));
    expect(viaWrapper.map((chunk) => chunk.sourcePage)).toEqual(viaBlocks.map((chunk) => chunk.sourcePage));
  });
});

describe("发布门禁 evaluateVersionAiReadiness（AI_ENABLED / BROWSE_ONLY）", () => {
  it("AI_ENABLED + 无文本层且无检索源：硬拦截", () => {
    const result = evaluateVersionAiReadiness(
      { usageMode: "AI_ENABLED", parseStatus: "SEARCH_SOURCE_REQUIRED" },
      {
        hasOriginalAsset: true, hasSearchSourceAsset: false, pageCount: 3, fallbackPageLabelCount: 0,
        mappingCount: 0, reliableMappingCount: 0, verifiedMappingCount: 0, tocItemCount: 0, confirmedTocCount: 0
      }
    );
    expect(result.eligible).toBe(false);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0]).toContain("BROWSE_ONLY");
  });

  it("BROWSE_ONLY：只有 ORIGINAL 也可发布（不进 AI 检索）", () => {
    const result = evaluateVersionAiReadiness(
      { usageMode: "BROWSE_ONLY", parseStatus: "SEARCH_SOURCE_REQUIRED" },
      {
        hasOriginalAsset: true, hasSearchSourceAsset: false, pageCount: 3, fallbackPageLabelCount: 0,
        mappingCount: 0, reliableMappingCount: 0, verifiedMappingCount: 0, tocItemCount: 0, confirmedTocCount: 0
      }
    );
    expect(result.eligible).toBe(true);
  });

  it("NO_TEXT_LAYER + 已绑定检索源：放行，但映射未核验/TOC 未确认为软提示", () => {
    const result = evaluateVersionAiReadiness(
      { usageMode: "AI_ENABLED", parseStatus: "NO_TEXT_LAYER" },
      {
        hasOriginalAsset: true, hasSearchSourceAsset: true, pageCount: 12, fallbackPageLabelCount: 0,
        mappingCount: 12, reliableMappingCount: 12, verifiedMappingCount: 0, tocItemCount: 8, confirmedTocCount: 0
      }
    );
    expect(result.eligible).toBe(true);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain("目录尚未人工确认");
    expect(result.warnings[1]).toContain("映射尚未人工核验");
  });

  it("PARSED 版本：无拦截无提示", () => {
    const result = evaluateVersionAiReadiness(
      { usageMode: "AI_ENABLED", parseStatus: "PARSED" },
      {
        hasOriginalAsset: true, hasSearchSourceAsset: false, pageCount: 3, fallbackPageLabelCount: 0,
        mappingCount: 0, reliableMappingCount: 0, verifiedMappingCount: 0, tocItemCount: 1, confirmedTocCount: 1
      }
    );
    expect(result.eligible).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});

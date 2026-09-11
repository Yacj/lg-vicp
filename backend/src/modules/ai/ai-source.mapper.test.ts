import { describe, expect, it } from "vitest";
import { toAiSources, type AiSourceRef } from "./ai-source.mapper.js";
import type { WikiHit } from "../knowledge/knowledge.service.js";

/**
 * 统一 AI 原文溯源 Source 契约测试（P0-1）：
 * 正常生成与 regenerate 共用本 mapper，done.sources 必须同构。
 */

function makeChunkHit(overrides: Partial<WikiHit> = {}): WikiHit {
  return {
    sourceId: "chunk-1",
    chunkId: "chunk-1",
    pageBlockId: "block-1",
    pageId: "page-1",
    sectionId: "section-1",
    documentId: "doc-1",
    versionId: "version-1",
    content: "外保温系统应采用不燃材料封堵",
    sourcePage: 21,
    sourceSection: "5.2 VICP薄抹灰外保温系统",
    headingPath: ["5 设计与构造", "5.2 VICP薄抹灰外保温系统"],
    sourceTitle: "VICP应用技术规程",
    retrievalUnit: "CHUNK",
    score: 12.5,
    evidenceLevel: "A",
    citationAnchor: "5.2.3",
    snippet: "…外保温系统应采用不燃材料封堵…"
  };
}

describe("toAiSources：正常生成与 regenerate 共用的 Source 契约", () => {
  it("Chunk 命中：返回完整定位信息与兼容字段", () => {
    const sources = toAiSources([makeChunkHit()]);
    expect(sources).toHaveLength(1);
    const source = sources[0]!;
    expect(source.sourceType).toBe("KNOWLEDGE");
    expect(source.retrievalUnit).toBe("CHUNK");
    expect(source.chunkId).toBe("chunk-1");
    expect(source.documentId).toBe("doc-1");
    expect(source.versionId).toBe("version-1");
    expect(source.sectionId).toBe("section-1");
    expect(source.pageId).toBe("page-1");
    expect(source.blockId).toBe("block-1");
    // 兼容一期字段：title/page/section/score/evidenceLevel 保持不变
    expect(source.title).toBe("VICP应用技术规程");
    expect(source.page).toBe(21);
    expect(source.pageNumber).toBe(21);
    expect(source.section).toBe("5.2 VICP薄抹灰外保温系统");
    expect(source.score).toBe(12.5);
    expect(source.evidenceLevel).toBe("A");
    // 章节路径与高亮
    expect(source.sectionPath).toEqual(["5 设计与构造", "5.2 VICP薄抹灰外保温系统"]);
    expect(source.chapter).toBe("5 设计与构造");
    expect(source.citationAnchor).toBe("5.2.3");
    expect(source.matchedText).toContain("不燃材料封堵");
    expect(source.highlightRanges?.[0]).toMatchObject({
      pageId: "page-1",
      pageNumber: 21,
      blockId: "block-1"
    });
  });

  it("Section 命中没有 chunkId 时来源仍稳定可用（chunkId 非定位必需项）", () => {
    const sectionHit: WikiHit = {
      ...makeChunkHit(),
      sourceId: "section-1",
      chunkId: null,
      pageBlockId: null,
      retrievalUnit: "SECTION",
      sourcePage: 21,
      pageEnd: 23,
      content: "整节内容"
    };
    const [source] = toAiSources([sectionHit]);
    expect(source).toBeDefined();
    expect(source!.chunkId).toBeUndefined();
    expect(source!.retrievalUnit).toBe("SECTION");
    expect(source!.pageStart).toBe(21);
    expect(source!.pageEnd).toBe(23);
    expect(source!.matchedText).toBe("整节内容");
  });

  it("无检索结果时返回空数组（general_chat 不伪造来源）", () => {
    expect(toAiSources([])).toEqual([]);
  });

  it("同一来源重复映射结果完全一致（regenerate 不改变 documentId/section/page）", () => {
    const hit = makeChunkHit();
    const first = toAiSources([hit])[0]!;
    const second = toAiSources([hit])[0]!;
    expect(second).toEqual(first);
    const keys = Object.keys(first).sort();
    expect(Object.keys(second).sort()).toEqual(keys);
  });

  it("AiSourceRef 契约字段齐备（供三端联调依赖核对）", () => {
    const source: AiSourceRef = toAiSources([makeChunkHit()])[0]!;
    for (const key of [
      "sourceType", "retrievalUnit", "documentId", "versionId", "sectionId", "pageId", "blockId",
      "chunkId", "title", "tocPath", "sectionTitle", "chapter", "section", "sectionPath", "citationAnchor",
      "pageNumber", "pageStart", "pageEnd", "page", "matchedText", "quote", "snippet", "highlightRanges",
      "evidenceLevel", "score"
    ] as const) {
      expect(source).toHaveProperty(key);
    }
  });
});

describe("toAiSources：原文导航字段（二次优化增量）", () => {
  it("命中携带 pageLabel/pageTitle/physicalPageNumber/originalFileId；tocPath 与 headingPath 同源", () => {
    const hit: WikiHit = {
      ...makeChunkHit(),
      physicalPageNumber: 103,
      pageLabel: "A5",
      pageTitle: "VICP薄抹灰外保温系统基本构造",
      originalFileId: "file-original-1"
    };
    const [source] = toAiSources([hit]);
    expect(source!.pageLabel).toBe("A5");
    expect(source!.pageTitle).toBe("VICP薄抹灰外保温系统基本构造");
    expect(source!.physicalPageNumber).toBe(103);
    expect(source!.originalFileId).toBe("file-original-1");
    expect(source!.pageNumber).toBe(21); // 兼容字段保持
    expect(source!.tocPath).toEqual(["5 设计与构造", "5.2 VICP薄抹灰外保温系统"]);
    expect(source!.sectionTitle).toBe("5.2 VICP薄抹灰外保温系统");
    expect(source!.quote).toContain("不燃材料封堵");
    expect(source!.pageNumber).toBe(21); // 兼容字段保持
    expect(source!.highlightRanges?.[0]?.pageLabel).toBe("A5");
  });

  it("C 端展示字段包含 title / tocPath / sectionTitle / pageLabel / quote，原文定位用 originalFileId + physicalPageNumber", () => {
    const [source] = toAiSources([{
      ...makeChunkHit(),
      sourceTitle: "VICP建筑构造图集",
      headingPath: ["A VICP薄抹灰外保温系统", "窗洞口"],
      sourceSection: "窗洞口",
      pageLabel: "A7",
      physicalPageNumber: 105,
      originalFileId: "file-original-atlas"
    }]);
    expect(source).toMatchObject({
      documentId: "doc-1",
      title: "VICP建筑构造图集",
      tocPath: ["A VICP薄抹灰外保温系统", "窗洞口"],
      sectionTitle: "窗洞口",
      pageLabel: "A7",
      physicalPageNumber: 105,
      quote: "外保温系统应采用不燃材料封堵",
      originalFileId: "file-original-atlas"
    });
  });
});

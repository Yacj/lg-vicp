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

import { buildSectionContent, mergeWikiHits, SECTION_FULL_TEXT_LIMIT, type WikiHit } from "./knowledge.service.js";
import {
  assertPublicDocument,
  assertReadableKnowledgeDocument,
  isVersionReadable,
  locateHighlight,
  resolveSourceDetail
} from "./knowledge-wiki-read.service.js";
import { getPublicDocumentPageByLabel } from "./knowledge-wiki-read.service.js";
import { getPageRecognition } from "./knowledge-page-recognition.service.js";
import { NotFoundError } from "../../shared/errors.js";

/**
 * Wiki 层级检索与原文阅读服务测试（P0-0/P0-2）：
 * - 章节整节聚合与层级合并去重（纯函数）；
 * - 来源详情读取口径：PUBLISHED+生效中、公开文库可见性、项目越权 404；
 * - 高亮定位：block 文本优先、matchedText 兜底、无命中不编造坐标。
 */

function makeHit(overrides: Partial<WikiHit> = {}): WikiHit {
  return {
    sourceId: "hit-1",
    chunkId: "chunk-1",
    pageBlockId: "block-1",
    pageId: "page-1",
    sectionId: "section-1",
    documentId: "doc-1",
    versionId: "version-1",
    content: "命中内容",
    sourcePage: 5,
    sourceSection: "5.2 体系构造",
    headingPath: ["5 设计", "5.2 体系构造"],
    sourceTitle: "VICP应用技术规程",
    retrievalUnit: "CHUNK",
    score: 10
  };
}

describe("buildSectionContent（小文件整节入库规则）", () => {
  it("节内内容 ≤ 2000 字时整节返回", () => {
    const content = buildSectionContent(["第一段。", "第二段。"]);
    expect(content).toBe("第一段。\n第二段。");
  });

  it("超过阈值时截取节首并标注省略，不做二次切碎", () => {
    const long = "字".repeat(SECTION_FULL_TEXT_LIMIT + 100);
    const content = buildSectionContent([long]);
    expect(content.length).toBe(SECTION_FULL_TEXT_LIMIT + 1);
    expect(content.endsWith("…")).toBe(true);
  });
});

describe("mergeWikiHits（层级合并去重）", () => {
  it("Section 命中后，同章节的 Block/Chunk 命中被去重", () => {
    const sectionHit = { ...makeHit(), sourceId: "s1", sectionId: "section-1", retrievalUnit: "SECTION" as const, score: 30, chunkId: null };
    const blockHit = { ...makeHit(), sourceId: "b1", sectionId: "section-1", pageBlockId: "block-1", retrievalUnit: "BLOCK" as const, score: 20, chunkId: null };
    const chunkHit = { ...makeHit(), sourceId: "c1", sectionId: "section-1", retrievalUnit: "CHUNK" as const, score: 10 };
    const merged = mergeWikiHits({ sectionHits: [sectionHit], blockHits: [blockHit], chunkHits: [chunkHit], limit: 10 });
    expect(merged).toHaveLength(1);
    expect(merged[0]!.retrievalUnit).toBe("SECTION");
  });

  it("未命中级别的 Block/Chunk 兜底保留，按分数排序", () => {
    const blockHit = { ...makeHit(), sourceId: "b2", sectionId: "section-9", pageBlockId: "block-9", retrievalUnit: "BLOCK" as const, score: 5, chunkId: null };
    const chunkHit = { ...makeHit(), sourceId: "c2", sectionId: null, pageBlockId: null, retrievalUnit: "CHUNK" as const, score: 15 };
    const merged = mergeWikiHits({ sectionHits: [], blockHits: [blockHit], chunkHits: [chunkHit], limit: 10 });
    expect(merged.map((hit) => hit.retrievalUnit)).toEqual(["CHUNK", "BLOCK"]);
  });

  it("limit 截断最终结果", () => {
    const hits = Array.from({ length: 8 }, (_, index) => ({
      ...makeHit(),
      sourceId: `b${index}`,
      pageBlockId: `block-${index}`,
      sectionId: `section-${index}`,
      retrievalUnit: "BLOCK" as const,
      score: index,
      chunkId: null
    }));
    const merged = mergeWikiHits({ sectionHits: [], blockHits: hits, chunkHits: [], limit: 3 });
    expect(merged).toHaveLength(3);
    expect(merged.map((hit) => hit.score)).toEqual([7, 6, 5]);
  });
});

describe("来源读取口径（published-only / 公开文库 / 项目越权）", () => {
  const versionBase = { status: "PUBLISHED" as const, expiryDate: null as Date | null };

  it("DRAFT/PENDING_REVIEW/APPROVED/DISABLED 版本不可由 C 端读取", () => {
    for (const status of ["DRAFT", "PENDING_REVIEW", "APPROVED", "DISABLED"] as const) {
      expect(isVersionReadable({ ...versionBase, status })).toBe(false);
    }
    expect(isVersionReadable({ ...versionBase, status: "PUBLISHED" })).toBe(true);
  });

  it("已过失效日的 PUBLISHED 版本不可读", () => {
    const expired = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(isVersionReadable({ status: "PUBLISHED", expiryDate: expired })).toBe(false);
  });

  it("PUBLIC 文档可读，PRIVATE 文档在公开文库返回 404 语义", () => {
    expect(() => assertPublicDocument({ visibility: "PUBLIC", status: "ACTIVE", deletedAt: null })).not.toThrow();
    expect(() => assertPublicDocument({ visibility: "PRIVATE", status: "ACTIVE", deletedAt: null })).toThrow(NotFoundError);
    expect(() => assertPublicDocument({ visibility: "PUBLIC", status: "DISABLED", deletedAt: null })).toThrow(NotFoundError);
  });

  it("平台文档（projectId 为空）对登录用户开放", () => {
    expect(() =>
      assertReadableKnowledgeDocument({ projectId: null }, { id: "u1", role: "NORMAL_USER" } as never, null)
    ).not.toThrow();
  });

  it("私有项目越权返回 404 语义（不泄露文档存在性）", () => {
    const project = { createdById: "owner-1", visibility: "PRIVATE" as const };
    const otherUser = { id: "u2", role: "NORMAL_USER" } as never;
    expect(() =>
      assertReadableKnowledgeDocument({ projectId: "p1" } as never, otherUser, project)
    ).toThrow(NotFoundError);
  });

  it("项目创建者可读；超级管理员仅 B 端令牌可跨项目阅读", () => {
    const project = { createdById: "owner-1", visibility: "PRIVATE" as const };
    expect(() =>
      assertReadableKnowledgeDocument({ projectId: "p1" } as never, { id: "owner-1", role: "NORMAL_USER" } as never, project)
    ).not.toThrow();
    expect(() =>
      assertReadableKnowledgeDocument({ projectId: "p1" } as never, { id: "admin-1", role: "SUPER_ADMIN", clientType: "B_ADMIN" } as never, project)
    ).not.toThrow();
    expect(() =>
      assertReadableKnowledgeDocument({ projectId: "p1" } as never, { id: "admin-1", role: "SUPER_ADMIN", clientType: "C_APP" } as never, project)
    ).toThrow(NotFoundError);
  });
});

describe("高亮定位 locateHighlight", () => {
  const fullText = "建筑外保温系统应符合设计要求。VICP 保温装饰板厚度为 25mm。";

  it("块文本可直接在页全文中定位（blockId 优先路径）", () => {
    const needle = "VICP 保温装饰板厚度为 25mm";
    const { charStart, charEnd } = locateHighlight(fullText, needle);
    expect(charStart).toBe(fullText.indexOf(needle));
    expect(charEnd).toBe(fullText.indexOf(needle) + needle.length);
  });

  it("仅空白差异时保留文本但返回 null 偏移（不编造坐标）", () => {
    const { charStart, charEnd, } = locateHighlight(fullText, "VICP保温装饰板厚度为25mm。");
    expect(charStart).toBeNull();
    expect(charEnd).toBeNull();
  });

  it("完全无命中时返回 null 偏移", () => {
    const { charStart } = locateHighlight(fullText, "不存在的原文");
    expect(charStart).toBeNull();
  });
});

/**
 * Case J：页面驱动知识（originalFileId=null）的来源详情必须可用：
 * 返回页图 / 页文本 / 页块 / 页码，而不是因为没有 ORIGINAL 返回 404。
 */
describe("来源详情：无 ORIGINAL 的页面驱动知识", () => {
  const page = {
    id: "page-9",
    documentId: "doc-1",
    versionId: "ver-1",
    sectionId: null,
    pageNumber: 3,
    physicalPageNumber: 3,
    pageLabel: "3",
    pageLabelSource: "MANUAL",
    pageLabelConfidence: null,
    pageLabelVerified: true,
    pageTitle: "外墙构造表",
    parsedText: "VICP 保温装饰板 25mm，产品层热阻 4.0，总传热阻 4.31",
    pageImageObjectKey: "knowledge/page-images/doc-1/ver-1/p3.png",
    hasTables: true,
    hasImages: true,
    sectionPath: null
  };
  const document = {
    id: "doc-1",
    title: "VICP 页面驱动图集",
    docNumber: null,
    docType: "DETAIL_ATLAS",
    visibility: "PUBLIC",
    projectId: null,
    status: "ACTIVE",
    deletedAt: null,
    currentVersionId: "ver-1"
  };
  const version = { id: "ver-1", documentId: "doc-1", version: 1, status: "PUBLISHED", expiryDate: null };
  const blocks = [{
    id: "block-1",
    blockIndex: 0,
    content: "产品层热阻 4.0",
    contentType: "TABLE",
    sourceAnchor: null,
    metadata: null
  }];

  function scriptedApp(results: unknown[][]) {
    let index = 0;
    const next = () => results[index++] ?? [];
    const target: any = {
      from: () => target,
      where: () => target,
      innerJoin: () => target,
      orderBy: () => target,
      limit: () => Promise.resolve(next()),
      then: (resolve: (value: unknown[]) => void) => resolve(next())
    };
    return {
      db: { select: () => target },
      storage: {
        createDownloadUrl: async (_objectKey: string, name: string) => `https://example.test/${name}`
      }
    } as any;
  }

  it("pageId 入口：original.fileId=null 但页图/页文本/页块齐备，不 404", async () => {
    const app = scriptedApp([[page], [document], [version], blocks, [], []]);
    const detail = await resolveSourceDetail(app, { id: "u1", role: "NORMAL_USER" } as never, { pageId: "page-9" });

    expect(detail.original.fileId).toBeNull();
    expect(detail.original.previewUrl).toBeNull();
    expect(detail.original.pageImageUrl).toContain("page-3.png");
    expect(detail.page?.pageLabel).toBe("3");
    expect(detail.page?.extractedText).toContain("产品层热阻 4.0");
    expect(detail.page?.blocks).toHaveLength(1);
    expect(detail.extracted.blocks).toHaveLength(1);
    expect(detail.location.physicalPageNumber).toBe(3);
    expect(detail.location.pageNumber).toBe(3);
    expect(detail.toc.path).toBeNull();
  });

  it("chunk 入口：页面驱动 chunk 仍能回溯到原页（page-aware）", async () => {
    const chunk = {
      id: "chunk-1",
      documentId: "doc-1",
      versionId: "ver-1",
      sectionId: null,
      pageBlockId: null,
      sourcePage: 3,
      citationAnchor: null,
      metadata: { pageId: "page-9", physicalPageNumber: 3, pageAware: true }
    };
    const app = scriptedApp([[chunk], [document], [version], [page], blocks, [], []]);
    const detail = await resolveSourceDetail(app, { id: "u1", role: "NORMAL_USER" } as never, { chunkId: "chunk-1" });

    expect(detail.original.fileId).toBeNull();
    expect(detail.page?.id).toBe("page-9");
    expect(detail.original.pageImageUrl).toContain("page-3.png");
    expect(detail.location.physicalPageNumber).toBe(3);
  });

  it("B端识别详情/C端按页签读取/AI来源详情复用相同确认渲染契约", async () => {
    const confirmedPage = { ...page, metadata: { confirmedStructuredData: { fullText: "确认全文",
      systems: [{ constructionCode: "A1-3", options: [{ thicknessMm: 18, productThermalResistance: 2.88,
        totalThermalResistance: 3.297, kValue: 0.303 }] }] } } };
    const b = await getPageRecognition(scriptedApp([[confirmedPage], [version], []]), page.id);
    const c = await getPublicDocumentPageByLabel(scriptedApp([[document], [version], [confirmedPage], blocks]), document.id, page.pageLabel);
    const source = await resolveSourceDetail(scriptedApp([[confirmedPage], [document], [version], blocks, [], []]),
      { id: "u1", role: "NORMAL_USER" } as never, { pageId: page.id });
    expect(b.renderModel).not.toBeNull();
    expect(c.renderModel).toEqual(b.renderModel);
    expect(source.page?.renderModel).toEqual(b.renderModel);
    expect(b.renderModel?.pageLabel).toBe("3");
    expect(c.extractedText).toBe(page.parsedText);
  });
});

import { describe, expect, it, vi } from "vitest";

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
  purgePageDerivedIndex,
  rebuildPageDrivenVersionIndex,
  reconcilePageRecognitionJobs,
  resolveFormalPageText,
  validatePageDrivenKnowledgeIntegrity
} from "./knowledge-page-index.service.js";
import { assessBatchConfirmSafety } from "./knowledge-page-recognition.service.js";
import { enqueueRecognitionWithRecovery } from "./knowledge-page-upload.service.js";
import { naturalPageSort } from "../../shared/page-recognition.js";
import { createMemoryDb } from "./knowledge-test-memory-db.js";

function pageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-1",
    documentId: "doc-1",
    versionId: "ver-1",
    pageNumber: 1,
    physicalPageNumber: 1,
    pageLabel: "1",
    pageTitle: null,
    parsedText: null,
    pageImageObjectKey: "knowledge/page-images/doc-1/ver-1/p1.png",
    sectionId: null,
    sectionPath: null,
    metadata: { uploadSource: "ZIP", recognitionStatus: "CONFIRMED", confirmedStructuredData: { fullText: "内容", systems: [] } },
    createdAt: new Date(),
    ...overrides
  };
}

describe("页面正式正文来源：只认 confirmed，绝不使用 draft", () => {
  it("页面驱动未确认 → 不进入正式索引", () => {
    const page = pageRow({
      metadata: { uploadSource: "ZIP", recognitionStatus: "REVIEW_REQUIRED", draftStructuredData: { fullText: "草稿文本", systems: [] } }
    });
    expect(resolveFormalPageText(page as never)).toBeNull();
  });

  it("页面驱动已确认 → 取 confirmedStructuredData.fullText", () => {
    const page = pageRow({
      parsedText: "旧正文",
      metadata: { uploadSource: "ZIP", recognitionStatus: "CONFIRMED", confirmedStructuredData: { fullText: "确认后的正式正文", systems: [] } }
    });
    expect(resolveFormalPageText(page as never)).toBe("确认后的正式正文");
  });

  it("传统文本页（非离线页图）→ 取 parsedText", () => {
    const page = pageRow({ parsedText: "传统解析正文", metadata: null, pageImageObjectKey: null });
    expect(resolveFormalPageText(page as never)).toBe("传统解析正文");
  });
});

describe("批量确认安全条件", () => {
  it("无热工风险 + 有全文 → 允许批量确认", () => {
    expect(assessBatchConfirmSafety({ fullText: "普通说明文字", systems: [] })).toEqual({ safe: true, reasons: [] });
  });

  it("缺全文 → 不安全", () => {
    const result = assessBatchConfirmSafety({ fullText: "", systems: [] });
    expect(result.safe).toBe(false);
    expect(result.reasons.join(" ")).toContain("全文");
  });

  it("热工选项缺少完整 R/K → 禁止批量确认", () => {
    const result = assessBatchConfirmSafety({
      fullText: "A1-3 18mm",
      systems: [{ constructionCode: "A1-3", options: [{ thicknessMm: 18, productThermalResistance: 2.88 }] }]
    });
    expect(result.safe).toBe(false);
    expect(result.reasons.join(" ")).toContain("热阻");
  });

  it("存在热工数据但缺 constructionCode → 映射歧义，禁止批量", () => {
    const result = assessBatchConfirmSafety({
      fullText: "A1-3 18mm",
      systems: [{ options: [{ thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 }] }]
    });
    expect(result.safe).toBe(false);
    expect(result.reasons.join(" ")).toContain("constructionCode");
  });
});

describe("页序：自然排序", () => {
  it("page-1 < page-2 < page-10", () => {
    const sorted = naturalPageSort(["page-10.png", "page-2.png", "page-1.png"], (name) => name);
    expect(sorted).toEqual(["page-1.png", "page-2.png", "page-10.png"]);
  });
});

describe("页面删除清理：chunks / page_blocks / DRAFT 热工行", () => {
  it("删除单页派生索引，保留已发布热工集引用", async () => {
    const { db, store } = createMemoryDb({
      knowledgePageBlocks: [
        { id: "block-1", pageId: "page-1", versionId: "ver-1" },
        { id: "block-2", pageId: "page-2", versionId: "ver-1" }
      ],
      knowledgeChunks: [
        { id: "chunk-1", versionId: "ver-1", pageBlockId: "block-1", metadata: { pageId: "page-1", pageAware: true } },
        { id: "chunk-2", versionId: "ver-1", pageBlockId: "block-2", metadata: { pageId: "page-2", pageAware: true } }
      ],
      thermalReferenceRows: [
        { id: "row-draft", setId: "set-draft", sourcePageId: "page-1" },
        { id: "row-published", setId: "set-pub", sourcePageId: "page-1" }
      ],
      thermalReferenceSets: [
        { id: "set-draft", status: "DRAFT" },
        { id: "set-pub", status: "PUBLISHED" }
      ]
    });

    const result = await purgePageDerivedIndex(db, { id: "page-1", versionId: "ver-1" });
    expect(result.chunksDeleted).toBe(1);
    expect(result.blocksDeleted).toBe(1);
    expect(result.thermalRowsDeleted).toBe(1);
    expect(result.lockedThermalRows).toBe(1);
    expect(store.knowledgeChunks.map((row) => row.id)).toEqual(["chunk-2"]);
    expect(store.knowledgePageBlocks.map((row) => row.id)).toEqual(["block-2"]);
    expect(store.thermalReferenceRows.map((row) => row.id)).toEqual(["row-published"]);
  });
});

describe("版本级正式索引重建：跨页章节 + chunkIndex 连续", () => {
  it("三页统一解析，page2/page3 归属 page1 开启的章节，chunkIndex 全局连续", async () => {
    const { db, store } = createMemoryDb({
      knowledgeDocumentVersions: [{
        id: "ver-1", documentId: "doc-1", title: "VICP 图集", status: "DRAFT",
        indexRevision: 0, contentRevision: 0, indexStatus: "INDEX_PENDING", indexDirty: true
      }],
      knowledgePages: [
        pageRow({ id: "page-1", physicalPageNumber: 1, metadata: { uploadSource: "ZIP", recognitionStatus: "CONFIRMED", confirmedStructuredData: { fullText: "第三章 VICP薄抹灰系统\n第一段内容", systems: [] } } }),
        pageRow({ id: "page-2", physicalPageNumber: 2, metadata: { uploadSource: "ZIP", recognitionStatus: "CONFIRMED", confirmedStructuredData: { fullText: "表3-1 数据\n| a | b |\n| c | d |", systems: [] } } }),
        pageRow({ id: "page-3", physicalPageNumber: 3, metadata: { uploadSource: "ZIP", recognitionStatus: "CONFIRMED", confirmedStructuredData: { fullText: "本节说明文字", systems: [] } } })
      ],
      knowledgeSections: [], knowledgePageBlocks: [], knowledgeChunks: [], knowledgeAliases: []
    });

    const app = { db } as never;
    const result = await rebuildPageDrivenVersionIndex(app, null, null, "ver-1");

    expect(result.indexedPageCount).toBe(3);
    expect(result.sectionCount).toBeGreaterThan(1);
    // chunkIndex 全局连续
    const indexes = store.knowledgeChunks.map((chunk) => chunk.chunkIndex).sort((a, b) => a - b);
    expect(indexes).toEqual(indexes.map((_, index) => index));
    // page2 / page3 的块归属 page1 开启的章节（跨页章节延续）
    const chunksByPage = new Map<string, any>();
    for (const chunk of store.knowledgeChunks) {
      if (!chunksByPage.has(chunk.metadata.pageId)) chunksByPage.set(chunk.metadata.pageId, chunk);
    }
    const page1Section = chunksByPage.get("page-1").sectionId;
    expect(chunksByPage.get("page-2").sectionId).toBe(page1Section);
    expect(chunksByPage.get("page-3").sectionId).toBe(page1Section);
    // 非 root 章节
    const rootSection = store.knowledgeSections.find((section) => section.sectionKey === "root");
    expect(page1Section).not.toBe(rootSection.id);
    // 版本索引就绪 + 索引内容版本与 contentRevision 对齐（发布门禁要求相等）
    const version = store.knowledgeDocumentVersions[0]!;
    expect(version.indexStatus).toBe("INDEX_READY");
    expect(version.indexDirty).toBe(false);
    expect(version.indexRevision).toBe(version.contentRevision);
    expect(result.indexReady).toBe(true);
    expect(result.stale).toBe(false);
  });
});

describe("完整性校验：孤儿 chunk", () => {
  it("page-aware chunk 指向不存在页面 → 校验失败", async () => {
    const { db } = createMemoryDb({
      knowledgeDocumentVersions: [{ id: "ver-1", documentId: "doc-1", usageMode: "AI_ENABLED", indexStatus: "INDEX_READY", indexDirty: false }],
      knowledgePages: [pageRow({ id: "page-1" })],
      knowledgePageBlocks: [{ id: "block-1", pageId: "page-1", versionId: "ver-1" }],
      knowledgeChunks: [
        { id: "chunk-ok", versionId: "ver-1", metadata: { pageId: "page-1", pageAware: "true" } },
        { id: "chunk-orphan", versionId: "ver-1", metadata: { pageId: "page-ghost", pageAware: "true" } }
      ],
      knowledgeSections: [{ id: "sec-1", versionId: "ver-1" }],
      thermalReferenceRows: []
    });
    const integrity = await validatePageDrivenKnowledgeIntegrity({ db } as never, "ver-1");
    expect(integrity.ok).toBe(false);
    expect(integrity.issues.map((issue) => issue.code)).toContain("ORPHAN_CHUNK");
  });
});

describe("识别入队失败可恢复", () => {
  it("queue.add 失败 → 页面回退为可重新入队状态，其余页面照常入队", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const page = pageRow({ id: "page-1", metadata: { uploadSource: "BATCH", recognitionStatus: "PENDING", recognitionRunId: "run-1" } });
    const app = {
      db: {
        select: () => ({ from: () => ({ where: () => ({ limit: async () => [page] }) }) }),
        update: () => ({ set: (patch: Record<string, unknown>) => ({ where: async () => { updates.push(patch); } }) })
      },
      queues: {
        pageRecognition: {
          add: vi.fn(async (_name: string, data: { pageId: string }) => {
            if (data.pageId === "page-2") throw new Error("redis unavailable");
          })
        }
      }
    } as never;

    const result = await enqueueRecognitionWithRecovery(
      app,
      "ver-1",
      { id: "user-1" },
      [{ pageId: "page-1" }, { pageId: "page-2" }],
      new Map([["page-1", "run-1"], ["page-2", "run-2"]])
    );

    expect(result.enqueued).toBe(1);
    expect(result.failed).toEqual([{ pageId: "page-2", error: "redis unavailable" }]);
    expect(updates).toHaveLength(1);
    const meta = updates[0]!.metadata as Record<string, unknown>;
    expect(meta.recognitionStatus).toBe("PENDING");
    expect(meta.recognitionRunId).toBeNull();
  });
});

describe("识别任务对账：stale 恢复", () => {
  it("PENDING 超时且队列无任务 → 恢复为可重新入队", async () => {
    const staleQueuedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const page = pageRow({
      id: "page-1",
      physicalPageNumber: 5,
      metadata: { uploadSource: "BATCH", recognitionStatus: "PENDING", recognitionRunId: "run-x", recognitionQueuedAt: staleQueuedAt }
    });
    const updates: Array<Record<string, unknown>> = [];
    const app = {
      db: {
        select: () => ({ from: () => ({ where: async () => [page] }) }),
        update: () => ({ set: (patch: Record<string, unknown>) => ({ where: async () => { updates.push(patch); } }) })
      },
      queues: { pageRecognition: { getJob: vi.fn(async () => undefined) } }
    } as never;

    const result = await reconcilePageRecognitionJobs(app, "ver-1");
    expect(result.recovered).toBe(1);
    expect(result.details[0]).toMatchObject({ pageId: "page-1", action: "RECOVERED" });
    const meta = updates[0]!.metadata as Record<string, unknown>;
    expect(meta.recognitionRunId).toBeNull();
  });

  it("队列任务仍在等待 → 不误判 stale", async () => {
    const staleQueuedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const page = pageRow({
      id: "page-1",
      metadata: { uploadSource: "BATCH", recognitionStatus: "PENDING", recognitionRunId: "run-x", recognitionQueuedAt: staleQueuedAt }
    });
    const app = {
      db: {
        select: () => ({ from: () => ({ where: async () => [page] }) }),
        update: () => ({ set: () => ({ where: async () => undefined }) })
      },
      queues: { pageRecognition: { getJob: vi.fn(async () => ({ getState: async () => "waiting" })) } }
    } as never;

    const result = await reconcilePageRecognitionJobs(app, "ver-1");
    expect(result.recovered).toBe(0);
    expect(result.stillPending).toBe(1);
  });
});

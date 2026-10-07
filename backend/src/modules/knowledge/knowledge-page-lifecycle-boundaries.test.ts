/**
 * 页面驱动知识库「最后 3 个生命周期边界」专项测试。
 *
 * 覆盖：
 * 1. CONFIRMED → Re-recognition：旧正式 page-aware index 立即失效（旧正文不再可检索）
 * 2. PENDING → REVIEW_REQUIRED：draft 正文不进入正式检索（AAA 清空、BBB 不落 chunk）
 * 3. 重新 Confirm + Rebuild：新正文重新可检索
 * 4. 旧 Rebuild 过期失败：不得把更新的 READY 状态降级
 * 5. pageLabel 修改：Draft Thermal Row sourcePageLabel 同步，PUBLISHED 行不被篡改
 * 6. pageLabel 修改：chunk / pageBlock metadata 不再残留旧 label
 * 7. pageLabel 修改：ReferencePage 以 knowledge_pages 为准显示新 label
 */
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

import { knowledgeAliases } from "../../db/schema.js";
import { buildReferencePageBlocks } from "../ai/reference-page.js";
import {
  markPageContentMutation,
  rebuildPageDrivenVersionIndex,
  resolveFormalPageText
} from "./knowledge-page-index.service.js";
import { enqueuePageRecognition, confirmPageRecognition, savePageRecognitionDraft } from "./knowledge-page-recognition.service.js";
import { updateManualPage } from "./knowledge-page-gallery.service.js";
import { createMemoryDb, hookSelectTable, type MemoryStore } from "./knowledge-test-memory-db.js";

const request = { headers: {}, ip: "127.0.0.1", id: "req-1" } as never;
const actor = { id: "user-1" } as never;
const storage = { createDownloadUrl: async () => "https://example.com/page.png" } as never;

function pageDrivenPage(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-22",
    documentId: "doc-1",
    versionId: "ver-1",
    pageNumber: 22,
    physicalPageNumber: 22,
    pageLabel: "22",
    pageTitle: null,
    parsedText: "AAA",
    pageImageObjectKey: "knowledge/page-images/doc-1/ver-1/p22.png",
    sectionId: null,
    sectionPath: null,
    pageLabelSource: "MANUAL",
    pageLabelVerified: true,
    parseStatus: "PARSED",
    hasImages: true,
    createdAt: new Date(),
    metadata: {
      uploadSource: "ZIP",
      recognitionStatus: "CONFIRMED",
      confirmedStructuredData: { fullText: "AAA", systems: [] }
    },
    ...overrides
  };
}

function draftVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "ver-1",
    documentId: "doc-1",
    title: "VICP 图集",
    status: "DRAFT",
    usageMode: "AI_ENABLED",
    indexStatus: "INDEX_READY",
    indexDirty: false,
    indexRevision: 1,
    contentRevision: 1,
    pageCount: 1,
    ...overrides
  };
}

/** 已确认页 + 正式 chunk AAA + DRAFT / PUBLISHED 热工行。 */
function confirmedStore(): MemoryStore {
  return {
    knowledgeDocumentVersions: [draftVersion()],
    knowledgePages: [pageDrivenPage()],
    knowledgeSections: [{ id: "sec-root", versionId: "ver-1", sectionKey: "root" }],
    knowledgePageBlocks: [{ id: "block-1", pageId: "page-22", versionId: "ver-1" }],
    knowledgeChunks: [{
      id: "chunk-aaa",
      versionId: "ver-1",
      pageBlockId: "block-1",
      metadata: { pageId: "page-22", pageAware: true, pageLabel: "22" }
    }],
    thermalReferenceRows: [
      { id: "row-draft", setId: "set-draft", sourcePageId: "page-22", sourcePageLabel: "22" },
      { id: "row-pub", setId: "set-pub", sourcePageId: "page-22", sourcePageLabel: "22" }
    ],
    thermalReferenceSets: [
      { id: "set-draft", status: "DRAFT" },
      { id: "set-pub", status: "PUBLISHED" }
    ],
    knowledgeAliases: []
  };
}

function appWith(db: unknown) {
  return {
    db,
    storage,
    log: { warn: vi.fn(), info: vi.fn() },
    queues: { pageRecognition: { add: vi.fn(async () => undefined) } }
  } as never;
}

// ---------------------------------------------------------------- 1：Re-recognition 失效旧 index

describe("边界 1：CONFIRMED → Re-recognition 旧正式 index 立即失效", () => {
  it("重新识别后旧 page-aware chunk 被移除、页面退出正式索引、版本置脏", async () => {
    const { db, store } = createMemoryDb(confirmedStore());
    expect(resolveFormalPageText(store.knowledgePages[0] as never)).toBe("AAA");

    await enqueuePageRecognition(appWith(db), request, actor, "page-22", { reRecognize: true });

    // 旧正式 chunk / block 被清理，AAA 不再可检索
    expect(store.knowledgeChunks).toHaveLength(0);
    expect(store.knowledgePageBlocks).toHaveLength(0);
    // DRAFT 集热工行随正式内容失效；PUBLISHED 集不可变，保留
    expect(store.thermalReferenceRows.map((row) => row.id)).toEqual(["row-pub"]);
    // 页面进入 PENDING，正式正文来源为 null
    const page = store.knowledgePages[0]!;
    expect((page.metadata as Record<string, unknown>).recognitionStatus).toBe("PENDING");
    expect(resolveFormalPageText(page as never)).toBeNull();
    // 版本置脏 + contentRevision 前进
    const version = store.knowledgeDocumentVersions[0]!;
    expect(version.indexDirty).toBe(true);
    expect(version.contentRevision).toBe(2);
  });
});

// ---------------------------------------------------------------- 2 / 3：draft 隔离 + 重确认

describe("边界 1b：识别草稿不进入正式检索，重确认后才可检索", () => {
  it("REVIEW_REQUIRED 草稿 BBB 不落 chunk，旧 AAA 已清空；Confirm 后 BBB 可检索", async () => {
    const { db, store } = createMemoryDb(confirmedStore());
    const app = appWith(db);

    // 1) 重新识别：清理旧正式 index
    await enqueuePageRecognition(app, request, actor, "page-22", { reRecognize: true });

    // 2) 模拟 Worker 完成：PENDING → REVIEW_REQUIRED（保留 runId 用于审计）
    const queued = store.knowledgePages[0]!;
    store.knowledgePages[0] = {
      ...queued,
      metadata: { ...(queued.metadata as Record<string, unknown>), recognitionStatus: "REVIEW_REQUIRED" }
    };

    // 3) 保存识别草稿 BBB
    await savePageRecognitionDraft(app, request, actor, "page-22", {
      structuredData: { pageLabel: "22", pageTitle: null, fullText: "BBB 重新识别后的正文", systems: [] }
    });

    // 草稿不进入正式检索：无 chunk、正式正文来源为 null
    expect(store.knowledgeChunks).toHaveLength(0);
    const draftPage = store.knowledgePages[0]!;
    expect((draftPage.metadata as Record<string, unknown>).recognitionStatus).toBe("REVIEW_REQUIRED");
    expect((draftPage.metadata as Record<string, unknown>).draftStructuredData).toMatchObject({ fullText: "BBB 重新识别后的正文" });
    expect(resolveFormalPageText(draftPage as never)).toBeNull();

    // 4) 人工 Confirm → 正式 chunk 重新生成，BBB 可检索
    await confirmPageRecognition(app, request, actor, "page-22", {});
    const confirmedPage = store.knowledgePages[0]!;
    expect((confirmedPage.metadata as Record<string, unknown>).recognitionStatus).toBe("CONFIRMED");
    expect(resolveFormalPageText(confirmedPage as never)).toBe("BBB 重新识别后的正文");
    expect(store.knowledgeChunks.length).toBeGreaterThan(0);
    expect(store.knowledgeChunks.some((chunk) => String(chunk.content).includes("BBB"))).toBe(true);
  });
});

// ---------------------------------------------------------------- 4：过期 Rebuild 失败守卫

describe("边界 2：旧 Rebuild 过期失败不得覆盖更新的 READY", () => {
  it("A(start=10) 期间 Mutation + B(start=11) 成功 READY；A 失败后仍保持 READY/clean/对齐", async () => {
    const { db, store } = createMemoryDb({
      knowledgeDocumentVersions: [draftVersion({ indexStatus: "INDEX_READY", indexDirty: false, indexRevision: 10, contentRevision: 10 })],
      knowledgePages: [pageDrivenPage()],
      knowledgeAliases: [],
      knowledgeSections: [],
      knowledgePageBlocks: [],
      knowledgeChunks: []
    });

    let advanced = false;
    hookSelectTable(db as unknown as Record<string, unknown>, knowledgeAliases, async () => {
      if (advanced) return;
      advanced = true;
      // Mutation：contentRevision 10 → 11（Rebuild A 的 CAS 基准随即过期）
      await markPageContentMutation(db as never, "ver-1");
      // Rebuild B：start=11，很快成功写入 READY
      const b = await rebuildPageDrivenVersionIndex({ db, log: { warn: vi.fn() } } as never, null, null, "ver-1");
      expect(b.indexReady).toBe(true);
      expect(b.stale).toBe(false);
    });

    // Rebuild A：start=10，事务内 CAS 失败 → 进入 catch
    const a = await rebuildPageDrivenVersionIndex({ db, log: { warn: vi.fn() } } as never, null, null, "ver-1");
    expect(a.indexReady).toBe(false);
    expect(a.stale).toBe(true);

    // B 的 READY 状态必须保持不变，不得被 A 的失败降级
    const version = store.knowledgeDocumentVersions[0]!;
    expect(version.indexStatus).toBe("INDEX_READY");
    expect(version.indexDirty).toBe(false);
    expect(version.indexRevision).toBe(11);
    expect(version.contentRevision).toBe(11);
  });

  it("单次 Rebuild 期间 Mutation（无后续 Rebuild）仍降级为 INDEX_PENDING + dirty", async () => {
    const { db, store } = createMemoryDb({
      knowledgeDocumentVersions: [draftVersion({ indexStatus: "INDEX_READY", indexDirty: false, indexRevision: 5, contentRevision: 5 })],
      knowledgePages: [pageDrivenPage()],
      knowledgeAliases: [],
      knowledgeSections: [],
      knowledgePageBlocks: [],
      knowledgeChunks: []
    });
    let mutated = false;
    hookSelectTable(db as unknown as Record<string, unknown>, knowledgeAliases, async () => {
      if (mutated) return;
      mutated = true;
      await markPageContentMutation(db as never, "ver-1");
    });

    const result = await rebuildPageDrivenVersionIndex({ db, log: { warn: vi.fn() } } as never, null, null, "ver-1");
    expect(result.stale).toBe(true);
    const version = store.knowledgeDocumentVersions[0]!;
    expect(version.indexStatus).toBe("INDEX_PENDING");
    expect(version.indexDirty).toBe(true);
    expect(version.contentRevision).toBe(6);
  });
});

// ---------------------------------------------------------------- 5 / 6 / 7：pageLabel 来源同步

describe("边界 3：pageLabel 修改同步派生来源引用", () => {
  async function runLabelChange() {
    const { db, store } = createMemoryDb({
      ...confirmedStore(),
      knowledgePageBlocks: [{ id: "block-1", pageId: "page-22", versionId: "ver-1", metadata: { pageLabel: "22" } }]
    });
    const app = { db, storage, log: { warn: vi.fn() } } as never;
    await updateManualPage(app, request, actor, "ver-1", 22, { pageLabel: "A1-3" });
    return store;
  }

  it("Page 与 Draft Thermal Row sourcePageLabel 同步；PUBLISHED 行不被篡改", async () => {
    const store = await runLabelChange();
    expect(store.knowledgePages[0]!.pageLabel).toBe("A1-3");
    const rows = new Map(store.thermalReferenceRows.map((row) => [row.id, row]));
    expect(rows.get("row-draft")!.sourcePageLabel).toBe("A1-3");
    // 已发布参考集不可变：保留原 label，不静默修改
    expect(rows.get("row-pub")!.sourcePageLabel).toBe("22");
    // pageLabel 属于展示元数据，不应触发索引失效
    expect(store.knowledgeDocumentVersions[0]!.indexDirty).toBe(false);
    expect(store.knowledgeDocumentVersions[0]!.contentRevision).toBe(1);
  });

  it("chunk / pageBlock metadata 不再残留旧 label", async () => {
    const store = await runLabelChange();
    expect((store.knowledgeChunks[0]!.metadata as Record<string, unknown>).pageLabel).toBe("A1-3");
    expect((store.knowledgePageBlocks[0]!.metadata as Record<string, unknown>).pageLabel).toBe("A1-3");
  });

  it("ReferencePage 以 knowledge_pages 为准显示新 label，不信任冗余快照字段", () => {
    const built = buildReferencePageBlocks(
      [{ id: "cand-1", systemName: "外墙外保温", sourceDocumentId: "doc-1", sourcePageId: "page-22", sourcePageLabel: "22" }],
      [{
        pageId: "page-22",
        documentId: "doc-1",
        documentTitle: "VICP 图集",
        physicalPageNumber: 22,
        pageLabel: "A1-3",
        pageImageObjectKey: "knowledge/page-images/doc-1/ver-1/p22.png",
        imageUrl: "https://example.com/p22.png"
      }]
    );
    expect(built.blocks).toHaveLength(1);
    expect(built.blocks[0]!.page.pageLabel).toBe("A1-3");
  });
});

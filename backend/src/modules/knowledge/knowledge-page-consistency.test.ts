/**
 * 页面驱动知识库「剩余一致性与生命周期」专项测试（本轮 7 个 P0/P1 修复）。
 *
 * 覆盖：
 * 1. Rebuild 期间 Page Mutation → 旧 rebuild 绝不能把版本误标 INDEX_READY
 * 2. Revision CAS 失败（结果丢弃 + 回滚）
 * 3. 再次 rebuild 成功 → indexRevision === contentRevision
 * 4. V1 Thermal Row 在 V2 完整性校验中不被误判 orphan
 * 5. 真正 orphan（sourcePageId 指向的页面已从数据库删除）能被检测
 * 6. createManualPage 新增页面后立即 dirty + contentRevision++
 * 7. parsedText 只修正正文错字 → 普通索引重建但 Thermal Row 保留
 * 8. parsedText 改热工结构字段 → 旧 Thermal Row 失效 + 必须重新 Review/Confirm
 * 9. Batch Confirm 逐页结果（success / failed / skipped）
 * 10. PENDING + active recognitionRunId 时禁止换图
 * 11. 0053 migration：content_revision + 历史 PUBLISHED 索引回填（静态断言）
 * 12. Publish 门禁要求 indexRevision === contentRevision
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
import {
  maintenanceRebuildPublishedVersionIndex,
  markPageContentMutation,
  rebuildPageDrivenVersionIndex,
  resolveFormalPageText,
  validatePageDrivenKnowledgeIntegrity
} from "./knowledge-page-index.service.js";
import { batchConfirmPageRecognition } from "./knowledge-page-recognition.service.js";
import { createManualPage, updateManualPage } from "./knowledge-page-gallery.service.js";
import { upsertPageImage } from "./knowledge-page-upload.service.js";
import { createMemoryDb, hookSelectTable, type MemoryStore } from "./knowledge-test-memory-db.js";
import { deriveKnowledgeVersionReadiness, summarizePageReadiness } from "./knowledge-readiness.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const request = { headers: {}, ip: "127.0.0.1", id: "req-1" } as never;
const actor = { id: "user-1" } as never;
const storage = { createDownloadUrl: async () => "https://example.com/page.png" } as never;

function pageDrivenPage(overrides: Record<string, unknown> = {}) {
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
    pageLabelSource: "MANUAL",
    pageLabelVerified: true,
    parseStatus: "PARSED",
    hasImages: true,
    createdAt: new Date(),
    metadata: {
      uploadSource: "ZIP",
      recognitionStatus: "CONFIRMED",
      confirmedStructuredData: { fullText: "第一章 说明文字", systems: [] }
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
    indexRevision: 0,
    contentRevision: 0,
    pageCount: 1,
    ...overrides
  };
}

// ---------------------------------------------------------------- 1 / 2 / 3：Rebuild 并发竞态

describe("P0-1 Rebuild 并发竞态：Revision CAS", () => {
  it("rebuild 期间页面被修改 → 绝不写 INDEX_READY，结果丢弃并回到 INDEX_PENDING + dirty", async () => {
    const { db, store } = createMemoryDb({
      knowledgeDocumentVersions: [draftVersion({ indexRevision: 10, contentRevision: 10 })],
      knowledgePages: [pageDrivenPage()],
      knowledgeAliases: [],
      knowledgeSections: [],
      knowledgePageBlocks: [],
      knowledgeChunks: []
    });
    // 模拟：读取完全部页面之后（loadAliases 阶段）管理员修改了 page22 → contentRevision 10 → 11
    let mutated = false;
    hookSelectTable(db as unknown as Record<string, unknown>, knowledgeAliases, async () => {
      if (mutated) return;
      mutated = true;
      await markPageContentMutation(db as never, "ver-1");
    });

    const result = await rebuildPageDrivenVersionIndex({ db } as never, null, null, "ver-1");

    expect(result.indexReady).toBe(false);
    expect(result.stale).toBe(true);
    const version = store.knowledgeDocumentVersions[0]!;
    expect(version.indexStatus).toBe("INDEX_PENDING");
    expect(version.indexDirty).toBe(true);
    expect(version.contentRevision).toBe(11);
    // 重建结果被丢弃（事务回滚）：不能留下「页面 = B、索引 = A」的半成品
    expect(store.knowledgeChunks).toHaveLength(0);
    expect(store.knowledgePageBlocks).toHaveLength(0);
  });

  it("Revision CAS 失败后再次 rebuild → INDEX_READY，indexRevision === contentRevision", async () => {
    const { db, store } = createMemoryDb({
      knowledgeDocumentVersions: [draftVersion({ indexRevision: 10, contentRevision: 10 })],
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

    const stale = await rebuildPageDrivenVersionIndex({ db } as never, null, null, "ver-1");
    expect(stale.stale).toBe(true);

    // 第二次 rebuild：startRevision = 11，CAS 命中
    const fresh = await rebuildPageDrivenVersionIndex({ db } as never, null, null, "ver-1");
    expect(fresh.indexReady).toBe(true);
    expect(fresh.stale).toBe(false);
    expect(fresh.indexRevision).toBe(11);

    const version = store.knowledgeDocumentVersions[0]!;
    expect(version.indexStatus).toBe("INDEX_READY");
    expect(version.indexDirty).toBe(false);
    expect(version.indexRevision).toBe(11);
    expect(version.indexRevision).toBe(version.contentRevision);
  });

  it("内部维护式重建允许 PUBLISHED，但不修改 PUBLISHED 页面内容", async () => {
    const { db, store } = createMemoryDb({
      knowledgeDocumentVersions: [draftVersion({
        status: "PUBLISHED", indexStatus: "INDEX_PENDING", indexDirty: true, indexRevision: 0, contentRevision: 0
      })],
      knowledgePages: [pageDrivenPage()],
      knowledgeAliases: [],
      knowledgeSections: [],
      knowledgePageBlocks: [],
      knowledgeChunks: []
    });
    const before = { ...store.knowledgePages[0]! };
    const result = await maintenanceRebuildPublishedVersionIndex({ db } as never, null, null, "ver-1");
    expect(result.indexReady).toBe(true);
    const after = store.knowledgePages[0]!;
    expect(after.parsedText).toBe(before.parsedText);
    expect(after.pageImageObjectKey).toBe(before.pageImageObjectKey);
    expect(after.metadata).toEqual(before.metadata);
  });
});

// ---------------------------------------------------------------- 4 / 5：Thermal Row 跨 Version

describe("P0-2 Thermal Row 跨 Version orphan 判定", () => {
  const baseStore = (pages: MemoryStore["knowledgePages"]): MemoryStore => ({
    knowledgeDocumentVersions: [draftVersion({ id: "ver-2", pageCount: 1 })],
    knowledgePages: pages,
    knowledgeSections: [{ id: "sec-root", versionId: "ver-2" }],
    knowledgePageBlocks: [{ id: "block-v2", pageId: "p-v2-22", versionId: "ver-2" }],
    knowledgeChunks: [{ id: "chunk-v2", versionId: "ver-2", metadata: { pageId: "p-v2-22", pageAware: "true" } }],
    thermalReferenceRows: [{ id: "row-v1", sourceDocumentId: "doc-1", sourcePageId: "p-v1-22" }],
    thermalReferenceSets: [],
    knowledgeAliases: []
  });

  it("V1 已发布的 Thermal Row 在验证 V2 时不得被判 orphan", async () => {
    const { db } = createMemoryDb(baseStore([
      pageDrivenPage({ id: "p-v1-22", versionId: "ver-1", physicalPageNumber: 22, pageNumber: 22 }),
      pageDrivenPage({ id: "p-v2-22", versionId: "ver-2", physicalPageNumber: 22, pageNumber: 22 })
    ]));
    const integrity = await validatePageDrivenKnowledgeIntegrity({ db } as never, "ver-2");
    expect(integrity.issues.map((issue) => issue.code)).not.toContain("ORPHAN_THERMAL_ROW");
    expect(integrity.stats.orphanThermalRowCount).toBe(0);
    // 跨版本行不计入本版本热工行统计
    expect(integrity.stats.versionThermalRowCount).toBe(0);
    expect(integrity.ok).toBe(true);
  });

  it("sourcePageId 指向的页面已从数据库删除 → 才算真 orphan", async () => {
    const { db } = createMemoryDb(baseStore([
      pageDrivenPage({ id: "p-v2-22", versionId: "ver-2", physicalPageNumber: 22, pageNumber: 22 })
    ]));
    const integrity = await validatePageDrivenKnowledgeIntegrity({ db } as never, "ver-2");
    expect(integrity.issues.map((issue) => issue.code)).toContain("ORPHAN_THERMAL_ROW");
    expect(integrity.stats.orphanThermalRowCount).toBe(1);
    expect(integrity.ok).toBe(false);
  });
});

// ---------------------------------------------------------------- 6：createManualPage dirty

describe("P0-3 createManualPage 统一登记 Page Mutation", () => {
  it("新增页面后 contentRevision++ 且 indexDirty=true、状态回到 INDEX_PENDING", async () => {
    const { db, store } = createMemoryDb({
      knowledgeDocumentVersions: [draftVersion({ indexRevision: 5, contentRevision: 5, pageCount: 10 })],
      knowledgePages: [],
      knowledgeAliases: []
    });
    const app = { db, storage } as never;
    await createManualPage(app, request, actor, "ver-1", { pageNumber: 11 });

    const version = store.knowledgeDocumentVersions[0]!;
    expect(version.contentRevision).toBe(6);
    expect(version.indexDirty).toBe(true);
    expect(version.indexStatus).toBe("INDEX_PENDING");
    expect(version.pageCount).toBe(1);
  });
});

// ---------------------------------------------------------------- 7 / 8：parsedText 生命周期

describe("P1-4 parsedText 修改与 Thermal Row 生命周期", () => {
  function storeForTextChange(): MemoryStore {
    return {
      knowledgeDocumentVersions: [draftVersion({ indexRevision: 3, contentRevision: 3 })],
      knowledgePages: [pageDrivenPage({
        parsedText: "保温版 18mm",
        metadata: {
          uploadSource: "ZIP",
          recognitionStatus: "CONFIRMED",
          confirmedStructuredData: {
            fullText: "保温版 18mm",
            systems: [{ constructionCode: "A1-3", options: [{ thicknessMm: 18 }] }]
          }
        }
      })],
      knowledgeSections: [],
      knowledgePageBlocks: [{ id: "block-1", pageId: "page-1", versionId: "ver-1" }],
      knowledgeChunks: [{ id: "chunk-1", versionId: "ver-1", pageBlockId: "block-1", metadata: { pageId: "page-1", pageAware: true } }],
      thermalReferenceRows: [{ id: "row-1", setId: "set-draft", sourcePageId: "page-1" }],
      thermalReferenceSets: [{ id: "set-draft", status: "DRAFT" }],
      knowledgeAliases: []
    };
  }

  it("Case A：只修正正文错字 → 普通 chunk 重建，Thermal Row 保留，状态仍 CONFIRMED", async () => {
    const { db, store } = createMemoryDb(storeForTextChange());
    const app = { db, storage } as never;
    const updated = await updateManualPage(app, request, actor, "ver-1", 1, {
      parsedText: "保温板 18mm",
      textChangeMode: "DISPLAY"
    });

    // Thermal Row 不得被 purge
    expect(store.thermalReferenceRows.map((row) => row.id)).toEqual(["row-1"]);
    // 普通 chunk / block 被清理，等待版本级重建
    expect(store.knowledgeChunks).toHaveLength(0);
    expect(store.knowledgePageBlocks).toHaveLength(0);
    // 仍是 CONFIRMED，且正式正文已同步
    const meta = updated.metadata as Record<string, any>;
    expect(meta.recognitionStatus).toBe("CONFIRMED");
    expect(meta.confirmedStructuredData.fullText).toBe("保温板 18mm");
    expect(resolveFormalPageText(updated as never)).toBe("保温板 18mm");
    // 版本索引置脏 + revision 增长
    const version = store.knowledgeDocumentVersions[0]!;
    expect(version.indexDirty).toBe(true);
    expect(version.contentRevision).toBe(4);
  });

  it("Case B：改热工结构字段 → 旧 Thermal Row 失效 + 必须重新 Review/Confirm", async () => {
    const { db, store } = createMemoryDb(storeForTextChange());
    const app = { db, storage } as never;
    const updated = await updateManualPage(app, request, actor, "ver-1", 1, {
      parsedText: "保温板 20mm",
      textChangeMode: "STRUCTURE"
    });

    // 旧热工行失效（DRAFT 集可写行被清理）
    expect(store.thermalReferenceRows).toHaveLength(0);
    // 状态回到 REVIEW_REQUIRED，且不再进入正式索引（必须重新确认）
    const meta = updated.metadata as Record<string, any>;
    expect(meta.recognitionStatus).toBe("REVIEW_REQUIRED");
    expect(resolveFormalPageText(updated as never)).toBeNull();
    const version = store.knowledgeDocumentVersions[0]!;
    expect(version.indexDirty).toBe(true);
    expect(version.contentRevision).toBe(4);
  });
});

// ---------------------------------------------------------------- 9：Batch Confirm 逐页结果

describe("P1-5 Batch Confirm 逐页结果", () => {
  function batchStore(): MemoryStore {
    return {
      knowledgeDocumentVersions: [draftVersion({ contentRevision: 0, indexRevision: 0 })],
      knowledgePages: [
        pageDrivenPage({
          id: "page-ok", physicalPageNumber: 1, pageNumber: 1,
          metadata: { uploadSource: "ZIP", recognitionStatus: "REVIEW_REQUIRED", draftStructuredData: { fullText: "普通说明文字", systems: [] } }
        }),
        pageDrivenPage({
          id: "page-bad", physicalPageNumber: 2, pageNumber: 2,
          metadata: { uploadSource: "ZIP", recognitionStatus: "REVIEW_REQUIRED", draftStructuredData: { fullText: 123 } }
        }),
        pageDrivenPage({
          id: "page-confirmed", physicalPageNumber: 3, pageNumber: 3,
          metadata: { uploadSource: "ZIP", recognitionStatus: "CONFIRMED", confirmedStructuredData: { fullText: "已确认", systems: [] } }
        })
      ],
      knowledgeSections: [],
      knowledgePageBlocks: [],
      knowledgeChunks: [],
      thermalReferenceRows: [],
      thermalReferenceSets: [],
      knowledgeAliases: []
    };
  }

  it("confirmSafeOnly=true：安全页成功，风险页/状态不符页进入 skipped，协议与实现一致", async () => {
    const { db } = createMemoryDb(batchStore());
    const app = { db, storage } as never;
    const result = await batchConfirmPageRecognition(app, request, actor, "ver-1", {
      pageIds: ["page-ok", "page-bad", "page-confirmed"],
      confirmSafeOnly: true
    });

    expect(result.requested).toBe(3);
    expect(result.confirmed).toBe(1);
    expect(result.success.map((item) => item.pageId)).toEqual(["page-ok"]);
    expect(result.failed).toHaveLength(0);
    expect(result.skipped.map((item) => item.pageId).sort()).toEqual(["page-bad", "page-confirmed"]);
    expect(result.skipped.find((item) => item.pageId === "page-bad")!.code).toBe("PAGE_DRAFT_SCHEMA_INVALID");
    expect(result.skipped.find((item) => item.pageId === "page-confirmed")!.code).toBe("PAGE_NOT_REVIEW_REQUIRED");
  });

  it("confirmSafeOnly=false：尝试确认全部 REVIEW_REQUIRED 页，失败页进入 failed 而非整体回滚", async () => {
    const { db } = createMemoryDb(batchStore());
    const app = { db, storage } as never;
    const result = await batchConfirmPageRecognition(app, request, actor, "ver-1", {
      pageIds: ["page-ok", "page-bad", "page-confirmed"],
      confirmSafeOnly: false
    });

    expect(result.confirmed).toBe(1);
    expect(result.success.map((item) => item.pageId)).toEqual(["page-ok"]);
    expect(result.failed.map((item) => item.pageId)).toEqual(["page-bad"]);
    expect(result.failed[0]!.code).toBe("PAGE_DRAFT_SCHEMA_INVALID");
    // 已成功页不受失败页影响（不存在 all-or-nothing）
    expect(result.skipped.map((item) => item.pageId)).toEqual(["page-confirmed"]);
  });

  it("未指定 pageIds 时只处理 REVIEW_REQUIRED 页面", async () => {
    const { db } = createMemoryDb(batchStore());
    const app = { db, storage } as never;
    const result = await batchConfirmPageRecognition(app, request, actor, "ver-1", { confirmSafeOnly: true });
    expect(result.requested).toBe(2);
    expect(result.success.map((item) => item.pageId)).toEqual(["page-ok"]);
    expect(result.skipped.map((item) => item.pageId)).toEqual(["page-bad"]);
  });
});

// ---------------------------------------------------------------- 10：Recognition Busy 换图

describe("P1-6 PENDING + active recognitionRunId 禁止换图", () => {
  it("PENDING 且存在 recognitionRunId（Job 已入队）→ 换图被拒绝", async () => {
    const { db } = createMemoryDb({
      knowledgeDocumentVersions: [draftVersion()],
      knowledgePages: [pageDrivenPage({
        metadata: { uploadSource: "ZIP", recognitionStatus: "PENDING", recognitionRunId: "runA" }
      })],
      knowledgePageBlocks: [],
      knowledgeChunks: [],
      thermalReferenceRows: [],
      thermalReferenceSets: []
    });
    await expect(upsertPageImage(
      { db } as never,
      { id: "ver-1", documentId: "doc-1", status: "DRAFT" } as never,
      {
        physicalPageNumber: 1,
        pageLabel: "1",
        pageImageObjectKey: "knowledge/page-images/doc-1/ver-1/p1-new.png",
        metadataPatch: { uploadSource: "ZIP", recognitionStatus: "PENDING", recognitionRunId: "runB" }
      },
      db as never
    )).rejects.toMatchObject({ code: "PAGE_RECOGNITION_BUSY" });
  });

  it("PROCESSING → 同样拒绝换图", async () => {
    const { db } = createMemoryDb({
      knowledgeDocumentVersions: [draftVersion()],
      knowledgePages: [pageDrivenPage({
        metadata: { uploadSource: "ZIP", recognitionStatus: "PROCESSING", recognitionRunId: "runA" }
      })],
      knowledgePageBlocks: [],
      knowledgeChunks: [],
      thermalReferenceRows: [],
      thermalReferenceSets: []
    });
    await expect(upsertPageImage(
      { db } as never,
      { id: "ver-1", documentId: "doc-1", status: "DRAFT" } as never,
      {
        physicalPageNumber: 1,
        pageLabel: "1",
        pageImageObjectKey: "knowledge/page-images/doc-1/ver-1/p1-new.png",
        metadataPatch: { uploadSource: "ZIP", recognitionStatus: "PENDING", recognitionRunId: "runB" }
      },
      db as never
    )).rejects.toMatchObject({ code: "PAGE_RECOGNITION_BUSY" });
  });

  it("非 busy 状态（FAILED，无 runId）→ 允许换图并置脏", async () => {
    const { db, store } = createMemoryDb({
      knowledgeDocumentVersions: [draftVersion({ contentRevision: 2, indexRevision: 2 })],
      knowledgePages: [pageDrivenPage({
        metadata: { uploadSource: "ZIP", recognitionStatus: "FAILED", recognitionRunId: null }
      })],
      knowledgePageBlocks: [],
      knowledgeChunks: [],
      thermalReferenceRows: [],
      thermalReferenceSets: []
    });
    const result = await upsertPageImage(
      { db } as never,
      { id: "ver-1", documentId: "doc-1", status: "DRAFT" } as never,
      {
        physicalPageNumber: 1,
        pageLabel: "1",
        pageImageObjectKey: "knowledge/page-images/doc-1/ver-1/p1-new.png",
        metadataPatch: { uploadSource: "ZIP", recognitionStatus: "PENDING", recognitionRunId: null }
      },
      db as never
    );
    expect(result.created).toBe(false);
    expect(store.knowledgeDocumentVersions[0]!.contentRevision).toBe(3);
    expect(store.knowledgeDocumentVersions[0]!.indexDirty).toBe(true);
  });
});

// ---------------------------------------------------------------- 11：0053 migration 静态断言

describe("P1-7 0053 migration：content_revision + 历史 PUBLISHED 索引回填", () => {
  const drizzleDir = path.join(ROOT, "drizzle");
  const journal = JSON.parse(readFileSync(path.join(drizzleDir, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };

  it("0053 已登记 journal，SQL 含 content_revision 与 PUBLISHED 回填，snapshot 链连续", () => {
    const entry = journal.entries.find((item) => item.tag.startsWith("0053_"));
    expect(entry).toBeDefined();
    expect(entry!.idx).toBe(53);

    const sql = readFileSync(path.join(drizzleDir, `${entry!.tag}.sql`), "utf8");
    expect(sql).toContain('ADD COLUMN "content_revision"');
    // 历史 PUBLISHED 版本不得停留在 INDEX_PENDING + dirty 且无恢复路径
    expect(sql).toContain("index_status = 'INDEX_READY'");
    expect(sql).toContain("v.status = 'PUBLISHED'");
    expect(sql).toContain("knowledge_chunks");
    expect(sql).toContain("knowledge_pages");

    const snapshots = readdirSync(path.join(drizzleDir, "meta")).filter((name) => /^\d+_snapshot\.json$/.test(name));
    expect(snapshots).toContain("0053_snapshot.json");
    const snap0053 = JSON.parse(readFileSync(path.join(drizzleDir, "meta/0053_snapshot.json"), "utf8")) as { prevId: string };
    const snap0052 = JSON.parse(readFileSync(path.join(drizzleDir, "meta/0052_snapshot.json"), "utf8")) as { id: string };
    expect(snap0053.prevId).toBe(snap0052.id);

    // journal 时间严格递增（verify-migrations --static 同口径）
    for (let i = 1; i < journal.entries.length; i += 1) {
      expect(journal.entries[i]!.when).toBeGreaterThan(journal.entries[i - 1]!.when);
    }
  });
});

// ---------------------------------------------------------------- 12：Publish 门禁使用 Revision

describe("Publish Gate 必须使用 Revision", () => {
  it("indexRevision !== contentRevision → 完整性校验失败（INDEX_REVISION_MISMATCH）", async () => {
    const { db } = createMemoryDb({
      knowledgeDocumentVersions: [draftVersion({ indexRevision: 3, contentRevision: 4, pageCount: 1 })],
      knowledgePages: [pageDrivenPage()],
      knowledgeSections: [{ id: "sec-root", versionId: "ver-1" }],
      knowledgePageBlocks: [{ id: "block-1", pageId: "page-1", versionId: "ver-1" }],
      knowledgeChunks: [{ id: "chunk-1", versionId: "ver-1", metadata: { pageId: "page-1", pageAware: "true" } }],
      thermalReferenceRows: [],
      thermalReferenceSets: [],
      knowledgeAliases: []
    });
    const integrity = await validatePageDrivenKnowledgeIntegrity({ db } as never, "ver-1");
    expect(integrity.ok).toBe(false);
    expect(integrity.indexReady).toBe(false);
    expect(integrity.issues.map((issue) => issue.code)).toContain("INDEX_REVISION_MISMATCH");
    expect(integrity.stats.indexRevision).toBe(3);
    expect(integrity.stats.contentRevision).toBe(4);
  });

  it("readiness 派生：revision 不一致时 publishReady=false 并给出 INDEX_NOT_READY", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      {
        usageMode: "AI_ENABLED",
        parseStatus: "PENDING",
        hasOriginalAsset: false,
        hasSearchSourceAsset: false,
        indexStatus: "INDEX_READY",
        indexDirty: false,
        indexRevision: 3,
        contentRevision: 4
      },
      summarizePageReadiness([pageDrivenPage() as never], 5)
    );
    expect(readiness.publishReady).toBe(false);
    expect(readiness.publishBlockers.map((blocker) => blocker.code)).toContain("INDEX_NOT_READY");
  });

  it("readiness 派生：revision 一致 + 非 dirty → publishReady=true", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      {
        usageMode: "AI_ENABLED",
        parseStatus: "PENDING",
        hasOriginalAsset: false,
        hasSearchSourceAsset: false,
        indexStatus: "INDEX_READY",
        indexDirty: false,
        indexRevision: 4,
        contentRevision: 4
      },
      summarizePageReadiness([pageDrivenPage() as never], 5)
    );
    expect(readiness.publishReady).toBe(true);
  });
});

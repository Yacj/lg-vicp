import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import {
  constructionSchemes,
  knowledgeChunks,
  knowledgeDocumentVersions,
  knowledgePages,
  productSpecs,
  schemeProductOptions,
  thermalReferenceRows,
  thermalReferenceSets
} from "../../db/schema.js";
import { confirmPageRecognition, savePageRecognitionDraft } from "./knowledge-page-recognition.service.js";

/** 表驱动 query builder 桩：支持 limit() 与直接 await（then）。 */
function tableQuery(rowsFor: (table: unknown) => unknown[]) {
  const query: any = {
    from(value: unknown) { query._table = value; return query; },
    where() { return query; },
    limit: async () => rowsFor(query._table),
    then: (resolve: (value: unknown) => void) => resolve(rowsFor(query._table))
  };
  return query;
}

describe("confirmPageRecognition transaction", () => {
  it("rolls back page chunks and status when thermal row insert fails", async () => {
    const page = {
      id: "page-1", documentId: "doc-1", versionId: "version-1", physicalPageNumber: 1,
      pageLabel: "P1", pageTitle: "热工表", parsedText: "A1-3 18mm", metadata: {
        recognitionStatus: "REVIEW_REQUIRED",
        draftStructuredData: {
          pageLabel: "P1", pageTitle: "热工表", fullText: "A1-3 18mm",
          systems: [{ constructionCode: "A1-3", options: [{
            thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303
          }] }]
        }
      }
    };
    const version = { id: "version-1", status: "DRAFT" };
    const set = { id: "set-1", status: "DRAFT" };
    const scheme = { id: "scheme-1", schemeCode: "A1-3", status: "PUBLISHED" };
    const spec = { id: "spec-1", thicknessMm: 18, status: "PUBLISHED" };
    const persisted = { chunks: 0, thermalRows: 0, pageStatus: "REVIEW_REQUIRED" };
    const transaction = { committed: false, rolledBack: false };

    const makeExecutor = () => ({
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [] }) })
      }),
      execute: vi.fn(async () => undefined),
      delete: () => ({ where: async () => undefined }),
      insert: (table: unknown) => ({
        values: async () => {
          if (table === knowledgeChunks) return undefined;
          if (table === thermalReferenceRows) throw new Error("simulated row insert failure");
          return undefined;
        }
      }),
      update: () => ({ set: () => ({ where: async () => { persisted.pageStatus = "CONFIRMED"; } }) })
    });
    const tx = makeExecutor() as any;
    // Drizzle's from(table) determines the result fixture; build the actual query builder around it.
    tx.select = () => {
      let table: unknown;
      const query: any = {
        from: (value: unknown) => { table = value; return query; },
        where: () => query,
        limit: async () => {
          if (table === knowledgePages) return [page];
          if (table === knowledgeDocumentVersions) return [version];
          if (table === thermalReferenceSets) return [set];
          if (table === constructionSchemes) return [scheme];
          if (table === productSpecs) return [spec];
          return [];
        },
        then: (resolve: (value: unknown) => void) => resolve(
          table === schemeProductOptions
            ? [{ schemeId: scheme.id, productSpecId: spec.id }]
            : [{ maxIndex: -1 }]
        )
      };
      return query;
    };
    const db: any = {
      ...makeExecutor(),
      select: () => {
        let table: unknown;
        const query: any = {
          from: (value: unknown) => { table = value; return query; },
          where: () => query,
          limit: async () => table === knowledgePages ? [page] : [version]
        };
        return query;
      },
      transaction: async (callback: (executor: any) => Promise<unknown>) => {
        try {
          const result = await callback(tx);
          transaction.committed = true;
          return result;
        } catch (error) {
          transaction.rolledBack = true;
          throw error;
        }
      }
    };
    const app = { db } as any;

    await expect(confirmPageRecognition(
      app,
      { headers: {} } as any,
      { id: "user-1" } as any,
      page.id,
      {
        thermalSetId: set.id
      }
    )).rejects.toThrow("simulated row insert failure");

    expect(transaction).toEqual({ committed: false, rolledBack: true });
    expect(persisted).toEqual({ chunks: 0, thermalRows: 0, pageStatus: "REVIEW_REQUIRED" });
  });

  it.each(["PENDING", "PROCESSING", "FAILED", "CONFIRMED"])("状态 %s 不允许确认", async (status) => {
    const page = {
      id: "page-1", documentId: "doc-1", versionId: "version-1", physicalPageNumber: 1,
      metadata: { recognitionStatus: status, draftStructuredData: { fullText: "文本", systems: [] } }
    };
    const version = { id: "version-1", status: "DRAFT" };
    const queryFor = (rowsForTable: (table: unknown) => unknown[]) => () => {
      let table: unknown;
      const query: any = {
        from: (value: unknown) => { table = value; return query; },
        where: () => query,
        limit: async () => rowsForTable(table)
      };
      return query;
    };
    const tx: any = {
      execute: vi.fn(async () => undefined),
      select: queryFor((table) => table === knowledgePages ? [page] : table === knowledgeDocumentVersions ? [version] : [])
    };
    const db: any = {
      select: queryFor((table) => table === knowledgePages ? [page] : table === knowledgeDocumentVersions ? [version] : []),
      transaction: async (callback: (executor: any) => Promise<unknown>) => callback(tx)
    };
    await expect(confirmPageRecognition(
      { db } as any,
      { headers: {} } as any,
      { id: "user-1" } as any,
      page.id,
      {}
    )).rejects.toMatchObject({
      code: status === "CONFIRMED" ? "PAGE_RECOGNITION_ALREADY_CONFIRMED" : "PAGE_RECOGNITION_NOT_READY"
    });
    expect(tx.execute).toHaveBeenCalledOnce();
  });
});

describe("savePageRecognitionDraft 并发保护", () => {
  const input = {
    structuredData: {
      pageLabel: "P1",
      pageTitle: "人工标题",
      fullText: "人工修正后的文本",
      systems: []
    }
  };

  function harness(options: {
    lockedPage: Record<string, unknown>;
    version?: Record<string, unknown>;
    outerPage?: Record<string, unknown>;
  }) {
    const version = options.version ?? { id: "version-1", status: "DRAFT" };
    const state = {
      updates: 0,
      metadata: undefined as Record<string, unknown> | undefined,
      rowLock: 0,
      committed: false,
      rolledBack: false
    };
    const rowsFor = (table: unknown) => {
      if (table === knowledgePages) return [options.lockedPage];
      if (table === knowledgeDocumentVersions) return [version];
      return [];
    };
    const tx: any = {
      execute: vi.fn(async () => { state.rowLock += 1; }),
      select: () => tableQuery(rowsFor),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              state.updates += 1;
              state.metadata = patch.metadata as Record<string, unknown>;
              return [{ ...options.lockedPage, ...patch }];
            }
          })
        })
      })
    };
    const db: any = {
      select: () => tableQuery((table) => {
        if (table === knowledgePages) return [options.outerPage ?? options.lockedPage];
        if (table === knowledgeDocumentVersions) return [version];
        return [];
      }),
      insert: () => ({ values: async () => undefined }),
      transaction: async (callback: (executor: any) => Promise<unknown>) => {
        try {
          const result = await callback(tx);
          state.committed = true;
          return result;
        } catch (error) {
          state.rolledBack = true;
          throw error;
        }
      }
    };
    const warn = vi.fn();
    return { app: { db, log: { warn } } as any, state, warn, version };
  }

  it("PENDING + recognitionRunId（已入队未启动）时拒绝保存草稿", async () => {
    const page = {
      id: "page-1", documentId: "doc-1", versionId: "version-1", physicalPageNumber: 1,
      pageLabel: "P1", pageTitle: null, parsedText: "", pageLabelVerified: false,
      metadata: {
        recognitionStatus: "PENDING",
        recognitionRunId: "run-b",
        draftStructuredData: { fullText: "AI 旧草稿", systems: [] }
      }
    };
    const { app, state, warn } = harness({ lockedPage: page });

    await expect(savePageRecognitionDraft(app, { headers: {} } as any, { id: "user-1" } as any, page.id, input))
      .rejects.toMatchObject({
        code: "PAGE_RECOGNITION_BUSY",
        statusCode: 409,
        details: { errorCode: "PAGE_RECOGNITION_BUSY", recognitionRunId: "run-b" }
      });
    expect(state.updates).toBe(0);
    expect(state.rolledBack).toBe(true);
    expect(state.committed).toBe(false);
    expect(page.metadata).toEqual({
      recognitionStatus: "PENDING",
      recognitionRunId: "run-b",
      draftStructuredData: { fullText: "AI 旧草稿", systems: [] }
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatchObject({
      pageId: "page-1", recognitionStatus: "PENDING", recognitionRunId: "run-b", operation: "save_recognition_draft"
    });
  });

  it("PROCESSING 时拒绝保存草稿（既有行为不回归）", async () => {
    const page = {
      id: "page-1", documentId: "doc-1", versionId: "version-1", physicalPageNumber: 1,
      pageLabel: "P1", pageTitle: null, parsedText: "", pageLabelVerified: false,
      metadata: { recognitionStatus: "PROCESSING", recognitionRunId: "run-b" }
    };
    const { app, state } = harness({ lockedPage: page });

    await expect(savePageRecognitionDraft(app, { headers: {} } as any, { id: "user-1" } as any, page.id, input))
      .rejects.toMatchObject({ code: "PAGE_RECOGNITION_BUSY", statusCode: 409 });
    expect(state.updates).toBe(0);
  });

  it("以事务内最新 metadata 为准：锁内已是 PENDING + run-B 时拒绝，不用旧快照覆盖新 runId", async () => {
    // 预检阶段读到的还是 REVIEW_REQUIRED，但并发 enqueue 已在锁内写入 PENDING + run-B
    const outerPage = {
      id: "page-1", documentId: "doc-1", versionId: "version-1", physicalPageNumber: 1,
      pageLabel: "P1", pageTitle: null, parsedText: "", pageLabelVerified: false,
      metadata: { recognitionStatus: "REVIEW_REQUIRED", recognitionRunId: "run-a" }
    };
    const lockedPage = {
      ...outerPage,
      metadata: { recognitionStatus: "PENDING", recognitionRunId: "run-b" }
    };
    const { app, state } = harness({ lockedPage, outerPage });

    await expect(savePageRecognitionDraft(app, { headers: {} } as any, { id: "user-1" } as any, outerPage.id, input))
      .rejects.toMatchObject({ code: "PAGE_RECOGNITION_BUSY", statusCode: 409 });
    expect(state.rowLock).toBe(1);
    expect(state.updates).toBe(0);
    expect(lockedPage.metadata).toEqual({ recognitionStatus: "PENDING", recognitionRunId: "run-b" });
  });

  it("REVIEW_REQUIRED 允许保存草稿，且不覆盖 confirmedStructuredData", async () => {
    const confirmed = { pageLabel: "P0", pageTitle: "已确认标题", fullText: "已确认文本", systems: [] };
    const page = {
      id: "page-1", documentId: "doc-1", versionId: "version-1", physicalPageNumber: 1,
      pageLabel: "P1", pageTitle: null, parsedText: "", pageLabelVerified: false,
      metadata: {
        recognitionStatus: "REVIEW_REQUIRED",
        recognitionRunId: "run-b",
        draftStructuredData: { fullText: "AI 草稿", systems: [] },
        confirmedStructuredData: confirmed,
        confirmedAt: "2026-01-01T00:00:00.000Z",
        confirmedById: "user-0"
      }
    };
    const { app, state } = harness({ lockedPage: page, outerPage: { ...page } });

    const result = await savePageRecognitionDraft(app, { headers: {} } as any, { id: "user-1" } as any, page.id, input);

    expect(state.committed).toBe(true);
    expect(state.updates).toBe(1);
    expect(state.metadata).toMatchObject({ recognitionStatus: "REVIEW_REQUIRED" });
    expect(state.metadata!.confirmedStructuredData).toEqual(confirmed);
    expect(state.metadata!.confirmedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(state.metadata!.draftStructuredData).toMatchObject({ pageTitle: "人工标题", fullText: "人工修正后的文本" });
    // 已完成的 runId 仅作审计保留，不被清空
    expect(state.metadata!.recognitionRunId).toBe("run-b");
    expect(result.page).toMatchObject({ pageLabel: "P1" });
    expect(result.recognition.recognitionStatus).toBe("REVIEW_REQUIRED");
  });
});

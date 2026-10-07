import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { knowledgeDocumentVersions, knowledgePages } from "../../db/schema.js";
import { enqueuePageRecognition, runPageRecognitionJob, savePageRecognitionDraft } from "./knowledge-page-recognition.service.js";

function queryFor(page: any, version: any) {
  return () => {
    let table: unknown;
    const query: any = {
      from: (value: unknown) => { table = value; return query; },
      where: () => query,
      limit: async () => table === knowledgePages ? [page] : table === knowledgeDocumentVersions ? [version] : []
    };
    return query;
  };
}

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

/** savePageRecognitionDraft 用的最小事务桩。 */
function draftHarness(page: any, version: any) {
  const state = { updates: 0, rowLock: 0 };
  const tx: any = {
    execute: vi.fn(async () => { state.rowLock += 1; }),
    select: () => tableQuery((table) => table === knowledgePages ? [page] : table === knowledgeDocumentVersions ? [version] : []),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({ returning: async () => { state.updates += 1; return [{ ...page, ...patch }]; } })
      })
    })
  };
  const app: any = {
    db: {
      select: () => tableQuery((table) => table === knowledgePages ? [page] : table === knowledgeDocumentVersions ? [version] : []),
      insert: () => ({ values: async () => undefined }),
      transaction: (callback: (executor: any) => Promise<unknown>) => callback(tx)
    },
    log: { warn: vi.fn() },
    storage: { createDownloadUrl: vi.fn(async () => "https://example.test/page.png") }
  };
  return { app, state };
}

describe("页面识别 single-flight", () => {
  it("PROCESSING 页面再次识别时拒绝且不产生第二个任务", async () => {
    const page = {
      id: "page-1", versionId: "version-1", pageImageObjectKey: "page.png",
      metadata: { recognitionStatus: "PROCESSING", recognitionRunId: "run-a" }
    };
    const version = { id: "version-1", status: "DRAFT" };
    const add = vi.fn();
    const tx: any = { execute: vi.fn(), select: queryFor(page, version) };
    const app: any = {
      db: { transaction: (callback: (value: any) => unknown) => callback(tx) },
      queues: { pageRecognition: { add } }
    };
    await expect(enqueuePageRecognition(app, { headers: {} } as any, { id: "user-1" } as any, page.id))
      .rejects.toMatchObject({ code: "PAGE_RECOGNITION_IN_PROGRESS" });
    expect(add).not.toHaveBeenCalled();
  });

  it("排队任务使用页面稳定 jobId 并携带 recognitionRunId", async () => {
    const page = {
      id: "page-1", versionId: "version-1", pageImageObjectKey: "page.png",
      metadata: { recognitionStatus: "REVIEW_REQUIRED", recognitionRunId: "run-old" }
    };
    const version = { id: "version-1", status: "DRAFT" };
    const add = vi.fn(async () => undefined);
    const update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }));
    const tx: any = { execute: vi.fn(), select: queryFor(page, version), update };
    const db: any = {
      transaction: (callback: (value: any) => unknown) => callback(tx),
      insert: () => ({ values: async () => undefined })
    };
    await enqueuePageRecognition(
      { db, queues: { pageRecognition: { add } } } as any,
      { headers: {}, ip: "127.0.0.1" } as any,
      { id: "user-1" } as any,
      page.id
    );
    expect(add).toHaveBeenCalledOnce();
    const [, payload, options] = add.mock.calls[0]!;
    expect(payload.recognitionRunId).toMatch(/^[0-9a-f-]{36}$/);
    expect(options.jobId).toBe("page-recog-page-1");
  });

  it("旧 run A 晚于 run B 执行时直接丢弃，不覆盖最新结果", async () => {
    const page = {
      id: "page-1", versionId: "version-1", pageImageObjectKey: "page.png",
      metadata: { recognitionStatus: "PROCESSING", recognitionRunId: "run-b" }
    };
    const version = { id: "version-1", status: "DRAFT" };
    const update = vi.fn();
    const result = await runPageRecognitionJob({
      db: { select: queryFor(page, version), update } as any,
      storage: { createDownloadUrl: vi.fn() } as any,
      log: { warn: vi.fn() } as any
    }, page.id, "run-a");
    expect(result.status).toBe("STALE");
    expect(update).not.toHaveBeenCalled();
  });
});

describe("saveDraft 与 enqueue 的排队边界", () => {
  const input = { structuredData: { pageLabel: "P1", pageTitle: "人工标题", fullText: "人工文本", systems: [] } };

  it("PENDING + recognitionRunId 排队期间再次识别被拒绝", async () => {
    const page = {
      id: "page-1", versionId: "version-1", pageImageObjectKey: "page.png",
      metadata: { recognitionStatus: "PENDING", recognitionRunId: "run-b" }
    };
    const version = { id: "version-1", status: "DRAFT" };
    const add = vi.fn();
    const tx: any = { execute: vi.fn(), select: queryFor(page, version) };
    const app: any = {
      db: { transaction: (callback: (value: any) => unknown) => callback(tx) },
      queues: { pageRecognition: { add } }
    };
    await expect(enqueuePageRecognition(app, { headers: {} } as any, { id: "user-1" } as any, page.id))
      .rejects.toMatchObject({ code: "PAGE_RECOGNITION_IN_PROGRESS" });
    expect(add).not.toHaveBeenCalled();
  });

  it("顺序 B：enqueue 先拿到 row lock 写入 PENDING + run-B 后，saveDraft 被拒绝且元数据不变", async () => {
    const page = {
      id: "page-1", documentId: "doc-1", versionId: "version-1", physicalPageNumber: 1,
      pageLabel: "P1", pageTitle: null, parsedText: "", pageLabelVerified: false,
      metadata: { recognitionStatus: "PENDING", recognitionRunId: "run-b", draftStructuredData: null }
    };
    const version = { id: "version-1", status: "DRAFT" };
    const { app, state } = draftHarness(page, version);

    await expect(savePageRecognitionDraft(app, { headers: {} } as any, { id: "user-1" } as any, page.id, input))
      .rejects.toMatchObject({ code: "PAGE_RECOGNITION_BUSY", statusCode: 409 });
    expect(state.updates).toBe(0);
    // run-B 仍然有效，排队中的 Worker 可以正常启动，不会被人工草稿抢占
    expect(page.metadata).toEqual({ recognitionStatus: "PENDING", recognitionRunId: "run-b", draftStructuredData: null });
  });

  it("顺序 A：saveDraft 先保存为 REVIEW_REQUIRED 后，enqueue 仍可正常排队并携带新 runId", async () => {
    const page = {
      id: "page-1", documentId: "doc-1", versionId: "version-1", physicalPageNumber: 1, pageImageObjectKey: "page.png",
      pageLabel: "P1", pageTitle: null, parsedText: "", pageLabelVerified: false,
      metadata: { recognitionStatus: "REVIEW_REQUIRED", recognitionRunId: "run-b" }
    };
    const version = { id: "version-1", status: "DRAFT" };
    const { app: draftApp, state } = draftHarness(page, version);
    await savePageRecognitionDraft(draftApp, { headers: {} } as any, { id: "user-1" } as any, page.id, input);
    expect(state.updates).toBe(1);

    const add = vi.fn(async () => undefined);
    const update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }));
    const tx: any = { execute: vi.fn(), select: queryFor(page, version), update };
    const db: any = {
      transaction: (callback: (value: any) => unknown) => callback(tx),
      insert: () => ({ values: async () => undefined })
    };
    await enqueuePageRecognition(
      { db, queues: { pageRecognition: { add } } } as any,
      { headers: {}, ip: "127.0.0.1" } as any,
      { id: "user-1" } as any,
      page.id
    );
    expect(add).toHaveBeenCalledOnce();
    expect(add.mock.calls[0]![1].recognitionRunId).toMatch(/^[0-9a-f-]{36}$/);
    expect(add.mock.calls[0]![1].recognitionRunId).not.toBe("run-b");
  });
});

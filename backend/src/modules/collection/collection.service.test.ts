import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { CollectionError } from "../../shared/collection-errors.js";
import { NotFoundError } from "../../shared/errors.js";
import {
  createAutoCollectionTask,
  createManualCollectionTask,
  getCollectionTask,
  importCollectionTaskToKnowledge,
  scanEnabledCollectionSources,
  COLLECTION_AUTO_INTERVAL_MS
} from "./collection.service.js";
import { runCollectionTask } from "./collection-fetch.service.js";

const actor = { id: "user-1", role: "SUPER_ADMIN" as const, channelType: null, adminLoginEnabled: true, clientType: "B_ADMIN" as const, permissionCodes: [] };
const request = { id: "req-1", ip: "127.0.0.1", headers: {} } as any;

function makeDb(options: {
  selects?: Array<Array<Record<string, unknown>>>;
  insertReturning?: Array<Record<string, unknown>>;
}) {
  let selectCall = 0;
  let insertCall = 0;
  const updates: Array<Record<string, unknown>> = [];
  const inserts: unknown[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => options.selects?.[selectCall++] ?? [],
          orderBy: () => ({
            offset: () => ({ limit: async () => options.selects?.[selectCall++] ?? [] }),
            then: (resolve: (v: unknown) => void) => Promise.resolve(options.selects?.[selectCall++] ?? []).then(resolve)
          }),
          then: (resolve: (v: unknown) => void) => Promise.resolve(options.selects?.[selectCall++] ?? []).then(resolve)
        }),
        orderBy: () => ({
          then: (resolve: (v: unknown) => void) => Promise.resolve(options.selects?.[selectCall++] ?? []).then(resolve)
        })
      })
    }),
    insert: () => ({
      values: (values: unknown) => {
        inserts.push(values);
        const row = options.insertReturning?.[insertCall++] ?? { id: "new-1", ...(values as object) };
        return {
          returning: async () => [row],
          then: (resolve: (v: unknown) => void) => Promise.resolve().then(resolve)
        };
      }
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: () => ({
            returning: async () => [{ id: "updated", ...values }],
            then: (resolve: (v: unknown) => void) => Promise.resolve().then(resolve)
          })
        };
      }
    }),
    transaction: async (cb: (tx: typeof db) => Promise<unknown>) => cb(db)
  };
  return { db, inserts, updates };
}

describe("手动采集", () => {
  it("创建任务后入队，状态为 PENDING，不会直接发布", async () => {
    const { db, inserts } = makeDb({
      insertReturning: [{
        id: "task-1", sourceId: null, name: "图集 PDF", sourceUrl: "https://example.com/atlas.pdf",
        mode: "MANUAL", status: "PENDING", resultFileId: null, resultMeta: null, errorMessage: null,
        createdById: actor.id, createdAt: new Date(), startedAt: null, finishedAt: null, importedKnowledgeDocumentId: null, updatedAt: new Date()
      }]
    });
    const add = vi.fn(async () => undefined);
    const task = await createManualCollectionTask(
      { db: db as never, storage: {} as never, queues: { collectionFetch: { add }, documentProcessing: { add: vi.fn() } } as never },
      request,
      actor,
      { name: "图集 PDF", sourceUrl: "https://example.com/atlas.pdf" }
    );
    expect(task.status).toBe("PENDING");
    expect(task.importedKnowledgeDocumentId).toBeNull();
    expect(add).toHaveBeenCalledWith("fetch_task", { taskId: "task-1" }, expect.objectContaining({ jobId: "collection-fetch-task-1" }));
    expect(inserts.some((row) => (row as { action?: string }).action === "collection.task_created")).toBe(true);
  });
});

describe("自动采集源任务", () => {
  it("已有进行中任务时拒绝重复入队", async () => {
    const { db } = makeDb({ selects: [[{ id: "inflight-1" }]] });
    await expect(createAutoCollectionTask(
      { db: db as never, storage: {} as never, queues: { collectionFetch: { add: vi.fn() }, documentProcessing: { add: vi.fn() } } as never },
      { id: "src-1", name: "源", sourceUrl: "https://example.com/a.pdf", mode: "AUTO", enabled: true, lastCollectedAt: null, createdById: actor.id, createdAt: new Date(), updatedAt: new Date() },
      actor.id
    )).rejects.toBeInstanceOf(CollectionError);
  });

  it("扫描时跳过间隔内已采集的来源", async () => {
    const recent = new Date(Date.now() - 60_000);
    const { db } = makeDb({
      selects: [[{
        id: "src-1", name: "源", sourceUrl: "https://example.com/a.pdf", mode: "AUTO", enabled: true,
        lastCollectedAt: recent, createdById: actor.id, createdAt: recent, updatedAt: recent
      }]]
    });
    const add = vi.fn();
    const result = await scanEnabledCollectionSources({
      db: db as never, storage: {} as never, queues: { collectionFetch: { add }, documentProcessing: { add: vi.fn() } } as never
    });
    expect(result.enqueued).toBe(0);
    expect(add).not.toHaveBeenCalled();
    expect(COLLECTION_AUTO_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("采集执行", () => {
  it("下载成功后进入 WAITING_CONFIRM，不创建 Knowledge 文档", async () => {
    const taskRow = {
      id: "task-1", sourceId: null, name: "手册", sourceUrl: "https://example.com/file.pdf",
      mode: "MANUAL", status: "PENDING", resultFileId: null, createdById: actor.id
    };
    const { db, inserts, updates } = makeDb({
      selects: [[taskRow]],
      insertReturning: [{ id: "file-1" }]
    });
    const putObject = vi.fn(async () => undefined);
    const httpFetch = vi.fn(async () => new Response(Buffer.from("%PDF-1.4"), {
      status: 200,
      headers: { "content-type": "application/pdf" }
    }));
    const result = await runCollectionTask(
      { db: db as never, storage: { provider: "minio", bucket: "vicp", putObject } as never },
      "task-1",
      httpFetch as never
    );
    expect(result.status).toBe("WAITING_CONFIRM");
    expect(putObject).toHaveBeenCalled();
    expect(inserts[0]).toMatchObject({ source: "COLLECTION", status: "READY" });
    expect(updates.some((row) => row.status === "WAITING_CONFIRM")).toBe(true);
    expect(inserts.every((row) => !(row as { title?: string; docType?: string }).docType)).toBe(true);
  });

  it("HTTP 失败进入 FAILED", async () => {
    const { db, updates } = makeDb({
      selects: [[{ id: "task-2", name: "坏链", sourceUrl: "https://example.com/missing.pdf", mode: "AUTO", status: "PENDING", createdById: actor.id }]]
    });
    const result = await runCollectionTask(
      { db: db as never, storage: { putObject: vi.fn() } as never },
      "task-2",
      vi.fn(async () => new Response("nope", { status: 404 })) as never
    );
    expect(result.status).toBe("FAILED");
    expect(updates.some((row) => row.status === "FAILED")).toBe(true);
  });
});

describe("确认入库", () => {
  it("非 WAITING_CONFIRM 不能导入", async () => {
    const { db } = makeDb({
      selects: [[{ id: "task-3", status: "PENDING", resultFileId: "file-1", importedKnowledgeDocumentId: null }]]
    });
    await expect(importCollectionTaskToKnowledge({ db } as never, request, actor, "task-3"))
      .rejects.toMatchObject({ code: "COLLECTION_TASK_NOT_CONFIRMABLE" });
  });

  it("已导入不能重复入库", async () => {
    const { db } = makeDb({
      selects: [[{ id: "task-4", status: "WAITING_CONFIRM", resultFileId: "file-1", importedKnowledgeDocumentId: "doc-1" }]]
    });
    await expect(importCollectionTaskToKnowledge({ db } as never, request, actor, "task-4"))
      .rejects.toMatchObject({ code: "COLLECTION_TASK_ALREADY_IMPORTED" });
  });

  it("缺少结果文件不能导入", async () => {
    const { db } = makeDb({
      selects: [[{ id: "task-5", status: "WAITING_CONFIRM", resultFileId: null, importedKnowledgeDocumentId: null }]]
    });
    await expect(importCollectionTaskToKnowledge({ db } as never, request, actor, "task-5"))
      .rejects.toMatchObject({ code: "COLLECTION_RESULT_MISSING" });
  });

  it("任务不存在", async () => {
    const { db } = makeDb({ selects: [[]] });
    await expect(getCollectionTask({ db } as never, "missing")).rejects.toBeInstanceOf(NotFoundError);
  });
});

import "dotenv/config";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { knowledgeChunks, knowledgeDocumentVersions, knowledgePages, thermalReferenceRows } from "../../db/schema.js";
import { pageRecognitionResultSchema } from "../../shared/page-recognition.js";
import { assessBatchConfirmSafety, confirmPageRecognition, syncThermalRowsFromConfirmedPage } from "./knowledge-page-recognition.service.js";

const fixture = () => pageRecognitionResultSchema.parse(JSON.parse(readFileSync(new URL("../../../tests/fixtures/complex-atlas/page-90.json", import.meta.url), "utf8")).data);

/** 只使用内存事务桩，不连接数据库、Redis或对象存储。 */
function harness(data: ReturnType<typeof fixture>) {
  const page: any = { id: "page-1", documentId: "doc-1", versionId: "version-1", physicalPageNumber: 1,
    pageLabel: "90", pageTitle: "热工表", pageLabelVerified: false, metadata: { recognitionStatus: "REVIEW_REQUIRED", draftStructuredData: data } };
  const state = { thermalWrites: 0, chunks: 0, metadata: undefined as any };
  const executor: any = {
    execute: vi.fn(async () => undefined),
    select: () => { let table: unknown; const rows = () => table === knowledgePages ? [page]
      : table === knowledgeDocumentVersions ? [{ id: "version-1", status: "DRAFT" }] : table === knowledgeChunks ? [{ maxIndex: -1 }] : [];
      const query: any = { from: (value: unknown) => { table = value; return query; }, where: () => query,
        limit: async () => rows(), then: (resolve: (value: unknown) => void) => resolve(rows()) }; return query; },
    insert: (table: unknown) => ({ values: async () => { if (table === knowledgeChunks) state.chunks++;
      if (table === thermalReferenceRows) state.thermalWrites++; } }),
    update: () => ({ set: (patch: any) => ({ where: async () => { if (patch.metadata) { state.metadata = patch.metadata; page.metadata = patch.metadata; } } }) }),
    transaction: (callback: (tx: any) => unknown) => callback(executor)
  };
  return { app: { db: executor, log: { warn: vi.fn() }, storage: { createDownloadUrl: vi.fn() } } as any, state, executor };
}

describe("v2人工确认与正式同步边界", () => {
  it("无印刷编号、无产品整体R可人工确认资料页，保留两组同值与原备注，不写热工行", async () => {
    const data = fixture(), { app, state } = harness(data);
    const result = await confirmPageRecognition(app, { headers: {} } as any, { id: "reviewer" } as any, "page-1", {});
    expect(result.recognitionStatus).toBe("CONFIRMED");
    expect(state.chunks).toBeGreaterThan(0);
    expect(state.thermalWrites).toBe(0);
    expect(state.metadata.confirmedStructuredData).toEqual(data);
    expect(state.metadata.confirmedById).toBe("reviewer");
    expect(state.metadata.thermalSync.status).toBe("NOT_SYNCED");
    expect(result.recognition.renderModel?.constructions).toHaveLength(2);
    expect(assessBatchConfirmSafety(data).safe).toBe(false);
  });

  it("直接确认证据矛盾草稿时拒绝，尚未重建chunk或写确认快照", async () => {
    const data = fixture(); data.systems[0]!.options![0]!.kValue = .999;
    const { app, state, executor } = harness(data);
    await expect(confirmPageRecognition(app, { headers: {} } as any, { id: "reviewer" } as any, "page-1", {}))
      .rejects.toMatchObject({ code: "PAGE_RECOGNITION_EVIDENCE_INVALID" });
    expect(state).toMatchObject({ chunks: 0, thermalWrites: 0, metadata: undefined });
    expect(executor.execute).toHaveBeenCalledOnce(); // 只有row lock
  });

  it("同步入口独立校验证据，拒绝发生在任何删除/写入之前", async () => {
    const data = fixture(); data.systems[0]!.options![0]!.productThermalResistance = 2.4;
    const db = { delete: vi.fn(), select: vi.fn(), insert: vi.fn() };
    await expect(syncThermalRowsFromConfirmedPage(db as any, { id: "reviewer" } as any, {} as any, data, "set-1"))
      .rejects.toMatchObject({ code: "PAGE_RECOGNITION_EVIDENCE_INVALID" });
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});

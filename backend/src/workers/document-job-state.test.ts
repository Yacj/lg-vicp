import { describe, expect, it } from "vitest";
import { isTerminalDocumentFailure, reconcileDocumentJobFailure, type DocumentJobData } from "./document-job-state.js";

type UpdateRecord = Record<string, unknown>;

function createDatabaseMock(returningRows: Array<{ id: string }> = [{ id: "updated" }]) {
  const updates: UpdateRecord[] = [];
  const executor = {
    update: () => ({
      set: (values: UpdateRecord) => {
        updates.push(values);
        return {
          where: () => ({ returning: async () => returningRows })
        };
      }
    })
  };
  return {
    updates,
    db: {
      transaction: async <T>(callback: (tx: typeof executor) => Promise<T>) => callback(executor)
    }
  };
}

describe("文档任务终态判断", () => {
  it("stalled 超限和不可恢复错误直接进入终态", () => {
    expect(isTerminalDocumentFailure({
      attemptsMade: 1,
      configuredAttempts: 3,
      errorName: "UnrecoverableError",
      failedReason: "job stalled more than allowable limit"
    })).toBe(true);
  });

  it("可重试错误在剩余重试次数内不进入终态", () => {
    expect(isTerminalDocumentFailure({
      attemptsMade: 1,
      configuredAttempts: 3,
      errorName: "Error",
      failedReason: "对象存储暂时不可用"
    })).toBe(false);
  });
});

describe("文档任务失败状态收敛", () => {
  it("解析任务终态失败时更新任务、版本和文件", async () => {
    const { db, updates } = createDatabaseMock();
    const data: DocumentJobData = {
      fileId: "file-1",
      parsingJobId: "parse-1",
      versionId: "version-1",
      jobType: "PARSE"
    };

    const updated = await reconcileDocumentJobFailure(db as never, data, "job stalled more than allowable limit", 2);

    expect(updated).toBe(true);
    expect(updates).toContainEqual(expect.objectContaining({
      status: "FAILED",
      errorMessage: "job stalled more than allowable limit",
      attempts: 2
    }));
    expect(updates).toContainEqual(expect.objectContaining({ parseStatus: "FAILED", pipelineStatus: "FAILED" }));
    expect(updates.filter((values) => values.status === "FAILED")).toHaveLength(2);
  });

  it("分块重建失败时不将已解析文件标记为失败", async () => {
    const { db, updates } = createDatabaseMock();
    const data: DocumentJobData = {
      fileId: "file-1",
      parsingJobId: "parse-1",
      versionId: "version-1",
      jobType: "CHUNK_REBUILD"
    };

    await reconcileDocumentJobFailure(db as never, data, "切片重建失败");

    expect(updates).toContainEqual(expect.objectContaining({ pipelineStatus: "FAILED" }));
    expect(updates.some((values) => values.parseStatus === "FAILED")).toBe(false);
    expect(updates.filter((values) => values.status === "FAILED")).toHaveLength(1);
  });

  it("仅在任务仍处于处理中时回写，确保重复事件幂等", async () => {
    const { db, updates } = createDatabaseMock([]);
    const data: DocumentJobData = { taskId: "task-1", fileId: "file-1" };

    const updated = await reconcileDocumentJobFailure(db as never, data, "终态失败");

    expect(updated).toBe(false);
    expect(updates).toHaveLength(1);
  });
});
import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { ConflictError } from "../../shared/errors.js";
import {
  assertKnowledgeFileUsable,
  buildUserChapterTree,
  createKnowledgeWithFile,
  replaceDocumentFile
} from "./knowledge-workflow.service.js";
import { maybeEnqueueUpgradeAfterSearchSourceBound } from "./knowledge-admin.service.js";

const actor = { id: "user-1", role: "SUPER_ADMIN" as const, channelType: null, adminLoginEnabled: true, clientType: "B_ADMIN" as const };
const request = { id: "req-1", ip: "127.0.0.1", headers: {} } as any;

const readyPdf = {
  id: "file-001",
  originalName: "保温图集.pdf",
  status: "READY",
  mimeType: "application/pdf",
  deletedAt: null
};

function insertThenables(inserts: unknown[]) {
  return {
    values: (vals: Record<string, unknown>) => {
      inserts.push(vals);
      const result = Promise.resolve() as Promise<void> & { returning: () => Promise<unknown[]> };
      result.returning = async () => {
        if (vals.title && vals.docType && vals.version == null) {
          return [{ id: "doc-1", title: vals.title, docType: vals.docType }];
        }
        if (vals.version != null) return [{ id: "ver-1", version: vals.version }];
        if (vals.jobType) return [{ id: "job-1", status: "QUEUED" }];
        return [{ id: "row-1" }];
      };
      return result;
    }
  };
}

describe("assertKnowledgeFileUsable", () => {
  it("拒绝未就绪或非法类型", () => {
    expect(() => assertKnowledgeFileUsable({ id: "f", status: "UPLOADING", mimeType: "application/pdf" }))
      .toThrow(ConflictError);
    expect(() => assertKnowledgeFileUsable({ id: "f", status: "READY", mimeType: "image/png" }))
      .toThrow("PDF 或 DOCX");
    expect(() => assertKnowledgeFileUsable({ id: "f", status: "RECYCLED", mimeType: "application/pdf" }))
      .toThrow("回收站");
  });

  it("接受 READY 的 PDF/DOCX", () => {
    expect(() => assertKnowledgeFileUsable({ id: "f", status: "READY", mimeType: "application/pdf" })).not.toThrow();
    expect(() => assertKnowledgeFileUsable({
      id: "f",
      status: "READY",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    })).not.toThrow();
  });
});

describe("createKnowledgeWithFile", () => {
  it("READY 文件同事务创建文档/v1/资产/解析任务并入队", async () => {
    const inserts: Record<string, unknown>[] = [];
    const add = vi.fn().mockResolvedValue(undefined);
    const app = {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [readyPdf]
            })
          })
        }),
        transaction: async (fn: (tx: any) => Promise<unknown>) => fn({
          insert: () => insertThenables(inserts),
          select: () => ({
            from: () => ({
              where: async () => [{ max: 0 }]
            })
          })
        }),
        update: () => ({ set: () => ({ where: async () => [] }) })
      },
      queues: { documentProcessing: { add } }
    } as any;

    const result = await createKnowledgeWithFile(app, request, actor, {
      title: "保温图集",
      docType: "DETAIL_ATLAS",
      originalFileId: "file-001"
    });

    expect(result.document).toEqual({ id: "doc-1", title: "保温图集", docType: "DETAIL_ATLAS" });
    expect(result.version).toEqual({ id: "ver-1", versionNo: 1 });
    expect(result.file).toEqual({ id: "file-001", name: "保温图集.pdf" });
    expect(result.parsing).toEqual({ jobId: "job-1", status: "QUEUED" });
    expect(inserts.some((row) => row.role === "ORIGINAL" && row.fileId === "file-001")).toBe(true);
    expect(inserts.some((row) => row.jobType === "PARSE")).toBe(true);
    expect(inserts.some((row) => row.role === "SEARCH_SOURCE")).toBe(false);
    expect(add).toHaveBeenCalledWith("parse_document", {
      parsingJobId: "job-1",
      fileId: "file-001",
      versionId: "ver-1",
      jobType: "PARSE"
    }, { jobId: "job-1" });
  });

  it("非 READY 文件拒绝创建", async () => {
    const app = {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [{ ...readyPdf, status: "UPLOADING" }]
            })
          })
        })
      }
    } as any;
    await expect(createKnowledgeWithFile(app, request, actor, {
      title: "保温图集",
      docType: "OTHER",
      originalFileId: "file-001"
    })).rejects.toThrow("尚未就绪");
  });
});

describe("replaceDocumentFile", () => {
  it("新建下一版本并自动入队 PARSE，不改旧版本", async () => {
    const inserts: Record<string, unknown>[] = [];
    const add = vi.fn().mockResolvedValue(undefined);
    let selectCall = 0;
    const app = {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => {
                selectCall += 1;
                return selectCall === 1
                  ? [{
                    id: "doc-1",
                    title: "保温图集",
                    docType: "DETAIL_ATLAS",
                    evidenceLevel: "A",
                    currentVersionId: "ver-old",
                    deletedAt: null
                  }]
                  : [readyPdf];
              }
            })
          })
        }),
        transaction: async (fn: (tx: any) => Promise<unknown>) => fn({
          insert: () => insertThenables(inserts),
          select: () => ({
            from: () => ({
              where: async () => [{ max: 1 }]
            })
          })
        }),
        update: () => ({ set: () => ({ where: async () => [] }) })
      },
      queues: { documentProcessing: { add } }
    } as any;

    const result = await replaceDocumentFile(app, request, actor, "doc-1", {
      originalFileId: "file-001"
    });
    expect(result.version.versionNo).toBe(2);
    expect(result.parsing.jobId).toBe("job-1");
    expect(add).toHaveBeenCalledWith("parse_document", expect.objectContaining({
      jobType: "PARSE",
      versionId: "ver-1"
    }), { jobId: "job-1" });
  });
});

describe("maybeEnqueueUpgradeAfterSearchSourceBound", () => {
  it("NO_TEXT_LAYER 且已有页面时自动投递 UPGRADE_PARSE", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const inserts: Record<string, unknown>[] = [];
    const app = {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => [{ id: "page-1" }]
            })
          })
        }),
        transaction: async (fn: (tx: any) => Promise<unknown>) => fn({
          insert: () => insertThenables(inserts)
        }),
        update: () => ({ set: () => ({ where: async () => [] }) })
      },
      queues: { documentProcessing: { add } }
    } as any;

    const result = await maybeEnqueueUpgradeAfterSearchSourceBound(app, request, actor, {
      id: "ver-1",
      documentId: "doc-1",
      fileId: "file-001",
      parseStatus: "SEARCH_SOURCE_REQUIRED"
    }, "SEARCH_SOURCE");

    expect(result.jobId).toBe("job-1");
    expect(add).toHaveBeenCalledWith("parse_document", expect.objectContaining({
      jobType: "UPGRADE_PARSE",
      versionId: "ver-1"
    }), { jobId: "job-1" });
  });

  it("解析尚未进入无文本层状态时不自动升级", async () => {
    const add = vi.fn();
    const result = await maybeEnqueueUpgradeAfterSearchSourceBound({
      db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "page-1" }] }) }) }) },
      queues: { documentProcessing: { add } }
    } as any, request, actor, {
      id: "ver-1",
      documentId: "doc-1",
      fileId: "file-001",
      parseStatus: "PENDING"
    }, "SEARCH_SOURCE");
    expect(result.jobId).toBeUndefined();
    expect(add).not.toHaveBeenCalled();
  });
});

describe("buildUserChapterTree", () => {
  it("按 parentId 组树且不暴露 source", () => {
    const tree = buildUserChapterTree([
      { id: "a", parentId: null, title: "第一章", level: 1, pageLabel: "1", physicalPageNumber: 1, sortOrder: 1 },
      { id: "b", parentId: "a", title: "1.1 构造", level: 2, pageLabel: "3", physicalPageNumber: 3, sortOrder: 2 }
    ]);
    expect(tree).toEqual([{
      id: "a",
      title: "第一章",
      level: 1,
      pageLabel: "1",
      physicalPageNumber: 1,
      children: [{
        id: "b",
        title: "1.1 构造",
        level: 2,
        pageLabel: "3",
        physicalPageNumber: 3
      }]
    }]);
    expect(JSON.stringify(tree)).not.toContain("PDF_BOOKMARK");
  });
});

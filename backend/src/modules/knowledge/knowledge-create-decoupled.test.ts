import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../shared/auth-user.js";
import {
  createDocument,
  createDocumentVersion,
  completeVersionUpload,
  publishVersion
} from "./knowledge-admin.service.js";
import { assertVersionPublishable } from "./knowledge-original.service.js";
import { createKnowledgeWithFile } from "./knowledge-workflow.service.js";

/**
 * 知识库创建与文件上传解耦回归：
 * 允许「先建知识库、后补资料」；空 DRAFT 合法；空版本不允许发布；创建不产生无意义 Worker 任务。
 */

const actor: AuthUser = {
  id: "user-1",
  role: "SUPER_ADMIN",
  channelType: null,
  adminLoginEnabled: true,
  clientType: "B_ADMIN"
} as AuthUser;

const request = { id: "req-1", ip: "127.0.0.1", headers: {} } as any;

/** 记录所有 insert 载荷，并按行形态返回可辨识的主键 */
function txMock(inserts: Record<string, unknown>[]) {
  return {
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        inserts.push(vals);
        const result = Promise.resolve() as Promise<void> & { returning: () => Promise<unknown[]> };
        result.returning = async () => {
          if (vals.title != null && vals.version == null && vals.action == null) {
            return [{ id: "doc-1", title: vals.title, docType: vals.docType, currentVersionId: null }];
          }
          if (vals.documentId != null && vals.version != null) {
            return [{
              id: "ver-1",
              version: vals.version,
              status: vals.status,
              pipelineStatus: vals.pipelineStatus,
              fileId: vals.fileId ?? null
            }];
          }
          if (vals.jobType != null) return [{ id: "job-1", status: "QUEUED" }];
          return [{ id: "row-1" }];
        };
        return result;
      }
    }),
    select: () => ({ from: () => ({ where: async () => [{ max: 0 }] }) })
  };
}

function draftApp(inserts: Record<string, unknown>[]) {
  const add = vi.fn().mockResolvedValue(undefined);
  return {
    app: {
      db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock(inserts)) },
      queues: { documentProcessing: { add } }
    } as any,
    add
  };
}

describe("Case A/E：无文件创建知识库", () => {
  it("POST /documents 只传基本信息 → 文档 + DRAFT v1，0 页面合法，不产生解析任务", async () => {
    const inserts: Record<string, unknown>[] = [];
    const { app, add } = draftApp(inserts);

    const created = await createDocument(app, request, actor, {
      title: "岩棉外墙外保温系统构造",
      docType: "DETAIL_ATLAS"
    });

    expect(created.document).toMatchObject({ id: "doc-1", title: "岩棉外墙外保温系统构造", docType: "DETAIL_ATLAS" });
    expect(created.version).toMatchObject({ id: "ver-1", status: "DRAFT", pipelineStatus: "UPLOAD_PENDING" });
    // 空 DRAFT 版本：不持有文件
    expect(created.version.fileId).toBeNull();
    // 不产生解析任务、不投递 Worker
    expect(inserts.some((row) => row.jobType != null)).toBe(false);
    expect(add).not.toHaveBeenCalled();
  });

  it("create-with-file 不传 originalFileId → 同样只建空 DRAFT，返回 versionId/versionStatus", async () => {
    const inserts: Record<string, unknown>[] = [];
    const { app, add } = draftApp(inserts);

    const created = await createKnowledgeWithFile(app, request, actor, {
      title: "地方标准摘编",
      docType: "STANDARD"
    });

    expect(created.document).toEqual({ id: "doc-1", title: "地方标准摘编", docType: "STANDARD" });
    expect(created.version).toEqual({ id: "ver-1", versionNo: 1 });
    expect(created.versionId).toBe("ver-1");
    expect(created.versionStatus).toBe("DRAFT");
    expect(created.file).toBeNull();
    expect(created.parsing).toBeNull();
    expect(inserts.some((row) => row.jobType != null)).toBe(false);
    expect(add).not.toHaveBeenCalled();
  });
});

describe("Case B：旧参数兼容", () => {
  it("create-with-file 传 originalFileId → 绑定 ORIGINAL 附件并自动解析", async () => {
    const inserts: Record<string, unknown>[] = [];
    const add = vi.fn().mockResolvedValue(undefined);
    const readyPdf = { id: "file-001", originalName: "保温图集.pdf", status: "READY", mimeType: "application/pdf", deletedAt: null };
    let selectCall = 0;
    const app = {
      db: {
        select: () => ({
          from: () => ({
            innerJoin: () => ({ where: () => ({ limit: async () => [] }) }),
            where: () => ({ limit: async () => (++selectCall === 1 ? [readyPdf] : []) })
          })
        }),
        transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock(inserts)),
        update: () => ({ set: () => ({ where: async () => [] }) })
      },
      queues: { documentProcessing: { add } }
    } as any;

    const created = await createKnowledgeWithFile(app, request, actor, {
      title: "保温图集",
      docType: "DETAIL_ATLAS",
      originalFileId: "file-001"
    });

    expect(created.versionId).toBe("ver-1");
    expect(created.versionStatus).toBe("DRAFT");
    expect(created.file).toEqual({ id: "file-001", name: "保温图集.pdf" });
    expect(created.parsing).toEqual({ jobId: "job-1", status: "QUEUED" });
    expect(inserts.some((row) => row.role === "ORIGINAL" && row.fileId === "file-001")).toBe(true);
    expect(inserts.some((row) => row.jobType === "PARSE")).toBe(true);
    expect(add).toHaveBeenCalledWith("parse_document", expect.objectContaining({ versionId: "ver-1" }), { jobId: "job-1" });
  });
});

describe("Case F：创建新 Version 不要求文件", () => {
  it("POST /documents/:id/versions 不传文件 → 直接创建 DRAFT 版本", async () => {
    const inserts: Record<string, unknown>[] = [];
    const document = { id: "doc-1", title: "保温图集", docType: "DETAIL_ATLAS", evidenceLevel: null };
    const app = {
      db: {
        select: () => ({ from: () => ({ where: () => ({ limit: async () => [document] }) }) }),
        transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock(inserts))
      }
    } as any;

    const version = await createDocumentVersion(app, request, actor, "doc-1", {});

    expect(version).toMatchObject({ id: "ver-1", status: "DRAFT" });
    expect(inserts.some((row) => row.role === "ORIGINAL")).toBe(false);
    expect(inserts.some((row) => row.jobType != null)).toBe(false);
  });
});

describe("Case C：空 Version 不允许发布", () => {
  it("0 页面 → KNOWLEDGE_VERSION_EMPTY（先于解析状态判断）", async () => {
    const app = {
      db: { select: () => ({ from: () => ({ where: async () => [] }) }) }
    } as any;
    const version = { id: "ver-1", usageMode: "AI_ENABLED", parseStatus: "PENDING" } as any;

    await expect(assertVersionPublishable(app, version)).rejects.toMatchObject({
      code: "KNOWLEDGE_VERSION_EMPTY",
      statusCode: 400,
      message: "当前知识库还没有资料页面，请先上传页面后再发布。"
    });
  });
});

describe("Case D：上传页面后按 readiness 放行/拦截", () => {
  function readinessApp(datasets: unknown[][]) {
    let call = 0;
    return {
      db: { select: () => ({ from: () => ({ where: async () => datasets[call++] ?? [] }) }) },
      log: { warn: () => undefined }
    } as any;
  }

  it("离线页图识别未确认 → KNOWLEDGE_VERSION_PAGES_UNCONFIRMED", async () => {
    const app = readinessApp([
      [{ role: "ORIGINAL" }],
      [],
      [],
      [{ pageLabelSource: "FALLBACK", pageImageObjectKey: "knowledge/page-images/1.png", metadata: { uploadSource: "ZIP", recognitionStatus: "PENDING" } }]
    ]);
    const version = { id: "ver-1", usageMode: "AI_ENABLED", parseStatus: "PARSED" } as any;

    await expect(assertVersionPublishable(app, version)).rejects.toMatchObject({
      code: "KNOWLEDGE_VERSION_PAGES_UNCONFIRMED",
      statusCode: 400
    });
  });

  it("页面齐备且识别已确认（且已生成 chunks）→ 通过门禁（仅软提示）", async () => {
    const app = readinessApp([
      [{ role: "ORIGINAL" }],
      [],
      [],
      [{ pageLabelSource: "PARSED", pageImageObjectKey: "knowledge/page-images/1.png", metadata: { uploadSource: "ZIP", recognitionStatus: "CONFIRMED" } }],
      // chunkCount：AI_ENABLED 正式发布必须有可检索内容
      [{ value: 3 }]
    ]);
    const version = { id: "ver-1", usageMode: "AI_ENABLED", parseStatus: "PARSED" } as any;

    const result = await assertVersionPublishable(app, version);
    expect(result.eligible).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("页面齐备但 chunkCount=0 → KNOWLEDGE_SEARCHABLE_CONTENT_REQUIRED（AI_ENABLED 不可发布）", async () => {
    const app = readinessApp([
      [{ role: "ORIGINAL" }],
      [],
      [],
      [{ pageLabelSource: "PARSED", pageImageObjectKey: "knowledge/page-images/1.png", metadata: { uploadSource: "ZIP", recognitionStatus: "CONFIRMED" } }],
      [{ value: 0 }]
    ]);
    const version = { id: "ver-1", usageMode: "AI_ENABLED", parseStatus: "PARSED" } as any;

    await expect(assertVersionPublishable(app, version)).rejects.toMatchObject({
      code: "KNOWLEDGE_SEARCHABLE_CONTENT_REQUIRED",
      statusCode: 400
    });
  });
});

describe("Case G：PUBLISHED immutable 与发布状态错误", () => {
  it("已发布版本不能上传/绑定文件", async () => {
    const app = {
      db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "ver-1", status: "PUBLISHED" }] }) }) }) }
    } as any;

    await expect(completeVersionUpload(app, request, actor, "ver-1", "file-1")).rejects.toMatchObject({
      code: "KNOWLEDGE_VERSION_NOT_EDITABLE"
    });
  });

  it("重复发布 → KNOWLEDGE_VERSION_ALREADY_PUBLISHED", async () => {
    const app = {
      db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "ver-1", status: "PUBLISHED", documentId: "doc-1" }] }) }) }) }
    } as any;

    await expect(publishVersion(app, request, actor, "ver-1")).rejects.toMatchObject({
      code: "KNOWLEDGE_VERSION_ALREADY_PUBLISHED",
      statusCode: 400
    });
  });

  it("未审核通过（DRAFT）→ KNOWLEDGE_VERSION_NOT_APPROVED", async () => {
    const app = {
      db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "ver-1", status: "DRAFT", documentId: "doc-1" }] }) }) }) }
    } as any;

    await expect(publishVersion(app, request, actor, "ver-1")).rejects.toMatchObject({
      code: "KNOWLEDGE_VERSION_NOT_APPROVED",
      statusCode: 400
    });
  });
});

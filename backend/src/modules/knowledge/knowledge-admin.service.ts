import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { env } from "../../config/env.js";
import { ConflictError, ForbiddenError, NotFoundError, ServiceUnavailableError } from "../../shared/errors.js";
import {
  files,
  knowledgeAliases,
  knowledgeCategories,
  knowledgeChunkTerms,
  knowledgeChunks,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  knowledgePages,
  parsingJobs
} from "../../db/schema.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { assertNoDuplicateSha256 } from "./knowledge-ingest.service.js";

/**
 * 知识库管理服务：分类、文档、版本（上传/解析/审核/发布/停用/版本替代）、
 * 别名词典与解析任务。版本状态机：
 * DRAFT -> APPROVED -> PUBLISHED -> DISABLED；回滚复制历史版本为新草稿，历史版本不删除。
 */

export type KnowledgeDocType =
  | "SPECIFICATION" | "DETAIL_ATLAS" | "STANDARD" | "APPLICATION_GUIDE"
  | "MATERIAL_COMPARISON" | "COMPANY_PROFILE" | "THERMAL_FORMULA" | "OTHER";

export type KnowledgeEvidenceLevel = "A" | "B" | "C";
export type KnowledgeTermType = "KEYWORD" | "SYNONYM" | "ENTITY" | "CLAUSE_NO";
export type KnowledgeChunkContentType =
  | "PARAGRAPH" | "TITLE" | "SECTION" | "CLAUSE" | "TABLE" | "NOTE" | "FORMULA" | "IMAGE_CAPTION";
export type ParsingJobStatus = "QUEUED" | "ACTIVE" | "COMPLETED" | "FAILED" | "OCR_REQUIRED";

export interface ListDocumentsQuery {
  page: number;
  pageSize: number;
  status?: string;
  docType?: string;
  categoryId?: string;
  keyword?: string;
}

function safeExtension(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return extension.slice(0, 12);
}

async function requireDocument(app: FastifyInstance, id: string) {
  const [document] = await app.db.select().from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.id, id), isNull(knowledgeDocuments.deletedAt))).limit(1);
  if (!document) throw new NotFoundError("知识文档不存在");
  return document;
}

async function requireVersion(app: FastifyInstance, versionId: string) {
  const [version] = await app.db.select().from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
  if (!version) throw new NotFoundError("文档版本不存在");
  return version;
}

async function requireActiveFile(app: FastifyInstance, fileId: string) {
  const [file] = await app.db.select().from(files)
    .where(and(eq(files.id, fileId), isNull(files.deletedAt))).limit(1);
  if (!file) throw new NotFoundError("文件不存在");
  return file;
}

export async function nextVersionNumber(db: DbExecutor, documentId: string): Promise<number> {
  const [row] = await db.select({ max: sql<number>`coalesce(max(${knowledgeDocumentVersions.version}), 0)` })
    .from(knowledgeDocumentVersions).where(eq(knowledgeDocumentVersions.documentId, documentId));
  return (row?.max ?? 0) + 1;
}

// ---------------------------------------------------------------- 分类

export async function listCategories(app: FastifyInstance) {
  return app.db.select().from(knowledgeCategories)
    .where(eq(knowledgeCategories.enabled, true)).orderBy(knowledgeCategories.sortOrder);
}

export async function createCategory(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  input: { name: string; code: string; parentId?: string; sortOrder?: number; description?: string }
) {
  const category = await app.db.transaction(async (tx) => {
    const [created] = await tx.insert(knowledgeCategories).values({
      name: input.name,
      code: input.code,
      parentId: input.parentId,
      sortOrder: input.sortOrder ?? 0,
      description: input.description
    }).onConflictDoNothing().returning();
    if (!created) throw new ConflictError("分类编码已存在");
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_CATEGORY_CREATED, targetType: "knowledge_category", targetId: created.id,
      afterJson: { name: created.name, code: created.code }
    });
    return created;
  });
  return category;
}

export async function updateCategory(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  id: string,
  input: { name?: string; code?: string; parentId?: string | null; sortOrder?: number; enabled?: boolean; description?: string | null }
) {
  const [existing] = await app.db.select().from(knowledgeCategories).where(eq(knowledgeCategories.id, id)).limit(1);
  if (!existing) throw new NotFoundError("知识分类不存在");
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(knowledgeCategories).set({
      name: input.name ?? existing.name,
      code: input.code ?? existing.code,
      parentId: input.parentId === undefined ? existing.parentId : input.parentId,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      enabled: input.enabled ?? existing.enabled,
      description: input.description === undefined ? existing.description : input.description,
      updatedAt: new Date()
    }).where(eq(knowledgeCategories.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_CATEGORY_UPDATED, targetType: "knowledge_category", targetId: id,
      beforeJson: existing, afterJson: updated
    });
    return updated!;
  });
}

export async function deleteCategory(app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string) {
  const [existing] = await app.db.select().from(knowledgeCategories).where(eq(knowledgeCategories.id, id)).limit(1);
  if (!existing) throw new NotFoundError("知识分类不存在");
  const [used] = await app.db.select({ value: count() }).from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.categoryId, id), isNull(knowledgeDocuments.deletedAt)));
  if ((used?.value ?? 0) > 0) throw new ConflictError("该分类下存在知识文档，不能删除");
  await app.db.transaction(async (tx) => {
    await tx.delete(knowledgeCategories).where(eq(knowledgeCategories.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_CATEGORY_DELETED, targetType: "knowledge_category", targetId: id,
      beforeJson: existing
    });
  });
  return { message: "知识分类已删除" };
}

// ---------------------------------------------------------------- 文档

export async function listDocuments(app: FastifyInstance, query: ListDocumentsQuery) {
  const { skip, take } = (() => {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    return { skip: (page - 1) * pageSize, take: pageSize };
  })();
  const where = and(
    isNull(knowledgeDocuments.deletedAt),
    query.status ? eq(knowledgeDocuments.status, query.status as "ACTIVE" | "DISABLED") : undefined,
    query.docType ? eq(knowledgeDocuments.docType, query.docType as KnowledgeDocType) : undefined,
    query.categoryId ? eq(knowledgeDocuments.categoryId, query.categoryId) : undefined,
    query.keyword ? sql`(${knowledgeDocuments.title} ilike ${`%${query.keyword}%`} or ${knowledgeDocuments.docNumber} ilike ${`%${query.keyword}%`})` : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select({
      id: knowledgeDocuments.id,
      title: knowledgeDocuments.title,
      docNumber: knowledgeDocuments.docNumber,
      docType: knowledgeDocuments.docType,
      sourceOrg: knowledgeDocuments.sourceOrg,
      issueDate: knowledgeDocuments.issueDate,
      effectiveDate: knowledgeDocuments.effectiveDate,
      evidenceLevel: knowledgeDocuments.evidenceLevel,
      allowedPurposes: knowledgeDocuments.allowedPurposes,
      categoryId: knowledgeDocuments.categoryId,
      status: knowledgeDocuments.status,
      currentVersionId: knowledgeDocuments.currentVersionId,
      currentVersion: {
        version: knowledgeDocumentVersions.version,
        status: knowledgeDocumentVersions.status,
        parseStatus: knowledgeDocumentVersions.parseStatus,
        pageCount: knowledgeDocumentVersions.pageCount,
        parser: knowledgeDocumentVersions.parser
      },
      createdAt: knowledgeDocuments.createdAt,
      updatedAt: knowledgeDocuments.updatedAt
    })
      .from(knowledgeDocuments)
      .leftJoin(knowledgeDocumentVersions, eq(knowledgeDocumentVersions.id, knowledgeDocuments.currentVersionId))
      .where(where)
      .orderBy(desc(knowledgeDocuments.updatedAt))
      .offset(skip)
      .limit(take),
    app.db.select({ value: count() }).from(knowledgeDocuments).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function createDocument(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  input: {
    title: string;
    docType?: KnowledgeDocType;
    docNumber?: string;
    sourceOrg?: string;
    issueDate?: string;
    effectiveDate?: string;
    evidenceLevel?: KnowledgeEvidenceLevel;
    allowedPurposes?: string[];
    categoryId?: string;
  }
) {
  const document = await app.db.transaction(async (tx) => {
    const [created] = await tx.insert(knowledgeDocuments).values({
      title: input.title,
      docType: input.docType ?? "OTHER",
      docNumber: input.docNumber,
      sourceOrg: input.sourceOrg,
      issueDate: input.issueDate,
      effectiveDate: input.effectiveDate,
      evidenceLevel: input.evidenceLevel,
      allowedPurposes: input.allowedPurposes ?? [],
      categoryId: input.categoryId,
      status: "ACTIVE",
      createdById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_DOC_CREATED, targetType: "knowledge_document", targetId: created!.id,
      afterJson: { title: created!.title, docType: created!.docType }
    });
    return created!;
  });
  return document;
}

export async function updateDocument(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  id: string,
  input: {
    title?: string;
    docType?: KnowledgeDocType;
    docNumber?: string | null;
    sourceOrg?: string | null;
    issueDate?: string | null;
    effectiveDate?: string | null;
    evidenceLevel?: KnowledgeEvidenceLevel | null;
    allowedPurposes?: string[];
    categoryId?: string | null;
  }
) {
  const existing = await requireDocument(app, id);
  const document = await app.db.transaction(async (tx) => {
    const [updated] = await tx.update(knowledgeDocuments).set({
      title: input.title ?? existing.title,
      docType: input.docType ?? existing.docType,
      docNumber: input.docNumber === undefined ? existing.docNumber : input.docNumber,
      sourceOrg: input.sourceOrg === undefined ? existing.sourceOrg : input.sourceOrg,
      issueDate: input.issueDate === undefined ? existing.issueDate : input.issueDate,
      effectiveDate: input.effectiveDate === undefined ? existing.effectiveDate : input.effectiveDate,
      evidenceLevel: input.evidenceLevel === undefined ? existing.evidenceLevel : input.evidenceLevel,
      allowedPurposes: input.allowedPurposes ?? existing.allowedPurposes,
      categoryId: input.categoryId === undefined ? existing.categoryId : input.categoryId,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(knowledgeDocuments.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_DOC_UPDATED, targetType: "knowledge_document", targetId: id,
      beforeJson: { title: existing.title, docType: existing.docType },
      afterJson: { title: updated!.title, docType: updated!.docType }
    });
    return updated!;
  });
  return document;
}

export async function deleteDocument(app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string) {
  const existing = await requireDocument(app, id);
  const [published] = await app.db.select({ id: knowledgeDocumentVersions.id }).from(knowledgeDocumentVersions)
    .where(and(
      eq(knowledgeDocumentVersions.documentId, id),
      eq(knowledgeDocumentVersions.status, "PUBLISHED")
    )).limit(1);
  if (published) throw new ConflictError("存在已发布版本，不能删除文档；请先停用已发布版本");
  await app.db.transaction(async (tx) => {
    await tx.update(knowledgeDocuments).set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(knowledgeDocuments.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_DOC_DELETED, targetType: "knowledge_document", targetId: id,
      beforeJson: { title: existing.title }
    });
  });
  return { message: "知识文档已删除" };
}

export async function getDocumentDetail(app: FastifyInstance, id: string) {
  const document = await requireDocument(app, id);
  const versions = await app.db.select().from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.documentId, id)).orderBy(desc(knowledgeDocumentVersions.version));
  return { document, versions };
}

// ---------------------------------------------------------------- 版本

export async function createDocumentVersion(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  documentId: string,
  input: { title?: string; changeNote?: string; evidenceLevel?: KnowledgeEvidenceLevel }
) {
  const document = await requireDocument(app, documentId);
  const version = await app.db.transaction(async (tx) => {
    const versionNumber = await nextVersionNumber(tx, documentId);
    const [created] = await tx.insert(knowledgeDocumentVersions).values({
      documentId,
      version: versionNumber,
      title: input.title ?? document.title,
      status: "DRAFT",
      parseStatus: "PENDING",
      evidenceLevel: input.evidenceLevel ?? document.evidenceLevel,
      changeNote: input.changeNote,
      createdById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_VERSION_CREATED, targetType: "knowledge_document_version", targetId: created!.id,
      afterJson: { documentId, version: created!.version }
    });
    return created!;
  });
  return version;
}

/** 创建版本文件直传凭证：复用 files 表与对象存储预签名能力，不触发旧链路自动解析 */
export async function createVersionUploadIntent(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  input: { fileName: string; mimeType: string; sizeBytes: number; sha256?: string }
) {
  const version = await requireVersion(app, versionId);
  if (version.status !== "DRAFT") throw new ConflictError("仅草稿版本允许上传文件");
  if (input.sizeBytes > env.MAX_UPLOAD_BYTES) {
    throw new ForbiddenError(`文件不能超过 ${Math.floor(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB`);
  }
  // SHA-256 去重：与批量导入/爬虫/内部 API 同一规则（按客户端申报哈希，最终以完成校验时实际哈希为准）
  await assertNoDuplicateSha256(app.db, input.sha256 ?? null);
  const fileId = randomUUID();
  const objectKey = `knowledge/${new Date().toISOString().slice(0, 10)}/${fileId}${safeExtension(input.fileName)}`;
  const file = await app.db.transaction(async (tx) => {
    const [created] = await tx.insert(files).values({
      id: fileId,
      ownerUserId: actor.id,
      storageProvider: app.storage.provider,
      bucket: app.storage.bucket,
      objectKey,
      originalName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      status: "UPLOADING"
    }).returning();
    return created!;
  });
  const upload = await app.storage.createUploadUrl(objectKey, file.mimeType, env.STORAGE_PRESIGN_EXPIRES_SECONDS);
  return { fileId: file.id, uploadUrl: upload.url, headers: upload.headers, expiresAt: upload.expiresAt };
}

/** 确认版本文件上传完成：校验对象大小/哈希/MIME，版本绑定文件并重置解析状态 */
export async function completeVersionUpload(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  fileId: string
) {
  const version = await requireVersion(app, versionId);
  if (version.status !== "DRAFT") throw new ConflictError("仅草稿版本允许更换文件");
  const file = await requireActiveFile(app, fileId);
  if (file.ownerUserId !== actor.id && actor.role !== "SUPER_ADMIN") {
    throw new ForbiddenError("只能操作本人上传的文件");
  }
  const object = await app.storage.statObject(file.objectKey);
  if (!object) throw new NotFoundError("对象存储中未找到上传文件");
  if (object.size !== file.sizeBytes) throw new ForbiddenError("上传文件大小与申请信息不一致");
  const data = await app.storage.getObject(file.objectKey);
  if (file.sha256) {
    const actualSha256 = createHash("sha256").update(data).digest("hex");
    if (actualSha256.toLowerCase() !== file.sha256.toLowerCase()) {
      throw new ForbiddenError("上传文件哈希与申请信息不一致，文件可能被篡改");
    }
    // 严格去重：按实际文件内容哈希校验，排除本次文件自身
    await assertNoDuplicateSha256(app.db, actualSha256, fileId);
  }
  const detected = await fileTypeFromBuffer(data);
  if (detected && detected.mime !== file.mimeType) {
    throw new ForbiddenError("上传文件实际类型与申请信息不一致");
  }
  await app.db.transaction(async (tx) => {
    await tx.update(files).set({ status: "QUEUED", errorMessage: null, updatedAt: new Date() })
      .where(eq(files.id, fileId));
    await tx.update(knowledgeDocumentVersions).set({
      fileId,
      parseStatus: "PENDING",
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(knowledgeDocumentVersions.id, versionId));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.FILE_UPLOAD_COMPLETED, targetType: "knowledge_document_version", targetId: versionId,
      afterJson: { fileId, fileName: file.originalName }
    });
  });
  return { message: "文件上传确认完成，可发起解析" };
}

/** 发起解析/重新解析：创建解析任务并投递 document-processing 队列 */
export async function enqueueParsing(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  jobType: "PARSE" | "REPARSE"
) {
  const version = await requireVersion(app, versionId);
  if (version.status === "PUBLISHED" || version.status === "DISABLED") {
    throw new ConflictError("已发布或已停用的版本不允许重新解析，请创建新版本");
  }
  if (!version.fileId) throw new ConflictError("该版本尚未绑定源文件，请先上传文件");
  const job = await app.db.transaction(async (tx) => {
    const [created] = await tx.insert(parsingJobs).values({
      documentId: version.documentId,
      versionId,
      jobType,
      status: "QUEUED",
      fileId: version.fileId,
      queuedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_VERSION_PARSED, targetType: "knowledge_document_version", targetId: versionId,
      afterJson: { jobType, parsingJobId: created!.id }
    });
    return created!;
  });
  try {
    await app.queues.documentProcessing.add("parse_document", {
      parsingJobId: job.id,
      fileId: version.fileId,
      versionId,
      jobType
    }, { jobId: job.id });
  } catch (error) {
    await app.db.update(parsingJobs).set({
      status: "FAILED", errorMessage: "解析任务投递失败，请稍后重试", updatedAt: new Date()
    }).where(eq(parsingJobs.id, job.id));
    throw new ServiceUnavailableError("解析任务投递失败，请稍后重试");
  }
  return { message: jobType === "REPARSE" ? "重新解析任务已提交" : "解析任务已提交", jobId: job.id };
}

/** 切片重建：不重新读取文件，基于现有页面原文重切分块 */
export async function enqueueChunkRebuild(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string
) {
  const version = await requireVersion(app, versionId);
  if (version.status === "PUBLISHED" || version.status === "DISABLED") {
    throw new ConflictError("已发布或已停用的版本不允许重建分块");
  }
  const [pageRow] = await app.db.select({ id: knowledgePages.id }).from(knowledgePages)
    .where(eq(knowledgePages.versionId, versionId)).limit(1);
  if (!pageRow) throw new ConflictError("该版本缺少页面数据，请先执行解析");
  const job = await app.db.transaction(async (tx) => {
    const [created] = await tx.insert(parsingJobs).values({
      documentId: version.documentId,
      versionId,
      jobType: "CHUNK_REBUILD",
      status: "QUEUED",
      fileId: version.fileId,
      queuedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_CHUNKS_REBUILT, targetType: "knowledge_document_version", targetId: versionId,
      afterJson: { parsingJobId: created!.id }
    });
    return created!;
  });
  try {
    await app.queues.documentProcessing.add("parse_document", {
      parsingJobId: job.id,
      fileId: version.fileId ?? "",
      versionId,
      jobType: "CHUNK_REBUILD"
    }, { jobId: job.id });
  } catch (error) {
    await app.db.update(parsingJobs).set({
      status: "FAILED", errorMessage: "分块重建任务投递失败，请稍后重试", updatedAt: new Date()
    }).where(eq(parsingJobs.id, job.id));
    throw new ServiceUnavailableError("分块重建任务投递失败，请稍后重试");
  }
  return { message: "分块重建任务已提交", jobId: job.id };
}

/** 审核通过：DRAFT/PENDING_REVIEW -> APPROVED，要求解析完成 */
export async function approveVersion(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  approvalNote?: string
) {
  const version = await requireVersion(app, versionId);
  if (version.status === "PUBLISHED") throw new ConflictError("已发布版本无需重复审核");
  if (version.status === "DISABLED") throw new ConflictError("已停用版本不能审核，请基于历史版本回滚");
  if (version.parseStatus !== "PARSED" && version.parseStatus !== "PARTIAL") {
    throw new ConflictError("版本尚未完成解析，不能审核");
  }
  const approved = await app.db.transaction(async (tx) => {
    const [updated] = await tx.update(knowledgeDocumentVersions).set({
      status: "APPROVED",
      approvedById: actor.id,
      approvedAt: new Date(),
      approvalNote,
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(knowledgeDocumentVersions.id, versionId)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_VERSION_APPROVED, targetType: "knowledge_document_version", targetId: versionId,
      beforeJson: { status: version.status },
      afterJson: { status: "APPROVED", approvalNote }
    });
    return updated!;
  });
  return { message: "版本已审核通过", version: approved };
}

/** 发布：APPROVED -> PUBLISHED，同文档其他已发布版本置 DISABLED，并更新文档当前受控版本 */
export async function publishVersion(app: FastifyInstance, request: FastifyRequest, actor: AuthUser, versionId: string) {
  const version = await requireVersion(app, versionId);
  if (version.status !== "APPROVED") throw new ConflictError("仅审核通过的版本可以发布");
  await app.db.transaction(async (tx) => {
    await tx.update(knowledgeDocumentVersions)
      .set({ status: "DISABLED", updatedAt: new Date() })
      .where(and(
        eq(knowledgeDocumentVersions.documentId, version.documentId),
        eq(knowledgeDocumentVersions.status, "PUBLISHED")
      ));
    await tx.update(knowledgeDocumentVersions).set({
      status: "PUBLISHED",
      pipelineStatus: "PUBLISHED",
      publishedById: actor.id,
      publishedAt: new Date(),
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(knowledgeDocumentVersions.id, versionId));
    await tx.update(knowledgeDocuments).set({
      currentVersionId: versionId,
      status: "ACTIVE",
      updatedById: actor.id,
      updatedAt: new Date()
    }).where(eq(knowledgeDocuments.id, version.documentId));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_VERSION_PUBLISHED, targetType: "knowledge_document_version", targetId: versionId,
      beforeJson: { status: version.status },
      afterJson: { status: "PUBLISHED", version: version.version }
    });
  });
  return { message: "版本已发布为当前受控版本" };
}

/** 停用：PUBLISHED -> DISABLED，文档受控版本置空 */
export async function disableVersion(app: FastifyInstance, request: FastifyRequest, actor: AuthUser, versionId: string) {
  const version = await requireVersion(app, versionId);
  if (version.status !== "PUBLISHED") throw new ConflictError("仅已发布版本可以停用");
  await app.db.transaction(async (tx) => {
    await tx.update(knowledgeDocumentVersions).set({
      status: "DISABLED", updatedById: actor.id, updatedAt: new Date()
    }).where(eq(knowledgeDocumentVersions.id, versionId));
    await tx.update(knowledgeDocuments).set({
      currentVersionId: null, updatedById: actor.id, updatedAt: new Date()
    }).where(eq(knowledgeDocuments.id, version.documentId));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_VERSION_DISABLED, targetType: "knowledge_document_version", targetId: versionId,
      beforeJson: { status: "PUBLISHED" },
      afterJson: { status: "DISABLED" }
    });
  });
  return { message: "版本已停用" };
}

/** 版本替代：从历史版本复制为新草稿，历史版本保留 */
export async function rollbackVersion(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  documentId: string,
  sourceVersionId: string
) {
  const document = await requireDocument(app, documentId);
  const [source] = await app.db.select().from(knowledgeDocumentVersions)
    .where(and(
      eq(knowledgeDocumentVersions.id, sourceVersionId),
      eq(knowledgeDocumentVersions.documentId, documentId)
    )).limit(1);
  if (!source) throw new NotFoundError("源版本不存在");
  if (source.status !== "PUBLISHED" && source.status !== "DISABLED") {
    throw new ConflictError("仅已发布或已停用的历史版本可以用于版本替代");
  }
  const draft = await app.db.transaction(async (tx) => {
    const versionNumber = await nextVersionNumber(tx, documentId);
    const [created] = await tx.insert(knowledgeDocumentVersions).values({
      documentId,
      version: versionNumber,
      fileId: source.fileId,
      title: source.title,
      status: "DRAFT",
      parseStatus: "PENDING",
      evidenceLevel: source.evidenceLevel ?? document.evidenceLevel,
      changeNote: `版本替代：回滚自版本 ${source.version}（${source.changeNote ?? "无备注"}）`,
      createdById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_VERSION_ROLLED_BACK, targetType: "knowledge_document_version", targetId: created!.id,
      afterJson: { sourceVersionId, sourceVersion: source.version, targetVersion: created!.version }
    });
    return created!;
  });
  return { message: `已基于版本 ${source.version} 生成新草稿（版本 ${draft.version}）`, version: draft };
}

// ---------------------------------------------------------------- 别名

export async function listAliases(
  app: FastifyInstance,
  query: { page: number; pageSize: number; term?: string; alias?: string }
) {
  const page = Math.max(1, query.page);
  const pageSize = Math.min(100, Math.max(1, query.pageSize));
  const where = and(
    query.term ? sql`${knowledgeAliases.term} ilike ${`%${query.term}%`}` : undefined,
    query.alias ? sql`${knowledgeAliases.alias} ilike ${`%${query.alias}%`}` : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(knowledgeAliases).where(where)
      .orderBy(desc(knowledgeAliases.updatedAt))
      .offset((page - 1) * pageSize).limit(pageSize),
    app.db.select({ value: count() }).from(knowledgeAliases).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page: query.page, pageSize: query.pageSize };
}

export async function createAlias(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  input: { term: string; alias: string; termType?: KnowledgeTermType; scope?: string }
) {
  const alias = await app.db.transaction(async (tx) => {
    const [created] = await tx.insert(knowledgeAliases).values({
      term: input.term,
      alias: input.alias,
      termType: input.termType ?? "KEYWORD",
      scope: input.scope ?? "GLOBAL",
      createdById: actor.id
    }).onConflictDoNothing().returning();
    if (!created) throw new ConflictError("该规范词与别名组合已存在");
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_ALIAS_CREATED, targetType: "knowledge_alias", targetId: created.id,
      afterJson: { term: created.term, alias: created.alias }
    });
    return created;
  });
  return alias;
}

export async function updateAlias(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  id: string,
  input: { term?: string; alias?: string; termType?: KnowledgeTermType; scope?: string; enabled?: boolean }
) {
  const [existing] = await app.db.select().from(knowledgeAliases).where(eq(knowledgeAliases.id, id)).limit(1);
  if (!existing) throw new NotFoundError("别名词条不存在");
  const alias = await app.db.transaction(async (tx) => {
    const [updated] = await tx.update(knowledgeAliases).set({
      term: input.term ?? existing.term,
      alias: input.alias ?? existing.alias,
      termType: input.termType ?? existing.termType,
      scope: input.scope ?? existing.scope,
      enabled: input.enabled ?? existing.enabled,
      updatedAt: new Date()
    }).where(eq(knowledgeAliases.id, id)).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_ALIAS_UPDATED, targetType: "knowledge_alias", targetId: id,
      beforeJson: existing, afterJson: updated
    });
    return updated!;
  });
  return alias;
}

export async function deleteAlias(app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string) {
  const [existing] = await app.db.select().from(knowledgeAliases).where(eq(knowledgeAliases.id, id)).limit(1);
  if (!existing) throw new NotFoundError("别名词条不存在");
  await app.db.transaction(async (tx) => {
    await tx.delete(knowledgeAliases).where(eq(knowledgeAliases.id, id));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_ALIAS_DELETED, targetType: "knowledge_alias", targetId: id,
      beforeJson: existing
    });
  });
  return { message: "别名词条已删除" };
}

// ---------------------------------------------------------------- 内容查看与任务

export async function listVersionPages(app: FastifyInstance, versionId: string, page: number, pageSize: number) {
  await requireVersion(app, versionId);
  const skip = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, pageSize));
  const take = Math.min(100, Math.max(1, pageSize));
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(knowledgePages).where(eq(knowledgePages.versionId, versionId))
      .orderBy(knowledgePages.pageNumber).offset(skip).limit(take),
    app.db.select({ value: count() }).from(knowledgePages).where(eq(knowledgePages.versionId, versionId))
  ]);
  return { items, total: totalRow?.value ?? 0, page, pageSize };
}

export async function listVersionChunks(
  app: FastifyInstance,
  versionId: string,
  page: number,
  pageSize: number,
  contentType?: string
) {
  await requireVersion(app, versionId);
  const skip = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, pageSize));
  const take = Math.min(100, Math.max(1, pageSize));
  const where = and(
    eq(knowledgeChunks.versionId, versionId),
    contentType ? eq(knowledgeChunks.contentType, contentType as KnowledgeChunkContentType) : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select({
      id: knowledgeChunks.id,
      chunkIndex: knowledgeChunks.chunkIndex,
      content: knowledgeChunks.content,
      contentType: knowledgeChunks.contentType,
      sourcePage: knowledgeChunks.sourcePage,
      pageEnd: knowledgeChunks.pageEnd,
      sourceSection: knowledgeChunks.sourceSection,
      headingLevel: knowledgeChunks.headingLevel,
      keywords: knowledgeChunks.keywords,
      aliasTerms: knowledgeChunks.aliasTerms,
      citationAnchor: knowledgeChunks.citationAnchor,
      sortWeight: knowledgeChunks.sortWeight
    }).from(knowledgeChunks).where(where)
      .orderBy(knowledgeChunks.chunkIndex).offset(skip).limit(take),
    app.db.select({ value: count() }).from(knowledgeChunks).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page, pageSize };
}

export async function listParsingJobs(
  app: FastifyInstance,
  query: { page: number; pageSize: number; documentId?: string; versionId?: string; status?: string }
) {
  const page = Math.max(1, query.page);
  const pageSize = Math.min(100, Math.max(1, query.pageSize));
  const where = and(
    query.documentId ? eq(parsingJobs.documentId, query.documentId) : undefined,
    query.versionId ? eq(parsingJobs.versionId, query.versionId) : undefined,
    query.status ? eq(parsingJobs.status, query.status as ParsingJobStatus) : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    app.db.select({
      id: parsingJobs.id,
      documentId: parsingJobs.documentId,
      versionId: parsingJobs.versionId,
      jobType: parsingJobs.jobType,
      status: parsingJobs.status,
      progress: parsingJobs.progress,
      errorMessage: parsingJobs.errorMessage,
      result: parsingJobs.result,
      attempts: parsingJobs.attempts,
      createdAt: parsingJobs.createdAt,
      startedAt: parsingJobs.startedAt,
      finishedAt: parsingJobs.finishedAt,
      document: {
        title: knowledgeDocuments.title
      }
    }).from(parsingJobs)
      .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, parsingJobs.documentId))
      .where(where)
      .orderBy(desc(parsingJobs.createdAt))
      .offset((page - 1) * pageSize).limit(pageSize),
    app.db.select({ value: count() }).from(parsingJobs).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page, pageSize };
}

/** 分块术语（审核/调试用） */
export async function listChunkTerms(app: FastifyInstance, chunkId: string) {
  const [chunk] = await app.db.select({ id: knowledgeChunks.id }).from(knowledgeChunks)
    .where(eq(knowledgeChunks.id, chunkId)).limit(1);
  if (!chunk) throw new NotFoundError("知识分块不存在");
  return app.db.select().from(knowledgeChunkTerms).where(eq(knowledgeChunkTerms.chunkId, chunkId));
}
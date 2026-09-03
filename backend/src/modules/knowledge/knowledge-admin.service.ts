import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { env } from "../../config/env.js";
import { ConflictError, ForbiddenError, NotFoundError, ServiceUnavailableError } from "../../shared/errors.js";
import {
  files,
  knowledgeAliases,
  knowledgeCategories,
  knowledgeChunkEdits,
  knowledgeChunkTerms,
  knowledgeChunks,
  knowledgeDocumentAssets,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  knowledgePages,
  parsingJobs
} from "../../db/schema.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { assertVersionPublishable, bindVersionAsset, type KnowledgeAssetRole } from "./knowledge-original.service.js";
import { assertNoDuplicateSha256 } from "./knowledge-ingest.service.js";
import { extractAnchors, extractKeywords } from "./knowledge-chunking.js";
import { normalizeSearchText } from "./knowledge.normalize.js";

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

export type KnowledgeDocumentHealthStatus = "NEEDS_ACTION" | "READY" | "BROWSE_ONLY" | "PUBLISHED" | "PENDING_REVIEW";
export type KnowledgeAiAvailabilityStatus = "AVAILABLE" | "BROWSE_ONLY" | "UNAVAILABLE";

export interface ListDocumentsQuery {
  page: number;
  pageSize: number;
  status?: string;
  docType?: string;
  categoryId?: string;
  keyword?: string;
  healthStatus?: KnowledgeDocumentHealthStatus;
}

interface DocumentHealthInput {
  version: {
    status: string;
    parseStatus: string;
    pipelineStatus: string;
    usageMode: string;
    fileId: string | null;
  } | null;
  assetRoles: string[];
  pageCount: number;
  chunkCount: number;
}

function deriveDocumentHealth(input: DocumentHealthInput) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const version = input.version;
  const hasOriginal = input.assetRoles.includes("ORIGINAL") || Boolean(version?.fileId);
  const hasSearchSource = input.assetRoles.includes("SEARCH_SOURCE") || (input.assetRoles.includes("ORIGINAL") && version?.parseStatus !== "NO_TEXT_LAYER");

  if (!version) {
    blockers.push("尚未创建版本");
  } else {
    if (!hasOriginal) blockers.push("尚未上传正式文件");
    if (["PENDING", "PARSING"].includes(version.parseStatus) || ["UPLOAD_PENDING", "UPLOADED", "PARSING", "CHUNKING"].includes(version.pipelineStatus)) {
      blockers.push("文件识别尚未完成");
    }
    if (version.parseStatus === "FAILED") blockers.push("文件识别失败");
    if (version.parseStatus === "NO_TEXT_LAYER" && !hasSearchSource) blockers.push("正式 PDF 没有文字层，需补充 AI 识别文件");
    if (version.parseStatus === "SEARCH_SOURCE_REQUIRED" && version.usageMode === "AI_ENABLED" && !hasSearchSource) blockers.push("AI 检索缺少识别文件");
    if (version.parseStatus === "NO_TEXT_LAYER") warnings.push("正式 PDF 没有文字层，AI 检索应使用独立识别文件");
    if (version.usageMode === "AI_ENABLED" && hasSearchSource && input.chunkCount === 0) warnings.push("尚未生成可检索内容");
    if (version.usageMode === "AI_ENABLED" && input.pageCount === 0) warnings.push("尚未生成页面内容");
    if (version.status === "DRAFT" && version.parseStatus === "PARSED") warnings.push("内容已识别，等待审核");
    if (version.status === "APPROVED") warnings.push("版本已审核，等待发布");
  }

  const aiAvailable = Boolean(
    version
    && version.usageMode === "AI_ENABLED"
    && hasSearchSource
    && ["PARSED", "PARTIAL"].includes(version.parseStatus)
    && input.pageCount > 0
    && input.chunkCount > 0,
  );
  const aiAvailabilityStatus: KnowledgeAiAvailabilityStatus = version?.usageMode === "BROWSE_ONLY"
    ? "BROWSE_ONLY"
    : aiAvailable ? "AVAILABLE" : "UNAVAILABLE";

  let healthStatus: KnowledgeDocumentHealthStatus;
  if (blockers.length > 0) healthStatus = "NEEDS_ACTION";
  else if (version?.status === "PUBLISHED") healthStatus = "PUBLISHED";
  else if (version?.usageMode === "BROWSE_ONLY") healthStatus = "BROWSE_ONLY";
  else if (version?.status === "DRAFT" && version.parseStatus === "PARSED" || version?.status === "APPROVED") healthStatus = "PENDING_REVIEW";
  else healthStatus = "READY";

  return {
    healthStatus,
    aiAvailabilityStatus,
    healthBlockers: blockers,
    healthWarnings: warnings,
  };
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
  const page = Math.max(1, query.page);
  const pageSize = Math.min(100, Math.max(1, query.pageSize));
  const where = and(
    isNull(knowledgeDocuments.deletedAt),
    query.status ? eq(knowledgeDocuments.status, query.status as "ACTIVE" | "DISABLED") : undefined,
    query.docType ? eq(knowledgeDocuments.docType, query.docType as KnowledgeDocType) : undefined,
    query.categoryId ? eq(knowledgeDocuments.categoryId, query.categoryId) : undefined,
    query.keyword ? sql`(${knowledgeDocuments.title} ilike ${`%${query.keyword}%`} or ${knowledgeDocuments.docNumber} ilike ${`%${query.keyword}%`} or ${knowledgeDocuments.sourceOrg} ilike ${`%${query.keyword}%`})` : undefined
  );
  // 健康状态依赖版本资产、页面和检索索引，先取基础候选集再派生并分页，确保筛选后的 total 正确。
  const baseItems = await app.db.select({
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
      pipelineStatus: knowledgeDocumentVersions.pipelineStatus,
      usageMode: knowledgeDocumentVersions.usageMode,
      fileId: knowledgeDocumentVersions.fileId,
      pageCount: knowledgeDocumentVersions.pageCount,
      parser: knowledgeDocumentVersions.parser
    },
    createdAt: knowledgeDocuments.createdAt,
    updatedAt: knowledgeDocuments.updatedAt
  })
    .from(knowledgeDocuments)
    .leftJoin(knowledgeDocumentVersions, eq(knowledgeDocumentVersions.id, knowledgeDocuments.currentVersionId))
    .where(where)
    .orderBy(desc(knowledgeDocuments.updatedAt));

  const versionIds = baseItems.map(item => item.currentVersionId).filter((id): id is string => id !== null);
  const [assetRows, pageRows, chunkRows] = await Promise.all([
    versionIds.length > 0
      ? app.db.select({ versionId: knowledgeDocumentAssets.versionId, role: knowledgeDocumentAssets.role })
        .from(knowledgeDocumentAssets).where(inArray(knowledgeDocumentAssets.versionId, versionIds))
      : Promise.resolve([] as Array<{ versionId: string; role: string }>),
    versionIds.length > 0
      ? app.db.select({ versionId: knowledgePages.versionId })
        .from(knowledgePages).where(inArray(knowledgePages.versionId, versionIds))
      : Promise.resolve([] as Array<{ versionId: string }>),
    versionIds.length > 0
      ? app.db.select({ versionId: knowledgeChunks.versionId })
        .from(knowledgeChunks).where(inArray(knowledgeChunks.versionId, versionIds))
      : Promise.resolve([] as Array<{ versionId: string }>)
  ]);
  const assetMap = new Map<string, string[]>();
  for (const row of assetRows) assetMap.set(row.versionId, [...(assetMap.get(row.versionId) ?? []), row.role]);
  const pageCountMap = new Map<string, number>();
  for (const row of pageRows) pageCountMap.set(row.versionId, (pageCountMap.get(row.versionId) ?? 0) + 1);
  const chunkCountMap = new Map<string, number>();
  for (const row of chunkRows) chunkCountMap.set(row.versionId, (chunkCountMap.get(row.versionId) ?? 0) + 1);

  const projected = baseItems.map((item) => {
    const version = item.currentVersion;
    const health = deriveDocumentHealth({
      version: version ? {
        status: version.status,
        parseStatus: version.parseStatus,
        pipelineStatus: version.pipelineStatus,
        usageMode: version.usageMode,
        fileId: version.fileId
      } : null,
      assetRoles: version ? assetMap.get(item.currentVersionId!) ?? [] : [],
      pageCount: version ? pageCountMap.get(item.currentVersionId!) ?? version.pageCount ?? 0 : 0,
      chunkCount: version ? chunkCountMap.get(item.currentVersionId!) ?? 0 : 0
    });
    return { ...item, ...health };
  });
  const filtered = query.healthStatus
    ? projected.filter(item => item.healthStatus === query.healthStatus)
    : projected;
  const skip = (page - 1) * pageSize;
  return { items: filtered.slice(skip, skip + pageSize), total: filtered.length, page, pageSize };
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
  input: { fileName: string; mimeType: string; sizeBytes: number; sha256?: string },
  assetRole?: KnowledgeAssetRole
) {
  const version = await requireVersion(app, versionId);
  // ORIGINAL（缺省）仍限草稿换文件；SEARCH_SOURCE/OCR_SOURCE 允许绑定到任意未停用版本（转曲件升级路径）
  if (assetRole === undefined || assetRole === "ORIGINAL") {
    if (version.status !== "DRAFT") throw new ConflictError("仅草稿版本允许上传文件");
  } else if (version.status === "DISABLED") {
    throw new ConflictError("已停用版本不允许绑定文件资产");
  }
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

/** 确认版本文件上传完成：校验对象大小/哈希/MIME；
 * 缺省（ORIGINAL）：版本绑定主文件并重置解析状态，同时维护 ORIGINAL 资产行；
 * assetRole=SEARCH_SOURCE/OCR_SOURCE：仅登记文件资产，不动版本主文件（转曲件升级路径）。 */
export async function completeVersionUpload(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  fileId: string,
  assetRole?: KnowledgeAssetRole
) {
  const version = await requireVersion(app, versionId);
  if (assetRole === undefined || assetRole === "ORIGINAL") {
    if (version.status !== "DRAFT") throw new ConflictError("仅草稿版本允许更换文件");
  } else if (version.status === "DISABLED") {
    throw new ConflictError("已停用版本不允许绑定文件资产");
  }
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
  if (assetRole === "SEARCH_SOURCE" || assetRole === "OCR_SOURCE" || assetRole === "PREVIEW") {
    // 附属资产：只登记资产行，不改版本主文件与解析状态
    await app.db.update(files).set({ status: "READY", errorMessage: null, updatedAt: new Date() })
      .where(eq(files.id, fileId));
    await bindVersionAsset(app, request, actor, versionId, { role: assetRole, fileId });
    return { message: `${assetRole} 资产绑定完成；如为检索文本源，请触发“升级解析”重建内容与页面映射` };
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
  // 维护 ORIGINAL 资产行（原文导航模型：版本主文件 = ORIGINAL）
  await bindVersionAsset(app, request, actor, versionId, { role: "ORIGINAL", fileId });
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
/** 切片重建：不重新读取文件，基于现有页面原文重切分块（含 Wiki 章节/内容块重建；已发布版本允许，用于历史资料 Wiki 升级且不降级管线状态） */
export async function enqueueChunkRebuild(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string
) {
  const version = await requireVersion(app, versionId);
  if (version.status === "DISABLED") {
    throw new ConflictError("已停用的版本不允许重建分块");
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
  const parseable = version.parseStatus === "PARSED"
    || version.parseStatus === "PARTIAL"
    || version.parseStatus === "NO_TEXT_LAYER"
    || (version.usageMode === "BROWSE_ONLY" && version.parseStatus === "SEARCH_SOURCE_REQUIRED");
  if (!parseable) {
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
  // 发布门禁（P1）：AI_ENABLED 必须存在可搜索文本源（硬拦截）；TOC/页面映射未核验为软提示
  const readiness = await assertVersionPublishable(app, version);
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
      afterJson: { status: "PUBLISHED", version: version.version, warnings: readiness.warnings }
    });
  });
  return {
    message: readiness.warnings.length > 0
      ? `版本已发布为当前受控版本（提示：${readiness.warnings.join("；")}）`
      : "版本已发布为当前受控版本",
    warnings: readiness.warnings
  };
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

/** 删除草稿版本：仅 DRAFT 允许；级联清理页面/分块/术语/引用/解析任务与源文件对象 */
export async function deleteDocumentVersion(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string
) {
  const version = await requireVersion(app, versionId);
  if (version.status !== "DRAFT") {
    throw new ConflictError("仅草稿版本可以删除；已审核或已发布的版本请使用停用");
  }
  await app.db.transaction(async (tx) => {
    await tx.delete(knowledgeDocumentVersions).where(eq(knowledgeDocumentVersions.id, versionId));
    if (version.fileId) {
      await tx.delete(files).where(eq(files.id, version.fileId));
    }
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_VERSION_DELETED, targetType: "knowledge_document_version", targetId: versionId,
      beforeJson: { version: version.version, title: version.title, status: version.status }
    });
  });
  // 删除 OSS/MinIO 对象（对象删除失败不阻断版本删除，任务文件会由后台清理）
  try {
    const [file] = version.fileId
      ? await app.db.select({ objectKey: files.objectKey }).from(files).where(eq(files.id, version.fileId)).limit(1)
      : [undefined];
    if (file) {
      await app.storage.removeObject(file.objectKey);
    }
  } catch {
    app.log.warn({ versionId }, "版本源文件对象删除失败，将由后台任务清理");
  }
  return { message: `草稿版本 v${version.version} 已删除` };
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
    app.db.select({
      id: knowledgePages.id,
      pageNumber: knowledgePages.pageNumber,
      physicalPageNumber: knowledgePages.physicalPageNumber,
      pageLabel: knowledgePages.pageLabel,
      pageLabelSource: knowledgePages.pageLabelSource,
      pageLabelConfidence: knowledgePages.pageLabelConfidence,
      pageLabelVerified: knowledgePages.pageLabelVerified,
      pageTitle: knowledgePages.pageTitle,
      hasTables: knowledgePages.hasTables,
      hasImages: knowledgePages.hasImages,
      sectionPath: knowledgePages.sectionPath,
      parseStatus: knowledgePages.parseStatus
    }).from(knowledgePages).where(eq(knowledgePages.versionId, versionId))
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
      sortWeight: knowledgeChunks.sortWeight,
      searchText: knowledgeChunks.searchText,
      metadata: knowledgeChunks.metadata,
      annotation: knowledgeChunks.annotation,
      invalid: knowledgeChunks.invalid,
      invalidReason: knowledgeChunks.invalidReason,
      editedAt: knowledgeChunks.editedAt
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

// ---------------------------------------------------------------- 分块人工干预

export type KnowledgeChunkEditType = "META_EDIT" | "FLAG_INVALID" | "SPLIT" | "MERGE";

/**
 * 分块人工编辑门控：分块所属版本必须是未发布/未停用的草稿流程（与重解析一致），
 * 保证已发布版本的分块数据不可变；编辑动作全部写入 knowledge_chunk_edits 审计。
 */
async function requireEditableChunk(app: FastifyInstance, chunkId: string) {
  const [row] = await app.db.select({
    id: knowledgeChunks.id,
    versionId: knowledgeChunks.versionId,
    versionStatus: knowledgeDocumentVersions.status,
    version: knowledgeDocumentVersions.version
  }).from(knowledgeChunks)
    .innerJoin(knowledgeDocumentVersions, eq(knowledgeDocumentVersions.id, knowledgeChunks.versionId))
    .where(eq(knowledgeChunks.id, chunkId)).limit(1);
  if (!row) throw new NotFoundError("知识分块不存在");
  if (row.versionStatus === "PUBLISHED" || row.versionStatus === "DISABLED") {
    throw new ConflictError(`版本 ${row.version} 已发布或已停用，不允许人工调整分块；请基于历史版本回滚生成新草稿`);
  }
  return row;
}

/** 按别名词典重算分块关键词/别名/锚点/检索文本，并重建分块术语（与解析 worker 标注规则一致） */
async function relabelChunk(
  db: DbExecutor,
  chunkId: string,
  content: string,
  sourceSection: string | null,
  headingLevel: number,
  citationAnchor: string | null,
  keywordsOverride?: string[]
) {
  const rows = await db.select({ term: knowledgeAliases.term, alias: knowledgeAliases.alias })
    .from(knowledgeAliases).where(eq(knowledgeAliases.enabled, true));
  const aliases = rows.map((row) => ({ term: row.term, alias: row.alias }));
  const extraction = extractKeywords(content, aliases);
  const keywords = keywordsOverride ?? extraction.keywords;
  const anchors = extractAnchors(content);
  await db.update(knowledgeChunks).set({
    sourceSection,
    headingLevel,
    searchText: normalizeSearchText(content),
    keywords,
    aliasTerms: extraction.aliasTerms,
    citationAnchor: citationAnchor ?? anchors[0] ?? null,
    editedAt: new Date()
  }).where(eq(knowledgeChunks.id, chunkId));
  await db.delete(knowledgeChunkTerms).where(eq(knowledgeChunkTerms.chunkId, chunkId));
  const termValues = [
    ...keywords.map((term) => ({ chunkId, term, termType: "KEYWORD" as const, weight: 0 })),
    ...extraction.aliasTerms.map((term) => ({ chunkId, term, termType: "SYNONYM" as const, weight: 0 }))
  ];
  if (termValues.length > 0) await db.insert(knowledgeChunkTerms).values(termValues);
}

/** 重排版本内所有分块的 chunkIndex（0..n-1，按当前顺序补齐，保证唯一索引连续） */
async function renumberChunks(db: DbExecutor, versionId: string) {
  const rows = await db.select({ id: knowledgeChunks.id, chunkIndex: knowledgeChunks.chunkIndex })
    .from(knowledgeChunks).where(eq(knowledgeChunks.versionId, versionId))
    .orderBy(knowledgeChunks.chunkIndex);
  for (let index = 0; index < rows.length; index++) {
    if (rows[index]!.chunkIndex !== index) {
      await db.update(knowledgeChunks).set({ chunkIndex: index }).where(eq(knowledgeChunks.id, rows[index]!.id));
    }
  }
}

async function writeChunkEditAudit(
  db: DbExecutor,
  chunkId: string,
  editType: KnowledgeChunkEditType,
  actor: AuthUser,
  beforeJson: Record<string, unknown> | null,
  afterJson: Record<string, unknown> | null,
  note?: string | null
) {
  await db.insert(knowledgeChunkEdits).values({
    chunkId,
    editType,
    note: note ?? null,
    beforeJson,
    afterJson,
    createdById: actor.id
  });
}

/** PATCH /chunks/:chunkId：人工调整分块元数据（标题路径/关键词/锚点/标注/标记错误切片） */
export async function updateChunkMetadata(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  chunkId: string,
  input: {
    keywords?: string[];
    heading?: string | null;
    headingLevel?: number;
    citationAnchor?: string | null;
    annotation?: string | null;
    invalid?: boolean;
    invalidReason?: string | null;
  }
) {
  await requireEditableChunk(app, chunkId);
  const [current] = await app.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.id, chunkId)).limit(1);
  if (!current) throw new NotFoundError("知识分块不存在");

  const nextInvalid = input.invalid ?? current.invalid;
  const nextInvalidReason = input.invalidReason === undefined ? current.invalidReason : input.invalidReason;
  if (nextInvalid && !nextInvalidReason) {
    throw new ForbiddenError("标记错误切片时必须填写原因");
  }

  return app.db.transaction(async (tx) => {
    await relabelChunk(
      tx,
      chunkId,
      current.content,
      input.heading === undefined ? current.sourceSection : input.heading,
      input.headingLevel ?? current.headingLevel,
      input.citationAnchor === undefined ? current.citationAnchor : input.citationAnchor,
      input.keywords
    );
    const [updated] = await tx.update(knowledgeChunks).set({
      annotation: input.annotation === undefined ? current.annotation : input.annotation,
      invalid: nextInvalid,
      invalidReason: nextInvalidReason,
      editedById: actor.id,
      editedAt: new Date()
    }).where(eq(knowledgeChunks.id, chunkId)).returning();
    const editType: KnowledgeChunkEditType =
      nextInvalid === true && current.invalid === false ? "FLAG_INVALID" : "META_EDIT";
    await writeChunkEditAudit(
      tx, chunkId, editType, actor,
      {
        sourceSection: current.sourceSection,
        headingLevel: current.headingLevel,
        keywords: current.keywords,
        aliasTerms: current.aliasTerms,
        citationAnchor: current.citationAnchor,
        annotation: current.annotation,
        invalid: current.invalid,
        invalidReason: current.invalidReason
      },
      {
        sourceSection: updated!.sourceSection,
        headingLevel: updated!.headingLevel,
        keywords: updated!.keywords,
        aliasTerms: updated!.aliasTerms,
        citationAnchor: updated!.citationAnchor,
        annotation: updated!.annotation,
        invalid: updated!.invalid,
        invalidReason: updated!.invalidReason
      },
      input.annotation === undefined ? (nextInvalid ? nextInvalidReason : null) : input.annotation
    );
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_CHUNK_EDITED, targetType: "knowledge_chunk", targetId: chunkId,
      beforeJson: { versionId: current.versionId, chunkIndex: current.chunkIndex, invalid: current.invalid },
      afterJson: { versionId: current.versionId, chunkIndex: updated!.chunkIndex, invalid: updated!.invalid }
    });
    return updated!;
  });
}

/** POST /chunks/:chunkId/split：按 content 字符位置拆分（TABLE 结构化分块禁止拆分） */
export async function splitChunk(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  chunkId: string,
  at: number,
  heading?: string
) {
  await requireEditableChunk(app, chunkId);
  const [current] = await app.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.id, chunkId)).limit(1);
  if (!current) throw new NotFoundError("知识分块不存在");
  if (current.contentType === "TABLE") {
    throw new ConflictError("表格分块为结构化内容，禁止按字符位置拆分；表格拆分规则需另行配置");
  }
  const first = current.content.slice(0, at).trim();
  const second = current.content.slice(at).trim();
  if (!first || !second) throw new ForbiddenError("拆分位置会生成空分块，请调整拆分位置");

  const result = await app.db.transaction(async (tx) => {
    await tx.update(knowledgeChunks).set({
      content: first,
      editedById: actor.id,
      editedAt: new Date()
    }).where(eq(knowledgeChunks.id, chunkId));
    const [secondRow] = await tx.insert(knowledgeChunks).values({
      documentId: current.documentId,
      versionId: current.versionId,
      projectId: current.projectId,
      chunkIndex: current.chunkIndex + 1,
      content: second,
      sourcePage: current.sourcePage,
      pageEnd: current.pageEnd,
      sourceSection: heading ?? current.sourceSection,
      headingLevel: current.headingLevel,
      contentType: current.contentType,
      searchText: normalizeSearchText(second),
      keywords: [],
      aliasTerms: [],
      citationAnchor: null,
      metadata: current.metadata,
      sortWeight: 0,
      editedById: actor.id,
      editedAt: new Date()
    }).returning();
    await relabelChunk(tx, chunkId, first, current.sourceSection, current.headingLevel, current.citationAnchor);
    await relabelChunk(tx, secondRow!.id, second, heading ?? current.sourceSection, current.headingLevel, null);
    await renumberChunks(tx, current.versionId);
    await writeChunkEditAudit(
      tx, chunkId, "SPLIT", actor,
      { chunkIndex: current.chunkIndex, contentLength: current.content.length, content: current.content.slice(0, 80) },
      {
        at,
        first: { chunkId, chunkIndex: current.chunkIndex, content: first.slice(0, 80) },
        second: { chunkId: secondRow!.id, content: second.slice(0, 80) }
      },
      heading ? `拆分位置 ${at}，第二块标题：${heading}` : `按字符位置 ${at} 拆分`
    );
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_CHUNK_SPLIT, targetType: "knowledge_chunk", targetId: chunkId,
      beforeJson: { versionId: current.versionId, chunkIndex: current.chunkIndex },
      afterJson: { versionId: current.versionId, firstChunkId: chunkId, secondChunkId: secondRow!.id }
    });
    return tx.select().from(knowledgeChunks)
      .where(inArray(knowledgeChunks.id, [chunkId, secondRow!.id])).orderBy(knowledgeChunks.chunkIndex);
  });
  return { chunks: result };
}

/** POST /chunks/:chunkId/merge：把当前分块并入目标分块（TABLE 结构化分块禁止合并） */
export async function mergeChunks(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  chunkId: string,
  intoChunkId: string
) {
  if (intoChunkId === chunkId) throw new ForbiddenError("不能将分块合并到自身");
  const source = await requireEditableChunk(app, chunkId);
  const target = await requireEditableChunk(app, intoChunkId);
  if (source.versionId !== target.versionId) throw new ConflictError("只能合并同一版本内的分块");

  const [sourceRow, targetRow] = await Promise.all([
    app.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.id, chunkId)).limit(1),
    app.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.id, intoChunkId)).limit(1)
  ]);
  if (!sourceRow[0] || !targetRow[0]) throw new NotFoundError("知识分块不存在");
  if (sourceRow[0].contentType === "TABLE" || targetRow[0].contentType === "TABLE") {
    throw new ConflictError("表格分块为结构化内容，禁止合并");
  }
  const sourceChunk = sourceRow[0];
  const targetChunk = targetRow[0];
  const ordered = [sourceChunk, targetChunk].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const mergedContent = ordered.map((row) => row.content).join("\n").trim();

  return app.db.transaction(async (tx) => {
    await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.id, chunkId));
    await tx.delete(knowledgeChunkTerms).where(eq(knowledgeChunkTerms.chunkId, chunkId));
    await tx.update(knowledgeChunks).set({
      content: mergedContent,
      editedById: actor.id,
      editedAt: new Date()
    }).where(eq(knowledgeChunks.id, intoChunkId));
    await relabelChunk(
      tx, intoChunkId, mergedContent, targetChunk.sourceSection, targetChunk.headingLevel, targetChunk.citationAnchor
    );
    await renumberChunks(tx, source.versionId);
    await writeChunkEditAudit(
      tx, chunkId, "MERGE", actor,
      { merged: [sourceChunk.id, targetChunk.id].sort() },
      { intoChunkId, content: mergedContent.slice(0, 80) },
      `分块并入 ${intoChunkId}`
    );
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_CHUNK_MERGED, targetType: "knowledge_chunk", targetId: intoChunkId,
      beforeJson: { versionId: source.versionId, sourceChunkId: chunkId, targetChunkId: intoChunkId },
      afterJson: { versionId: source.versionId, targetChunkId: intoChunkId, mergedContentLength: mergedContent.length }
    });
    const [updated] = await tx.select().from(knowledgeChunks).where(eq(knowledgeChunks.id, intoChunkId)).limit(1);
    return updated!;
  });
}
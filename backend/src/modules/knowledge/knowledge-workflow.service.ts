/**
 * 知识库 B 端用户工作流编排层：一次创建并自动解析、详情摘要、更换文件、章节树、草稿 AI 测试。
 * 不复制底层 CRUD；文件只收 fileId；生产检索仍只走 PUBLISHED。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { AI_SCENES, AUDIT_ACTIONS, CLIENT_APPS } from "../../shared/constants.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import { KnowledgeError } from "../../shared/knowledge-errors.js";
import { KNOWLEDGE_PERMISSIONS } from "../../shared/knowledge-permissions.js";
import {
  aiConversations,
  files,
  knowledgeChunks,
  knowledgeDocumentAssets,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  knowledgePages,
  knowledgeSections,
  knowledgeTocItems,
  parsingJobs
} from "../../db/schema.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { streamConversationReply } from "../ai/ai-generation.service.js";
import { toAiSources, toUserTestSources } from "../ai/ai-source.mapper.js";
import {
  collectKnowledgeVersionReadiness,
  deriveKnowledgeVersionReadiness,
  summarizePageReadiness
} from "./knowledge-readiness.js";
import { searchWikiHierarchy } from "./knowledge.service.js";
import { getPageImageDownloadName } from "./knowledge-page-image.js";
import {
  addParsingJobToQueue,
  bindCenterFileToVersion,
  insertDocumentWithDraftVersion,
  nextVersionNumber,
  requireActiveFile,
  type KnowledgeDocType,
  type KnowledgeEvidenceLevel
} from "./knowledge-admin.service.js";
import {
  canAskAiFromStatus,
  canRetryParse,
  deriveParsingStage,
  mapKnowledgeUserStatus,
  toParseFailurePresentation
} from "./knowledge-user-status.js";

export const KNOWLEDGE_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
] as const;

export interface ChapterTreeNode {
  id: string;
  title: string;
  level: number;
  pageLabel: string | null;
  physicalPageNumber: number | null;
  children?: ChapterTreeNode[];
}

function hasDebugPermission(actor: AuthUser): boolean {
  return actor.role === "SUPER_ADMIN" || (actor.permissionCodes ?? []).includes(KNOWLEDGE_PERMISSIONS.DEBUG);
}

export function assertKnowledgeFileUsable(file: { id: string; status: string; mimeType: string }) {
  if (file.status === "RECYCLED") throw new ConflictError("所选文件已在回收站，不能绑定");
  if (file.status !== "READY") throw new ConflictError("所选文件尚未就绪，请先完成上传确认");
  if (!(KNOWLEDGE_ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimeType)) {
    throw new ConflictError("该文件类型不能用于知识库，请选择 PDF 或 DOCX");
  }
}

async function requireUsableFile(app: FastifyInstance, fileId: string) {
  const file = await requireActiveFile(app, fileId);
  assertKnowledgeFileUsable(file);
  return file;
}

async function requireLiveDocument(app: FastifyInstance, id: string) {
  const [document] = await app.db.select().from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.id, id), isNull(knowledgeDocuments.deletedAt))).limit(1);
  if (!document) throw new NotFoundError("知识文档不存在");
  return document;
}

async function findWorkingVersion(app: FastifyInstance, documentId: string) {
  const [version] = await app.db.select().from(knowledgeDocumentVersions)
    .where(and(
      eq(knowledgeDocumentVersions.documentId, documentId),
      ne(knowledgeDocumentVersions.status, "DISABLED")
    ))
    .orderBy(desc(knowledgeDocumentVersions.version))
    .limit(1);
  return version ?? null;
}

function hasSearchSourceRole(roles: string[], parseStatus?: string | null): boolean {
  if (roles.includes("SEARCH_SOURCE")) return true;
  return roles.includes("ORIGINAL")
    && parseStatus !== "NO_TEXT_LAYER"
    && parseStatus !== "SEARCH_SOURCE_REQUIRED"
    && parseStatus !== "OCR_REQUIRED";
}

/**
 * 一次创建知识文档与 v1 版本。
 * - 不传 `originalFileId`：只创建文档 + 空 DRAFT 版本，不建解析任务、不投递队列
 *   （原始资料附件与完整页面图片后续在知识库详情中独立上传）。
 * - 传 `originalFileId`：绑定 ORIGINAL 原始资料附件并自动发起解析（历史行为，保持兼容）。
 */
export async function createKnowledgeWithFile(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  input: {
    title: string;
    docType: KnowledgeDocType;
    /** 原始资料附件（可选）；为空 = 先建知识库，后补资料 */
    originalFileId?: string | null;
    searchSourceFileId?: string | null;
    categoryId?: string | null;
    docNumber?: string | null;
    sourceOrg?: string | null;
    issueDate?: string | null;
    effectiveDate?: string | null;
    evidenceLevel?: KnowledgeEvidenceLevel | null;
    allowedPurposes?: string[];
  }
) {
  if (!input.originalFileId) {
    const created = await app.db.transaction(async (tx) => {
      const row = await insertDocumentWithDraftVersion(tx, {
        title: input.title,
        docType: input.docType,
        docNumber: input.docNumber,
        sourceOrg: input.sourceOrg,
        issueDate: input.issueDate,
        effectiveDate: input.effectiveDate,
        evidenceLevel: input.evidenceLevel,
        allowedPurposes: input.allowedPurposes,
        categoryId: input.categoryId,
        pipelineStatus: "UPLOAD_PENDING",
        actorId: actor.id
      });
      await writeAuditLog({
        db: tx, request, actor,
        action: AUDIT_ACTIONS.KNOWLEDGE_DOC_CREATED, targetType: "knowledge_document", targetId: row.document.id,
        afterJson: { title: row.document.title, docType: row.document.docType, versionId: row.version.id, withFile: false }
      });
      await writeAuditLog({
        db: tx, request, actor,
        action: AUDIT_ACTIONS.KNOWLEDGE_VERSION_CREATED, targetType: "knowledge_document_version", targetId: row.version.id,
        afterJson: { documentId: row.document.id, version: row.version.version, triggeredBy: "CREATE_WITHOUT_FILE" }
      });
      return row;
    });
    // 允许只绑定检索源（转曲件场景）：不产生解析任务，需显式发起解析
    if (input.searchSourceFileId) {
      await requireUsableFile(app, input.searchSourceFileId);
      await bindCenterFileToVersion(app, request, actor, created.version.id, input.searchSourceFileId, "SEARCH_SOURCE");
    }
    return {
      document: {
        id: created.document.id,
        title: created.document.title,
        docType: created.document.docType
      },
      version: {
        id: created.version.id,
        versionNo: created.version.version
      },
      documentId: created.document.id,
      versionId: created.version.id,
      versionStatus: created.version.status,
      currentVersionId: created.document.currentVersionId,
      file: null,
      parsing: null
    };
  }

  const original = await requireUsableFile(app, input.originalFileId);
  const searchSource = input.searchSourceFileId
    ? await requireUsableFile(app, input.searchSourceFileId)
    : null;

  // 同一 fileId 只允许一份正式知识文档（禁止 legacy 文档与 create-with-file 并存）
  const existingBindings = await app.db.select({
    documentId: knowledgeDocumentAssets.documentId,
    deletedAt: knowledgeDocuments.deletedAt
  }).from(knowledgeDocumentAssets)
    .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgeDocumentAssets.documentId))
    .where(and(
      eq(knowledgeDocumentAssets.fileId, original.id),
      eq(knowledgeDocumentAssets.role, "ORIGINAL"),
      isNull(knowledgeDocuments.deletedAt)
    ))
    .limit(1);
  if (existingBindings.length > 0) {
    throw new ConflictError("该文件已绑定知识文档，请勿重复创建；如需重解析请打开已有资料");
  }
  // 兼容历史：文档表 fileId 直连（legacy parse 产物）
  const [legacyDoc] = await app.db.select({ id: knowledgeDocuments.id }).from(knowledgeDocuments)
    .where(and(
      eq(knowledgeDocuments.fileId, original.id),
      isNull(knowledgeDocuments.deletedAt)
    ))
    .limit(1);
  if (legacyDoc) {
    throw new ConflictError("该文件已由自动解析创建过知识文档，请打开已有资料或改用重新解析");
  }

  // 知识源文件标记：后续即使走 /files/:id/complete 也不会再 enqueue legacy
  if (original.purpose !== "KNOWLEDGE_SOURCE") {
    await app.db.update(files).set({ purpose: "KNOWLEDGE_SOURCE", updatedAt: new Date() })
      .where(eq(files.id, original.id));
  }

  const created = await app.db.transaction(async (tx) => {
    const row = await insertDocumentWithDraftVersion(tx, {
      title: input.title,
      docType: input.docType,
      docNumber: input.docNumber,
      sourceOrg: input.sourceOrg,
      issueDate: input.issueDate,
      effectiveDate: input.effectiveDate,
      evidenceLevel: input.evidenceLevel,
      allowedPurposes: input.allowedPurposes,
      categoryId: input.categoryId,
      fileId: original.id,
      pipelineStatus: "UPLOADED",
      actorId: actor.id
    });
    await tx.insert(knowledgeDocumentAssets).values({
      documentId: row.document.id,
      versionId: row.version.id,
      fileId: original.id,
      role: "ORIGINAL",
      isPrimary: true,
      createdById: actor.id
    });
    if (searchSource) {
      await tx.insert(knowledgeDocumentAssets).values({
        documentId: row.document.id,
        versionId: row.version.id,
        fileId: searchSource.id,
        role: "SEARCH_SOURCE",
        isPrimary: true,
        createdById: actor.id
      });
    }
    const [job] = await tx.insert(parsingJobs).values({
      documentId: row.document.id,
      versionId: row.version.id,
      jobType: "PARSE",
      status: "QUEUED",
      fileId: original.id,
      queuedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_DOC_CREATED, targetType: "knowledge_document", targetId: row.document.id,
      afterJson: { title: row.document.title, docType: row.document.docType, versionId: row.version.id, parsingJobId: job!.id }
    });
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_VERSION_CREATED, targetType: "knowledge_document_version", targetId: row.version.id,
      afterJson: { documentId: row.document.id, version: row.version.version, originalFileId: original.id }
    });
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_VERSION_PARSED, targetType: "knowledge_document_version", targetId: row.version.id,
      afterJson: { jobType: "PARSE", parsingJobId: job!.id, triggeredBy: "CREATE_WITH_FILE" }
    });
    return { ...row, job: job! };
  });

  await addParsingJobToQueue(app, {
    id: created.job.id,
    fileId: original.id,
    versionId: created.version.id,
    jobType: "PARSE"
  });

  return {
    document: {
      id: created.document.id,
      title: created.document.title,
      docType: created.document.docType
    },
    version: {
      id: created.version.id,
      versionNo: created.version.version
    },
    documentId: created.document.id,
    versionId: created.version.id,
    versionStatus: created.version.status,
    currentVersionId: created.document.currentVersionId,
    file: {
      id: original.id,
      name: original.originalName
    },
    parsing: {
      jobId: created.job.id,
      status: "QUEUED" as const
    }
  };
}

export async function replaceDocumentFile(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  documentId: string,
  input: { originalFileId: string; searchSourceFileId?: string | null; changeNote?: string }
) {
  const document = await requireLiveDocument(app, documentId);
  const original = await requireUsableFile(app, input.originalFileId);
  if (input.searchSourceFileId) await requireUsableFile(app, input.searchSourceFileId);

  const created = await app.db.transaction(async (tx) => {
    const versionNumber = await nextVersionNumber(tx, document.id);
    const [version] = await tx.insert(knowledgeDocumentVersions).values({
      documentId: document.id,
      version: versionNumber,
      title: document.title,
      status: "DRAFT",
      parseStatus: "PENDING",
      pipelineStatus: "UPLOADED",
      fileId: original.id,
      evidenceLevel: document.evidenceLevel,
      changeNote: input.changeNote ?? "更换文件",
      createdById: actor.id
    }).returning();
    await tx.insert(knowledgeDocumentAssets).values({
      documentId: document.id,
      versionId: version!.id,
      fileId: original.id,
      role: "ORIGINAL",
      isPrimary: true,
      createdById: actor.id
    });
    if (input.searchSourceFileId) {
      await tx.insert(knowledgeDocumentAssets).values({
        documentId: document.id,
        versionId: version!.id,
        fileId: input.searchSourceFileId,
        role: "SEARCH_SOURCE",
        isPrimary: true,
        createdById: actor.id
      });
    }
    const [job] = await tx.insert(parsingJobs).values({
      documentId: document.id,
      versionId: version!.id,
      jobType: "PARSE",
      status: "QUEUED",
      fileId: original.id,
      queuedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_VERSION_CREATED, targetType: "knowledge_document_version", targetId: version!.id,
      afterJson: { documentId: document.id, version: version!.version, originalFileId: original.id, triggeredBy: "REPLACE_FILE" }
    });
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_VERSION_PARSED, targetType: "knowledge_document_version", targetId: version!.id,
      afterJson: { jobType: "PARSE", parsingJobId: job!.id, triggeredBy: "REPLACE_FILE" }
    });
    return { version: version!, job: job! };
  });

  await addParsingJobToQueue(app, {
    id: created.job.id,
    fileId: original.id,
    versionId: created.version.id,
    jobType: "PARSE"
  });

  return {
    document: { id: document.id, title: document.title, docType: document.docType },
    version: { id: created.version.id, versionNo: created.version.version },
    file: { id: original.id, name: original.originalName },
    parsing: { jobId: created.job.id, status: "QUEUED" as const }
  };
}

export async function getDocumentWorkspace(
  app: FastifyInstance,
  actor: AuthUser,
  documentId: string
) {
  const document = await requireLiveDocument(app, documentId);
  const version = await findWorkingVersion(app, documentId);
  if (!version) {
    return {
      document: {
        id: document.id,
        title: document.title,
        docType: document.docType,
        currentVersionId: null,
        publishedVersionId: document.currentVersionId
      },
      currentVersion: null,
      primaryFile: null,
      searchableFile: null,
      parsing: { lastJob: null },
      summary: {
        pageCount: 0,
        tocCount: 0,
        sectionCount: 0,
        canAskAi: false,
        canPublish: false,
        canRetry: false,
        publishBlockers: ["当前知识库还没有资料页面，请先上传完整页面图片"],
        publishBlockerCodes: ["KNOWLEDGE_VERSION_EMPTY"],
        contentSource: "NOT_READY" as const
      },
      actions: {
        canRetry: false,
        canReplaceFile: true,
        canBindSearchSource: false
      }
    };
  }

  const [assetRows, pageCountRow, tocCountRow, sectionCountRow, chunkCountRow, lastJob] = await Promise.all([
    app.db.select({
      role: knowledgeDocumentAssets.role,
      fileId: knowledgeDocumentAssets.fileId,
      fileName: files.originalName,
      mimeType: files.mimeType,
      sizeBytes: files.sizeBytes
    }).from(knowledgeDocumentAssets)
      .innerJoin(files, eq(files.id, knowledgeDocumentAssets.fileId))
      .where(eq(knowledgeDocumentAssets.versionId, version.id)),
    app.db.select({ value: knowledgePages.id }).from(knowledgePages)
      .where(eq(knowledgePages.versionId, version.id)),
    app.db.select({ id: knowledgeTocItems.id }).from(knowledgeTocItems)
      .where(eq(knowledgeTocItems.versionId, version.id)),
    app.db.select({ id: knowledgeSections.id }).from(knowledgeSections)
      .where(eq(knowledgeSections.versionId, version.id)),
    app.db.select({ id: knowledgeChunks.id }).from(knowledgeChunks)
      .where(eq(knowledgeChunks.versionId, version.id)),
    app.db.select().from(parsingJobs)
      .where(eq(parsingJobs.versionId, version.id))
      .orderBy(desc(parsingJobs.createdAt))
      .limit(1).then((rows) => rows[0] ?? null)
  ]);

  const roles = assetRows.map((row) => row.role);
  const hasSearchSource = hasSearchSourceRole(roles, version.parseStatus);
  const pageCount = pageCountRow.length;
  const chunkCount = chunkCountRow.length;
  // 统一 readiness：页面驱动链就绪时不要求 ORIGINAL，也不因 parseStatus=PENDING 被判为「待解析」
  const readiness = await collectKnowledgeVersionReadiness(app, version);
  const statusInput = {
    parseStatus: version.parseStatus,
    pipelineStatus: version.pipelineStatus,
    versionStatus: version.status,
    usageMode: version.usageMode,
    hasSearchSource,
    pageCount,
    chunkCount,
    jobStatus: lastJob?.status,
    offlinePageContentReady: readiness.offlinePageContentReady,
    searchableContentReady: readiness.searchableContentReady
  };
  const userStatus = mapKnowledgeUserStatus(statusInput);
  const canAskAi = canAskAiFromStatus(statusInput);
  const canRetry = canRetryParse({ userStatus, versionStatus: version.status });
  // 与发布 API 完全一致：canPublish 直接来自 readiness.publishReady
  const canPublish = readiness.publishReady && (version.status === "DRAFT" || version.status === "APPROVED");

  const originalAsset = assetRows.find((row) => row.role === "ORIGINAL");
  const searchAsset = assetRows.find((row) => row.role === "SEARCH_SOURCE");
  const includeTechnical = hasDebugPermission(actor);
  const lastJobView = lastJob
    ? presentLastJob(lastJob, version.parseStatus, version.parser, includeTechnical)
    : null;
  const processingDetail = extractProcessingDetail(lastJob);

  return {
    document: {
      id: document.id,
      title: document.title,
      docType: document.docType,
      docNumber: document.docNumber,
      categoryId: document.categoryId,
      currentVersionId: version.id,
      publishedVersionId: document.currentVersionId
    },
    currentVersion: {
      id: version.id,
      versionNo: version.version,
      userStatus,
      parseStatus: version.parseStatus,
      status: version.status,
      pipelineStatus: version.pipelineStatus
    },
    primaryFile: originalAsset
      ? {
        id: originalAsset.fileId,
        name: originalAsset.fileName,
        mimeType: originalAsset.mimeType,
        sizeBytes: originalAsset.sizeBytes
      }
      : version.fileId
        ? { id: version.fileId, name: "", mimeType: "", sizeBytes: 0 }
        : null,
    searchableFile: searchAsset
      ? { id: searchAsset.fileId, name: searchAsset.fileName }
      : undefined,
    parsing: {
      lastJob: lastJobView,
      textParsing: processingDetail.textParsing,
      pageRendering: processingDetail.pageRendering,
      pageRenderingComplete: processingDetail.pageRenderingComplete,
      pageRenderingError: processingDetail.pageRenderingError,
      previewRendered: processingDetail.previewRendered,
      previewFailed: processingDetail.previewFailed
    },
    summary: {
      pageCount,
      tocCount: tocCountRow.length,
      sectionCount: sectionCountRow.length,
      canAskAi,
      canPublish,
      canRetry,
      /** 与发布 API 同一份 readiness：B 端展示的 blockers 即发布被拒原因 */
      publishBlockers: readiness.publishBlockers.map((blocker) => blocker.message),
      publishBlockerCodes: readiness.publishBlockers.map((blocker) => blocker.knowledgeErrorCode),
      contentSource: readiness.traditionalContentReady
        ? "ORIGINAL_FILE"
        : readiness.offlinePageContentReady ? "PAGE_DRIVEN" : "NOT_READY"
    },
    actions: {
      canRetry,
      canReplaceFile: version.status !== "DISABLED",
      canBindSearchSource: userStatus === "SEARCHABLE_FILE_REQUIRED",
      canRetryPageRender: processingDetail.pageRendering === "FAILED"
        || processingDetail.pageRenderingComplete === false
        || (pageCount === 0 && Boolean(originalAsset?.mimeType?.includes("wordprocessingml")))
    }
  };
}

function extractProcessingDetail(job: typeof parsingJobs.$inferSelect | null): {
  textParsing: "READY" | "FAILED" | null;
  pageRendering: "READY" | "FAILED" | "SKIPPED" | null;
  pageRenderingComplete: boolean | null;
  pageRenderingError: { code: string; message: string } | null;
  previewRendered: number | null;
  previewFailed: number | null;
} {
  const result = job?.result;
  if (!result || typeof result !== "object") {
    return {
      textParsing: null,
      pageRendering: null,
      pageRenderingComplete: null,
      pageRenderingError: null,
      previewRendered: null,
      previewFailed: null
    };
  }
  const textParsing = result.textParsing === "READY" || result.textParsing === "FAILED"
    ? result.textParsing
    : null;
  const pageRendering = result.pageRendering === "READY"
    || result.pageRendering === "FAILED"
    || result.pageRendering === "SKIPPED"
    ? result.pageRendering
    : null;
  const pageRenderingComplete = typeof result.pageRenderingComplete === "boolean"
    ? result.pageRenderingComplete
    : null;
  const previewRendered = typeof result.previewRendered === "number" ? result.previewRendered : null;
  const previewFailed = typeof result.previewFailed === "number" ? result.previewFailed : null;
  const rawError = result.pageRenderingError;
  const pageRenderingError = rawError && typeof rawError === "object"
    && typeof (rawError as { code?: unknown }).code === "string"
    && typeof (rawError as { message?: unknown }).message === "string"
    ? { code: (rawError as { code: string }).code, message: (rawError as { message: string }).message }
    : null;
  return {
    textParsing,
    pageRendering,
    pageRenderingComplete,
    pageRenderingError,
    previewRendered,
    previewFailed
  };
}

function presentLastJob(
  job: typeof parsingJobs.$inferSelect,
  parseStatus: string,
  parser: string | null,
  includeTechnical: boolean
) {
  const needsPresentation = job.status === "FAILED"
    || job.status === "OCR_REQUIRED"
    || parseStatus === "FAILED"
    || parseStatus === "SEARCH_SOURCE_REQUIRED"
    || parseStatus === "NO_TEXT_LAYER"
    || parseStatus === "OCR_REQUIRED"
    || (job.result && (job.result.status === "SEARCH_SOURCE_REQUIRED" || job.result.status === "OCR_REQUIRED"));
  const presented = needsPresentation
    ? toParseFailurePresentation({
      id: job.id,
      errorMessage: job.errorMessage,
      result: job.result,
      parser
    }, parseStatus)
    : null;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    stage: deriveParsingStage({ jobStatus: job.status, pipelineStatus: null }),
    errorMessage: presented ? presented.userMessage : job.errorMessage,
    userMessage: presented?.userMessage ?? null,
    errorCode: presented?.errorCode ?? null,
    attempts: job.attempts,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    ...(includeTechnical && presented ? { technical: presented.technical } : {})
  };
}

export function buildUserChapterTree(
  items: Array<{
    id: string;
    parentId: string | null;
    title: string;
    level: number;
    pageLabel: string | null;
    physicalPageNumber: number | null;
    sortOrder: number;
  }>
): ChapterTreeNode[] {
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.level - b.level);
  const nodes = new Map<string, ChapterTreeNode & { children: ChapterTreeNode[] }>();
  for (const item of sorted) {
    nodes.set(item.id, {
      id: item.id,
      title: item.title,
      level: item.level,
      pageLabel: item.pageLabel,
      physicalPageNumber: item.physicalPageNumber,
      children: []
    });
  }
  const roots: ChapterTreeNode[] = [];
  for (const item of sorted) {
    const node = nodes.get(item.id)!;
    const parent = item.parentId ? nodes.get(item.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const prune = (node: ChapterTreeNode): ChapterTreeNode => ({
    id: node.id,
    title: node.title,
    level: node.level,
    pageLabel: node.pageLabel,
    physicalPageNumber: node.physicalPageNumber,
    ...((node.children?.length ?? 0) > 0
      ? { children: node.children!.map(prune) }
      : {})
  });
  return roots.map(prune);
}

export async function listVersionChapterTree(app: FastifyInstance, versionId: string) {
  const [version] = await app.db.select({ id: knowledgeDocumentVersions.id }).from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
  if (!version) throw new NotFoundError("文档版本不存在");

  const tocRows = await app.db.select({
    id: knowledgeTocItems.id,
    parentId: knowledgeTocItems.parentId,
    title: knowledgeTocItems.title,
    level: knowledgeTocItems.level,
    pageLabel: knowledgeTocItems.pageLabel,
    physicalPageNumber: knowledgeTocItems.physicalPageNumber,
    sortOrder: knowledgeTocItems.sortOrder,
    status: knowledgeTocItems.status
  }).from(knowledgeTocItems)
    .where(eq(knowledgeTocItems.versionId, versionId))
    .orderBy(asc(knowledgeTocItems.sortOrder), asc(knowledgeTocItems.level));

  if (tocRows.length > 0) {
    const confirmed = tocRows.filter((row) => row.status === "CONFIRMED");
    const source = confirmed.length > 0 ? confirmed : tocRows;
    return { items: buildUserChapterTree(source) };
  }

  const sections = await app.db.select({
    id: knowledgeSections.id,
    parentId: knowledgeSections.parentId,
    title: knowledgeSections.title,
    level: knowledgeSections.level,
    startPage: knowledgeSections.startPage,
    sortOrder: knowledgeSections.sortOrder
  }).from(knowledgeSections)
    .where(eq(knowledgeSections.versionId, versionId))
    .orderBy(asc(knowledgeSections.sortOrder), asc(knowledgeSections.level));
  const pageRows = await app.db.select({
    physicalPageNumber: knowledgePages.physicalPageNumber,
    pageLabel: knowledgePages.pageLabel
  }).from(knowledgePages).where(eq(knowledgePages.versionId, versionId));
  const labelByPage = new Map(pageRows.map((row) => [row.physicalPageNumber, row.pageLabel]));
  return {
    items: buildUserChapterTree(sections.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      title: row.title,
      level: row.level,
      pageLabel: row.startPage != null ? labelByPage.get(row.startPage) ?? String(row.startPage) : null,
      physicalPageNumber: row.startPage,
      sortOrder: row.sortOrder
    })))
  };
}

/**
 * Knowledge Test 门禁：传统文件链或页面驱动链任一就绪 + 存在可检索 chunks 即可测试。
 * 页面驱动版本即使 parseStatus=PENDING 也允许测试（不再依据原始文件解析状态拒绝）。
 */
export async function assertVersionTestable(app: FastifyInstance, versionId: string) {
  const [version] = await app.db.select().from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
  if (!version) throw new NotFoundError("文档版本不存在");
  const [document] = await app.db.select().from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.id, version.documentId), isNull(knowledgeDocuments.deletedAt))).limit(1);
  if (!document) throw new NotFoundError("知识文档不存在");
  if (version.status === "DISABLED") throw new ConflictError("已停用版本不能进行 AI 测试");

  const [assetRows, pageRows, chunkRows] = await Promise.all([
    app.db.select({ role: knowledgeDocumentAssets.role }).from(knowledgeDocumentAssets)
      .where(eq(knowledgeDocumentAssets.versionId, versionId)),
    app.db.select({
      pageImageObjectKey: knowledgePages.pageImageObjectKey,
      metadata: knowledgePages.metadata
    }).from(knowledgePages)
      .where(eq(knowledgePages.versionId, versionId)),
    app.db.select({ id: knowledgeChunks.id }).from(knowledgeChunks)
      .where(eq(knowledgeChunks.versionId, versionId))
  ]);
  const roles = assetRows.map((row) => row.role);
  const hasSearchSource = hasSearchSourceRole(roles, version.parseStatus);
  const readiness = deriveKnowledgeVersionReadiness(
    {
      usageMode: version.usageMode,
      parseStatus: version.parseStatus,
      hasOriginalAsset: roles.includes("ORIGINAL") || Boolean(version.fileId),
      hasSearchSourceAsset: roles.includes("SEARCH_SOURCE")
    },
    summarizePageReadiness(pageRows, chunkRows.length)
  );

  // 无文本层且无检索源：保留既有稳定业务码，提示先补检索文本源
  if (version.parseStatus === "OCR_REQUIRED"
    || ((version.parseStatus === "SEARCH_SOURCE_REQUIRED" || version.parseStatus === "NO_TEXT_LAYER") && !hasSearchSource)) {
    throw new KnowledgeError("KNOWLEDGE_SEARCH_SOURCE_REQUIRED");
  }
  if (!readiness.searchableContentReady) {
    throw new KnowledgeError("KNOWLEDGE_NOT_READY_FOR_TEST");
  }
  return { version, document, hasSearchSource, readiness };
}

export async function streamVersionTestQa(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  actor: AuthUser,
  versionId: string,
  body: { query: string; reasoningMode?: "OFF" | "ON"; limit?: number }
) {
  await assertVersionTestable(app, versionId);
  const limit = Math.min(10, Math.max(1, body.limit ?? 5));
  const chunks = await searchWikiHierarchy(app, body.query, { versionId, limit });
  const conversation = await app.db.transaction(async (tx) => {
    const [created] = await tx.insert(aiConversations).values({
      userId: actor.id,
      projectId: null,
      clientApp: CLIENT_APPS.B_ADMIN,
      scene: AI_SCENES.KNOWLEDGE_QA,
      title: `【版本测试】${body.query.slice(0, 40)}`,
      reasoningMode: body.reasoningMode ?? "OFF"
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.AI_CONVERSATION_CREATED,
      targetType: "ai_conversation",
      targetId: created!.id,
      afterJson: { scene: AI_SCENES.KNOWLEDGE_QA, versionId, testMode: true }
    });
    return created!;
  });
  await streamConversationReply({
    app,
    request,
    reply,
    user: actor,
    conversation,
    content: body.query,
    knowledgeChunks: chunks,
    mapSources: hasDebugPermission(actor) ? toAiSources : toUserTestSources
  });
}

/**
 * B 端调试用非流式测试：返回命中 chunk、页图与绑定热工行，不暴露给 C 端。
 */
export async function inspectVersionTestQa(
  app: FastifyInstance,
  versionId: string,
  body: { query: string; limit?: number }
) {
  await assertVersionTestable(app, versionId);
  const limit = Math.min(20, Math.max(1, body.limit ?? 8));
  const hits = await searchWikiHierarchy(app, body.query, { versionId, limit });

  const pageIds = [...new Set(
    hits.map((hit) => hit.pageId).filter((id): id is string => Boolean(id))
  )];

  const pages = pageIds.length === 0
    ? []
    : (await app.db.select().from(knowledgePages).where(eq(knowledgePages.versionId, versionId)))
      .filter((row) => pageIds.includes(row.id));

  const pageById = new Map(pages.map((page) => [page.id, page]));
  const referencePages = [];
  for (const page of pages) {
    if (!page.pageImageObjectKey) continue;
    referencePages.push({
      pageId: page.id,
      physicalPageNumber: page.physicalPageNumber,
      pageLabel: page.pageLabel,
      pageTitle: page.pageTitle,
      pageImageObjectKey: page.pageImageObjectKey,
      pageImageUrl: await app.storage.createDownloadUrl(
        page.pageImageObjectKey,
        getPageImageDownloadName(page.pageImageObjectKey, page.physicalPageNumber),
        3600
      )
    });
  }

  const { thermalReferenceRows } = await import("../../db/schema.js");
  const matchedReferenceRows = [];
  for (const id of pageIds) {
    const rows = await app.db.select({
      id: thermalReferenceRows.id,
      setId: thermalReferenceRows.setId,
      thicknessMm: thermalReferenceRows.thicknessMm,
      productThermalResistance: thermalReferenceRows.productThermalResistance,
      totalThermalResistance: thermalReferenceRows.totalThermalResistance,
      kValue: thermalReferenceRows.kValue,
      sourcePageId: thermalReferenceRows.sourcePageId,
      sourcePageLabel: thermalReferenceRows.sourcePageLabel
    }).from(thermalReferenceRows).where(eq(thermalReferenceRows.sourcePageId, id));
    matchedReferenceRows.push(...rows);
  }

  return {
    answer: null,
    taskType: "KNOWLEDGE_TEST_INSPECT",
    sources: hits.map((hit) => ({
      title: hit.sourceTitle,
      pageLabel: hit.pageLabel,
      physicalPageNumber: hit.physicalPageNumber,
      quote: hit.snippet ?? hit.content.slice(0, 240),
      pageId: hit.pageId ?? null
    })),
    referencePages,
    matchedReferenceRows,
    retrievedChunks: hits.map((hit) => {
      const page = hit.pageId ? pageById.get(hit.pageId) : undefined;
      return {
        chunkId: hit.chunkId ?? hit.sourceId,
        content: hit.content,
        pageId: hit.pageId ?? null,
        traceable: Boolean(hit.pageId),
        retrievalUnit: hit.retrievalUnit,
        sourceType: hit.sourceType ?? (hit.pageId ? "PAGE_AWARE" : "DOCUMENT_TEXT"),
        physicalPageNumber: hit.physicalPageNumber ?? page?.physicalPageNumber ?? null,
        pageLabel: hit.pageLabel ?? page?.pageLabel ?? null,
        documentId: hit.documentId,
        versionId: hit.versionId,
        score: hit.score
      };
    })
  };
}

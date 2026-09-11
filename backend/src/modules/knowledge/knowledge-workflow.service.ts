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
import { collectAiReadinessContext, evaluateVersionAiReadiness } from "./knowledge-original.service.js";
import { searchWikiHierarchy } from "./knowledge.service.js";
import {
  addParsingJobToQueue,
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

export async function createKnowledgeWithFile(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  input: {
    title: string;
    docType: KnowledgeDocType;
    originalFileId: string;
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
  const original = await requireUsableFile(app, input.originalFileId);
  const searchSource = input.searchSourceFileId
    ? await requireUsableFile(app, input.searchSourceFileId)
    : null;

  const created = await app.db.transaction(async (tx) => {
    const [document] = await tx.insert(knowledgeDocuments).values({
      title: input.title,
      docType: input.docType,
      docNumber: input.docNumber ?? undefined,
      sourceOrg: input.sourceOrg ?? undefined,
      issueDate: input.issueDate ?? undefined,
      effectiveDate: input.effectiveDate ?? undefined,
      evidenceLevel: input.evidenceLevel ?? undefined,
      allowedPurposes: input.allowedPurposes ?? [],
      categoryId: input.categoryId ?? undefined,
      status: "ACTIVE",
      createdById: actor.id
    }).returning();
    const versionNumber = await nextVersionNumber(tx, document!.id);
    const [version] = await tx.insert(knowledgeDocumentVersions).values({
      documentId: document!.id,
      version: versionNumber,
      title: input.title,
      status: "DRAFT",
      parseStatus: "PENDING",
      pipelineStatus: "UPLOADED",
      fileId: original.id,
      evidenceLevel: input.evidenceLevel ?? undefined,
      createdById: actor.id
    }).returning();
    await tx.insert(knowledgeDocumentAssets).values({
      documentId: document!.id,
      versionId: version!.id,
      fileId: original.id,
      role: "ORIGINAL",
      isPrimary: true,
      createdById: actor.id
    });
    if (searchSource) {
      await tx.insert(knowledgeDocumentAssets).values({
        documentId: document!.id,
        versionId: version!.id,
        fileId: searchSource.id,
        role: "SEARCH_SOURCE",
        isPrimary: true,
        createdById: actor.id
      });
    }
    const [job] = await tx.insert(parsingJobs).values({
      documentId: document!.id,
      versionId: version!.id,
      jobType: "PARSE",
      status: "QUEUED",
      fileId: original.id,
      queuedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_DOC_CREATED, targetType: "knowledge_document", targetId: document!.id,
      afterJson: { title: document!.title, docType: document!.docType, versionId: version!.id, parsingJobId: job!.id }
    });
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_VERSION_CREATED, targetType: "knowledge_document_version", targetId: version!.id,
      afterJson: { documentId: document!.id, version: version!.version, originalFileId: original.id }
    });
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_VERSION_PARSED, targetType: "knowledge_document_version", targetId: version!.id,
      afterJson: { jobType: "PARSE", parsingJobId: job!.id, triggeredBy: "CREATE_WITH_FILE" }
    });
    return { document: document!, version: version!, job: job! };
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
        canRetry: false
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
  const userStatus = mapKnowledgeUserStatus({
    parseStatus: version.parseStatus,
    pipelineStatus: version.pipelineStatus,
    versionStatus: version.status,
    usageMode: version.usageMode,
    hasSearchSource,
    pageCount,
    chunkCount,
    jobStatus: lastJob?.status
  });
  const statusInput = {
    parseStatus: version.parseStatus,
    pipelineStatus: version.pipelineStatus,
    versionStatus: version.status,
    usageMode: version.usageMode,
    hasSearchSource,
    pageCount,
    chunkCount,
    jobStatus: lastJob?.status
  };
  const canAskAi = canAskAiFromStatus(statusInput);
  const canRetry = canRetryParse({ userStatus, versionStatus: version.status });
  let canPublish = false;
  try {
    const readiness = evaluateVersionAiReadiness(version, await collectAiReadinessContext(app, version.id));
    const parseable = version.parseStatus === "PARSED"
      || version.parseStatus === "PARTIAL"
      || version.parseStatus === "NO_TEXT_LAYER"
      || (version.usageMode === "BROWSE_ONLY" && version.parseStatus === "SEARCH_SOURCE_REQUIRED");
    canPublish = parseable && readiness.eligible && (version.status === "DRAFT" || version.status === "APPROVED");
  } catch {
    canPublish = false;
  }

  const originalAsset = assetRows.find((row) => row.role === "ORIGINAL");
  const searchAsset = assetRows.find((row) => row.role === "SEARCH_SOURCE");
  const includeTechnical = hasDebugPermission(actor);
  const lastJobView = lastJob
    ? presentLastJob(lastJob, version.parseStatus, version.parser, includeTechnical)
    : null;

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
    parsing: { lastJob: lastJobView },
    summary: {
      pageCount,
      tocCount: tocCountRow.length,
      sectionCount: sectionCountRow.length,
      canAskAi,
      canPublish,
      canRetry
    },
    actions: {
      canRetry,
      canReplaceFile: version.status !== "DISABLED",
      canBindSearchSource: userStatus === "SEARCHABLE_FILE_REQUIRED"
    }
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
    app.db.select({ id: knowledgePages.id }).from(knowledgePages)
      .where(eq(knowledgePages.versionId, versionId)),
    app.db.select({ id: knowledgeChunks.id }).from(knowledgeChunks)
      .where(eq(knowledgeChunks.versionId, versionId))
  ]);
  const roles = assetRows.map((row) => row.role);
  const hasSearchSource = hasSearchSourceRole(roles, version.parseStatus);

  if (["PENDING", "PARSING", "FAILED"].includes(version.parseStatus)
    || ["PARSING", "CHUNKING", "UPLOAD_PENDING"].includes(version.pipelineStatus)) {
    throw new KnowledgeError("KNOWLEDGE_NOT_READY_FOR_TEST");
  }
  if (
    version.parseStatus === "OCR_REQUIRED"
    || ((version.parseStatus === "SEARCH_SOURCE_REQUIRED" || version.parseStatus === "NO_TEXT_LAYER") && !hasSearchSource)
  ) {
    throw new KnowledgeError("KNOWLEDGE_SEARCH_SOURCE_REQUIRED");
  }
  if (pageRows.length === 0 || chunkRows.length === 0) {
    throw new KnowledgeError("KNOWLEDGE_NOT_READY_FOR_TEST");
  }
  return { version, document, hasSearchSource };
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

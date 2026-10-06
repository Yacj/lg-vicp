import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, count, eq, inArray } from "drizzle-orm";
import type { AuthUser } from "../../shared/auth-user.js";
import { AppError, NotFoundError } from "../../shared/errors.js";
import { emptyRecognitionMetadata, mergePageMetadata } from "../../shared/page-recognition.js";
import { files, knowledgeDocumentVersions, knowledgePages, thermalReferenceRows } from "../../db/schema.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";

const PAGE_IMAGE_MIME = new Set(["image/png", "image/jpeg"]);

async function requireVersion(app: FastifyInstance, versionId: string) {
  const [version] = await app.db.select().from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
  if (!version) throw new NotFoundError("文档版本不存在");
  return version;
}

async function resolvePageImage(app: FastifyInstance, fileId: string) {
  const [file] = await app.db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!file || file.status !== "READY") throw new NotFoundError("页面图片不存在或尚未上传完成");
  if (!PAGE_IMAGE_MIME.has(file.mimeType)) {
    throw new AppError("INVALID_PAGE_IMAGE", "仅支持 PNG / JPG 页面图片", 400);
  }
  return file.objectKey;
}

/** 事务内把版本 pageCount 同步为当前 knowledge_pages 行数；排序不应改变该值。 */
async function syncVersionPageCount(
  db: { update: FastifyInstance["db"]["update"]; select: FastifyInstance["db"]["select"] },
  versionId: string
) {
  const [row] = await db.select({ value: count() }).from(knowledgePages)
    .where(eq(knowledgePages.versionId, versionId));
  await db.update(knowledgeDocumentVersions).set({
    pageCount: row?.value ?? 0,
    updatedAt: new Date()
  }).where(eq(knowledgeDocumentVersions.id, versionId));
  return row?.value ?? 0;
}

export async function createManualPage(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  input: {
    pageNumber: number;
    pageLabel?: string | null;
    pageTitle?: string | null;
    parsedText?: string | null;
    imageFileId?: string | null;
  }
) {
  const version = await requireVersion(app, versionId);
  const [conflict] = await app.db.select({ id: knowledgePages.id }).from(knowledgePages)
    .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.pageNumber, input.pageNumber)))
    .limit(1);
  if (conflict) throw new AppError("PAGE_NUMBER_CONFLICT", "该页码已存在", 400);
  const pageImageObjectKey = input.imageFileId ? await resolvePageImage(app, input.imageFileId) : null;
  const created = await app.db.transaction(async (tx) => {
    const [page] = await tx.insert(knowledgePages).values({
      documentId: version.documentId,
      versionId,
      pageNumber: input.pageNumber,
      physicalPageNumber: input.pageNumber,
      pageLabel: input.pageLabel ?? String(input.pageNumber),
      pageLabelSource: "MANUAL",
      pageLabelVerified: true,
      pageTitle: input.pageTitle ?? null,
      parsedText: input.parsedText ?? null,
      pageImageObjectKey,
      parseStatus: "PARSED",
      metadata: pageImageObjectKey
        ? mergePageMetadata(null, emptyRecognitionMetadata({
          recognitionStatus: "PENDING",
          uploadSource: "MANUAL"
        }))
        : null
    }).returning();
    await syncVersionPageCount(tx, versionId);
    return page!;
  });
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.page_created", targetType: "knowledge_page", targetId: created.id,
    afterJson: { versionId, pageNumber: input.pageNumber, pageImageObjectKey }
  });
  return created;
}

export async function updateManualPage(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  physicalPageNumber: number,
  input: {
    pageNumber?: number;
    pageLabel?: string | null;
    pageTitle?: string | null;
    parsedText?: string | null;
    imageFileId?: string | null;
  }
) {
  const [page] = await app.db.select().from(knowledgePages)
    .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.physicalPageNumber, physicalPageNumber)))
    .limit(1);
  if (!page || page.pageNumber < 1) throw new NotFoundError("页面不存在");
  if (input.pageNumber !== undefined && input.pageNumber !== page.pageNumber) {
    const [conflict] = await app.db.select({ id: knowledgePages.id }).from(knowledgePages)
      .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.pageNumber, input.pageNumber)))
      .limit(1);
    if (conflict) throw new AppError("PAGE_NUMBER_CONFLICT", "该页码已存在", 400);
  }
  const pageImageObjectKey = input.imageFileId === undefined
    ? page.pageImageObjectKey
    : input.imageFileId
      ? await resolvePageImage(app, input.imageFileId)
      : null;
  const [updated] = await app.db.update(knowledgePages).set({
    pageNumber: input.pageNumber ?? page.pageNumber,
    pageLabel: input.pageLabel !== undefined ? (input.pageLabel ?? String(page.physicalPageNumber)) : page.pageLabel,
    pageLabelSource: input.pageLabel !== undefined ? "MANUAL" : page.pageLabelSource,
    pageLabelVerified: input.pageLabel !== undefined ? Boolean(input.pageLabel) : page.pageLabelVerified,
    pageTitle: input.pageTitle !== undefined ? input.pageTitle : page.pageTitle,
    parsedText: input.parsedText !== undefined ? input.parsedText : page.parsedText,
    pageImageObjectKey
  }).where(eq(knowledgePages.id, page.id)).returning();
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.page_updated", targetType: "knowledge_page", targetId: page.id,
    beforeJson: { pageNumber: page.pageNumber, pageTitle: page.pageTitle, pageImageObjectKey: page.pageImageObjectKey },
    afterJson: { pageNumber: updated!.pageNumber, pageTitle: updated!.pageTitle, pageImageObjectKey: updated!.pageImageObjectKey }
  });
  return updated!;
}

export async function reorderManualPages(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  pageNumbers: Array<{ physicalPageNumber: number; pageNumber: number }>
) {
  await requireVersion(app, versionId);
  const rows = await app.db.select().from(knowledgePages).where(eq(knowledgePages.versionId, versionId));
  const byPhysical = new Map(rows.map((row) => [row.physicalPageNumber, row]));
  for (const item of pageNumbers) {
    if (!byPhysical.has(item.physicalPageNumber) || item.pageNumber < 1) {
      throw new AppError("INVALID_PAGE_ORDER", "排序中的页面不存在或页码无效", 400);
    }
  }
  const nextNumbers = pageNumbers.map((item) => item.pageNumber);
  if (new Set(nextNumbers).size !== nextNumbers.length) {
    throw new AppError("INVALID_PAGE_ORDER", "排序页码不能重复", 400);
  }
  await app.db.transaction(async (tx) => {
    for (const item of pageNumbers) {
      await tx.update(knowledgePages).set({ pageNumber: item.pageNumber + 100000 })
        .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.physicalPageNumber, item.physicalPageNumber)));
    }
    for (const item of pageNumbers) {
      await tx.update(knowledgePages).set({ pageNumber: item.pageNumber })
        .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.physicalPageNumber, item.physicalPageNumber)));
    }
    // 排序只改 pageNumber，不改变 pageCount。
  });
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.pages_reordered", targetType: "knowledge_document_version", targetId: versionId,
    afterJson: { pageNumbers, pageCountUnchanged: true }
  });
  return { message: "页面顺序已更新" };
}

export async function deleteManualPage(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  physicalPageNumber: number
) {
  const [page] = await app.db.select().from(knowledgePages)
    .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.physicalPageNumber, physicalPageNumber)))
    .limit(1);
  if (!page || page.pageNumber < 1) throw new NotFoundError("页面不存在");
  const references = await app.db.select({
    id: thermalReferenceRows.id,
    setId: thermalReferenceRows.setId
  }).from(thermalReferenceRows).where(eq(thermalReferenceRows.sourcePageId, page.id));
  if (references.length > 0) {
    throw new AppError("PAGE_IN_USE", "该页面已被热工参考方案引用，不能删除", 400, {
      errorCode: "PAGE_IN_USE",
      references
    });
  }
  await app.db.transaction(async (tx) => {
    await tx.delete(knowledgePages).where(eq(knowledgePages.id, page.id));
    await syncVersionPageCount(tx, versionId);
  });
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.page_deleted", targetType: "knowledge_page", targetId: page.id,
    beforeJson: { versionId, physicalPageNumber, pageNumber: page.pageNumber }
  });
  return { message: "页面已删除" };
}

export async function listPageReferenceRows(app: FastifyInstance, versionId: string, physicalPageNumber: number) {
  const [page] = await app.db.select().from(knowledgePages)
    .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.physicalPageNumber, physicalPageNumber)))
    .limit(1);
  if (!page || page.pageNumber < 1) throw new NotFoundError("页面不存在");
  const rows = await app.db.select({
    id: thermalReferenceRows.id,
    setId: thermalReferenceRows.setId,
    thicknessMm: thermalReferenceRows.thicknessMm,
    productThermalResistance: thermalReferenceRows.productThermalResistance,
    totalThermalResistance: thermalReferenceRows.totalThermalResistance,
    kValue: thermalReferenceRows.kValue,
    sourcePageLabel: thermalReferenceRows.sourcePageLabel
  }).from(thermalReferenceRows).where(eq(thermalReferenceRows.sourcePageId, page.id));
  return { pageId: page.id, items: rows };
}

export async function assertPagesBelongToDocument(app: FastifyInstance, documentId: string, pageIds: string[]) {
  if (pageIds.length === 0) return;
  const rows = await app.db.select({ id: knowledgePages.id, documentId: knowledgePages.documentId })
    .from(knowledgePages).where(inArray(knowledgePages.id, pageIds));
  if (rows.length !== pageIds.length || rows.some((row) => row.documentId !== documentId)) {
    throw new AppError("INVALID_SOURCE_PAGE", "所选页面不属于该知识资料", 400);
  }
}
